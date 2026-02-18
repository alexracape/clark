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
}

const TRANSCRIPTION_SYSTEM_PROMPT =
  "You are a document transcription assistant. Output only the transcribed content in markdown format.";

const TRANSCRIPTION_USER_PROMPT =
  "Transcribe this document to markdown. Preserve the structure including headings, bullet points, and formatting. Format math expressions in LaTeX. If there are diagrams or figures, describe them briefly in brackets.";

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

  async transcribeImage(imageBuffer: ArrayBuffer, mimeType: string): Promise<string> {
    const base64 = Buffer.from(imageBuffer).toString("base64");
    const mediaType = mimeType as "image/png" | "image/jpeg" | "image/webp";

    const messages: Message[] = [{
      role: "user",
      content: [
        { type: "image", data: base64, mediaType },
        { type: "text", text: TRANSCRIPTION_USER_PROMPT },
      ],
    }];

    let result = "";
    for await (const chunk of this.llmProvider.chat(messages, [], TRANSCRIPTION_SYSTEM_PROMPT)) {
      if (chunk.type === "text_delta") result += chunk.text;
    }
    return result;
  }
}
