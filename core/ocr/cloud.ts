/**
 * Cloud OCR provider — routes OCR requests through the Clark Cloud proxy.
 *
 * Supports both single-image OCR and full-PDF OCR via Mistral.
 * For PDFs, the entire file is sent as base64 — no poppler dependency needed.
 * When extractImages is true, embedded images are returned alongside markdown
 * with Obsidian-format wikilinks (![[img-0.jpg]]).
 */

import type { OCRProvider } from "./provider.ts";

export interface ExtractedImage {
  /** Image reference ID (e.g. "img-0.jpg") */
  id: string;
  /** Raw base64 image data (no data URI prefix) */
  data: string;
  /** MIME type (e.g. "image/jpeg") */
  mediaType: string;
}

export interface CloudPDFResult {
  markdown: string;
  pageCount: number;
  images: ExtractedImage[];
}

export class CloudOCRProvider implements OCRProvider {
  readonly name = "clark-cloud-ocr";

  constructor(
    private cloudUrl: string,
    private clientId: string,
  ) {}

  async transcribeImage(imageBuffer: ArrayBuffer, mimeType: string): Promise<string> {
    const base64 = Buffer.from(imageBuffer).toString("base64");

    const res = await fetch(`${this.cloudUrl}/api/ocr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clark-Client-Id": this.clientId,
      },
      body: JSON.stringify({ image: base64, mimeType }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloud OCR error (${res.status}): ${text}`);
    }

    const result = await res.json() as { markdown: string };
    return result.markdown;
  }

  /**
   * Transcribe a full PDF without poppler — Mistral handles page rendering.
   * When extractImages is true, embedded images are extracted and returned
   * with Obsidian-format wikilinks in the markdown.
   */
  async transcribePDF(
    pdfBuffer: ArrayBuffer,
    opts?: { extractImages?: boolean },
  ): Promise<CloudPDFResult> {
    const base64 = Buffer.from(pdfBuffer).toString("base64");

    const res = await fetch(`${this.cloudUrl}/api/ocr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clark-Client-Id": this.clientId,
      },
      body: JSON.stringify({
        pdf: base64,
        extractImages: opts?.extractImages ?? false,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloud OCR error (${res.status}): ${text}`);
    }

    const result = await res.json() as CloudPDFResult;
    return {
      markdown: result.markdown,
      pageCount: result.pageCount,
      images: result.images ?? [],
    };
  }

  async consolidateTranscript(rawTranscript: string): Promise<string> {
    // Mistral OCR produces consolidated output — pass through
    return rawTranscript;
  }
}
