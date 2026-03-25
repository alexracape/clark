/**
 * Embeddings Proxy — generates text embeddings via OpenAI API.
 *
 * Accepts an array of text strings and returns embedding vectors.
 */

import { authenticate } from "../lib/auth.ts";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.ts";
import { errorResponse, methodNotAllowed } from "../lib/errors.ts";

const embedLimiter = createRateLimiter(20, "60 s");

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();

  const auth = authenticate(req);
  if (!auth.ok) return auth.response;

  const rateLimited = await checkRateLimit(embedLimiter, auth.clientId);
  if (rateLimited) return rateLimited;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const { texts } = body;
  if (!Array.isArray(texts)) {
    return errorResponse(400, "Missing required field: texts (string[])");
  }

  if (texts.length === 0) {
    return new Response(
      JSON.stringify({ embeddings: [], dimensions: 1536, model: "text-embedding-3-small" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return errorResponse(500, "Server misconfigured: missing OPENAI_API_KEY");
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return errorResponse(502, `OpenAI embeddings error (${response.status}): ${text}`);
    }

    const result = await response.json() as any;
    const embeddings = result.data.map((item: any) => item.embedding);
    const dimensions = embeddings[0]?.length ?? 1536;

    return new Response(
      JSON.stringify({ embeddings, dimensions, model: "text-embedding-3-small" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(500, `Embedding failed: ${msg}`);
  }
}
