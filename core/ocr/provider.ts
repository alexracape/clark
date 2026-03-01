/**
 * Pluggable OCR provider abstraction.
 *
 * Default implementation uses the LLM's vision API. The interface allows
 * swapping in a purpose-built OCR model (e.g., Deepseek-OCR) later.
 */

import type { LLMProvider, Message } from "../llm/provider.ts";

export interface OCRProvider {
  readonly name: string;
  /**
   * Transcribe a single image to markdown text.
   * @param imageBuffer - Raw image bytes
   * @param mimeType - MIME type (e.g., "image/png")
   */
  transcribeImage(imageBuffer: ArrayBuffer, mimeType: string): Promise<string>;
  /**
   * Consolidate a multi-page transcript by removing duplicates and merging content.
   * @param rawTranscript - The raw page-by-page transcript
   */
  consolidateTranscript(rawTranscript: string): Promise<string>;
}

const TRANSCRIPTION_SYSTEM_PROMPT =
  "You are a document transcription assistant. Output only the transcribed content in markdown format.";

const TRANSCRIPTION_USER_PROMPT =
  "Transcribe this document to markdown. Preserve the structure including headings, bullet points, and formatting. Format math expressions in LaTeX. If there are diagrams or figures, describe them briefly in italics. Do not copy over page numbers.";

const CONSOLIDATION_SYSTEM_PROMPT =
  "You are a document consolidation assistant. Your task is to merge multi-page transcriptions into a single coherent document.";

const CONSOLIDATION_USER_PROMPT = `The following is a page-by-page transcription of a document. Please consolidate it by:
1. Removing duplicate headers, footers, and navigation elements that repeat across pages
2. Merging content into a cohesive flow without page breaks
3. Preserving all unique content and maintaining the logical structure
4. Keeping the markdown formatting (headings, lists, math, etc.)

Output only the consolidated markdown content.

---

`;

/**
 * OCR provider that delegates to the LLM's vision API.
 */
export class VisionOCRProvider implements OCRProvider {
  readonly name = "vision-llm";

  constructor(private llmProvider: LLMProvider) {
    if (!llmProvider.supportsVision) {
      throw new Error(
        `LLM provider "${llmProvider.name}" does not support vision. ` +
          "Switch to a vision-capable provider (Anthropic, OpenAI, or Gemini) to use OCR.",
      );
    }
  }

  async transcribeImage(
    imageBuffer: ArrayBuffer,
    mimeType: string,
  ): Promise<string> {
    const base64 = Buffer.from(imageBuffer).toString("base64");
    const mediaType = mimeType as "image/png" | "image/jpeg" | "image/webp";

    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "image", data: base64, mediaType },
          { type: "text", text: TRANSCRIPTION_USER_PROMPT },
        ],
      },
    ];

    let result = "";
    for await (const chunk of this.llmProvider.chat(
      messages,
      [],
      TRANSCRIPTION_SYSTEM_PROMPT,
    )) {
      if (chunk.type === "text_delta") result += chunk.text;
    }
    return result;
  }

  async consolidateTranscript(rawTranscript: string): Promise<string> {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: CONSOLIDATION_USER_PROMPT + rawTranscript },
        ],
      },
    ];

    let result = "";
    for await (const chunk of this.llmProvider.chat(
      messages,
      [],
      CONSOLIDATION_SYSTEM_PROMPT,
    )) {
      if (chunk.type === "text_delta") result += chunk.text;
    }
    return result;
  }
}
