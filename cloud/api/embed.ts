/**
 * Embeddings Proxy — generates text embeddings via the Vercel AI Gateway.
 *
 * Routes through the Gateway for unified key management and cost tracking.
 * Uses OpenAI text-embedding-3-small by default.
 */

import { embedMany } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { authenticate, requireTier } from "../lib/auth.js";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.js";
import { errorResponse, methodNotAllowed } from "../lib/errors.js";

const embedLimiter = createRateLimiter(20, "60 s");
const DEFAULT_MODEL = "openai/text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const tierCheck = requireTier("beta", auth);
    if (tierCheck) return tierCheck;

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
        JSON.stringify({ embeddings: [], dimensions: DEFAULT_DIMENSIONS, model: DEFAULT_MODEL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const { embeddings } = await embedMany({
        model: gateway.textEmbeddingModel(DEFAULT_MODEL),
        values: texts,
        abortSignal: AbortSignal.timeout(25_000),
      });

      const dimensions = embeddings[0]?.length ?? DEFAULT_DIMENSIONS;

      return new Response(
        JSON.stringify({ embeddings, dimensions, model: DEFAULT_MODEL }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(500, `Embedding failed: ${msg}`);
    }
  },
};
