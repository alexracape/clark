/**
 * OCR Proxy — sends PDFs to Mistral OCR API and returns markdown.
 *
 * Accepts a base64-encoded PDF, sends it to Mistral's OCR endpoint,
 * and returns structured markdown output.
 */

import { authenticate } from "../lib/auth.ts";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.ts";
import { errorResponse, methodNotAllowed } from "../lib/errors.ts";

const ocrLimiter = createRateLimiter(10, "60 s");

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();

  const auth = authenticate(req);
  if (!auth.ok) return auth.response;

  const rateLimited = await checkRateLimit(ocrLimiter, auth.clientId);
  if (rateLimited) return rateLimited;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const { pdf, image, mimeType } = body;
  if (!pdf && !image) {
    return errorResponse(400, "Missing required field: pdf or image");
  }

  const mistralKey = process.env.MISTRAL_API_KEY;
  if (!mistralKey) {
    return errorResponse(500, "Server misconfigured: missing MISTRAL_API_KEY");
  }

  try {
    if (pdf) {
      // Full PDF OCR via Mistral
      const response = await fetch("https://api.mistral.ai/v1/ocr", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mistralKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mistral-ocr-latest",
          document: {
            type: "document_url",
            document_url: `data:application/pdf;base64,${pdf}`,
          },
        }),
        signal: AbortSignal.timeout(55_000), // Stay under Vercel's 60s limit
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return errorResponse(502, `Mistral OCR error (${response.status}): ${text}`);
      }

      const result = await response.json() as any;

      // Mistral OCR returns pages with markdown content
      const pages = result.pages ?? [];
      const markdown = pages.map((p: any) => p.markdown ?? "").join("\n\n");
      const pageCount = pages.length;

      return new Response(
        JSON.stringify({ markdown, pageCount }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } else {
      // Single image OCR via Mistral
      const imgMime = mimeType ?? "image/png";
      const response = await fetch("https://api.mistral.ai/v1/ocr", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mistralKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mistral-ocr-latest",
          document: {
            type: "image_url",
            image_url: `data:${imgMime};base64,${image}`,
          },
        }),
        signal: AbortSignal.timeout(55_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return errorResponse(502, `Mistral OCR error (${response.status}): ${text}`);
      }

      const result = await response.json() as any;
      const pages = result.pages ?? [];
      const markdown = pages.map((p: any) => p.markdown ?? "").join("\n\n");

      return new Response(
        JSON.stringify({ markdown }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(500, `OCR processing failed: ${msg}`);
  }
}
