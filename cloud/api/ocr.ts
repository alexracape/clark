/**
 * OCR Proxy — sends PDFs/images to Mistral OCR API and returns markdown.
 *
 * When `extractImages` is true, embedded images are extracted and returned
 * alongside markdown. Image references in the markdown are transformed to
 * Obsidian wikilink format: `![[img-0.jpg]]`.
 */

import { authenticate, requireTier } from "../lib/auth.js";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.js";
import { errorResponse, methodNotAllowed } from "../lib/errors.js";

const ocrLimiter = createRateLimiter(10, "60 s");

export interface OCRImage {
  /** Image reference ID (e.g. "img-0.jpg") */
  id: string;
  /** Raw base64 image data (no data URI prefix) */
  data: string;
  /** MIME type (e.g. "image/jpeg") */
  mediaType: string;
}

/**
 * Transform Mistral's markdown image references to Obsidian wikilink format.
 * Converts `![img-0.jpeg](img-0.jpeg)` → `![[img-0.jpeg]]`
 */
function toObsidianImageLinks(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, _alt, src) => {
    return `![[${src}]]`;
  });
}

/**
 * Parse a data URI and return raw base64 + mediaType.
 * Handles `data:image/jpeg;base64,<data>` format.
 */
function parseDataUri(dataUri: string): { data: string; mediaType: string } {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mediaType: match[1]!, data: match[2]! };
  }
  // Fallback: treat entire string as raw base64
  return { mediaType: "image/jpeg", data: dataUri };
}

/**
 * Collect images from all pages, deduplicating by ID.
 */
function collectImages(pages: any[]): OCRImage[] {
  const images: OCRImage[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    if (!Array.isArray(page.images)) continue;
    for (const img of page.images) {
      if (!img.id || seen.has(img.id)) continue;
      seen.add(img.id);

      const { data, mediaType } = img.image_base64
        ? parseDataUri(img.image_base64)
        : { data: "", mediaType: "image/jpeg" };

      if (data) {
        images.push({ id: img.id, data, mediaType });
      }
    }
  }

  return images;
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const tierCheck = requireTier("beta", auth);
    if (tierCheck) return tierCheck;

    const rateLimited = await checkRateLimit(ocrLimiter, auth.clientId);
    if (rateLimited) return rateLimited;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }

    const { pdf, image, mimeType, extractImages } = body;
    if (!pdf && !image) {
      return errorResponse(400, "Missing required field: pdf or image");
    }

    const mistralKey = process.env.MISTRAL_API_KEY;
    if (!mistralKey) {
      return errorResponse(500, "Server misconfigured: missing MISTRAL_API_KEY");
    }

    try {
      // Build Mistral OCR request
      const document = pdf
        ? { type: "document_url", document_url: `data:application/pdf;base64,${pdf}` }
        : { type: "image_url", image_url: `data:${mimeType ?? "image/png"};base64,${image}` };

      const mistralBody: any = {
        model: "mistral-ocr-latest",
        document,
      };

      if (extractImages) {
        mistralBody.include_image_base64 = true;
      }

      const response = await fetch("https://api.mistral.ai/v1/ocr", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${mistralKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mistralBody),
        signal: AbortSignal.timeout(55_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return errorResponse(502, `Mistral OCR error (${response.status}): ${text}`);
      }

      const result = await response.json() as any;
      const pages = result.pages ?? [];

      // Join page markdown
      let markdown = pages.map((p: any) => p.markdown ?? "").join("\n\n");

      // Build response
      const responseBody: any = { pageCount: pages.length };

      if (extractImages) {
        // Transform image references to Obsidian format
        markdown = toObsidianImageLinks(markdown);
        responseBody.images = collectImages(pages);
      }

      responseBody.markdown = markdown;

      return new Response(
        JSON.stringify(responseBody),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(500, `OCR processing failed: ${msg}`);
    }
  },
};
