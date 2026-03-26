/**
 * Cloud OCR provider — routes OCR requests through the Clark Cloud proxy.
 *
 * Supports both single-image OCR and full-PDF OCR via Mistral.
 * For PDFs, the entire file is sent as base64 — no poppler dependency needed.
 */

import type { OCRProvider } from "./provider.ts";

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
   */
  async transcribePDF(pdfBuffer: ArrayBuffer): Promise<{ markdown: string; pageCount: number }> {
    const base64 = Buffer.from(pdfBuffer).toString("base64");

    const res = await fetch(`${this.cloudUrl}/api/ocr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clark-Client-Id": this.clientId,
      },
      body: JSON.stringify({ pdf: base64 }),
      signal: AbortSignal.timeout(120_000), // PDFs can be large
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloud OCR error (${res.status}): ${text}`);
    }

    return await res.json() as { markdown: string; pageCount: number };
  }

  async consolidateTranscript(rawTranscript: string): Promise<string> {
    // Mistral OCR produces consolidated output — pass through
    return rawTranscript;
  }
}
