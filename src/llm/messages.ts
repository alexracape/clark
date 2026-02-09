/**
 * Conversation history management.
 *
 * Handles message accumulation, tool result pairing,
 * and context window limits.
 */

import type { Message, MessageContent, StreamChunk } from "./provider.ts";

export class Conversation {
  private messages: Message[] = [];

  /** Add a user text message */
  addUserMessage(text: string) {
    this.messages.push({
      role: "user",
      content: [{ type: "text", text }],
    });
  }

  /** Add a user message with image (e.g., canvas snapshot) */
  addUserImageMessage(text: string, imageBase64: string, mediaType: "image/png" | "image/jpeg" | "image/webp" = "image/png") {
    const content: MessageContent[] = [
      { type: "text", text },
      { type: "image", data: imageBase64, mediaType },
    ];
    this.messages.push({ role: "user", content });
  }

  /** Add a complete assistant message (text + tool uses) */
  addAssistantMessage(content: MessageContent[]) {
    this.messages.push({ role: "assistant", content });
  }

  /** Add a tool result */
  addToolResult(toolUseId: string, result: string, isError = false) {
    this.messages.push({
      role: "tool",
      content: [{ type: "tool_result", toolUseId, content: result, isError }],
    });
  }

  /** Add a tool result with image content */
  addToolResultWithImage(toolUseId: string, images: Array<{ data: string; mediaType: "image/png" | "image/jpeg" | "image/webp" }>) {
    this.messages.push({
      role: "tool",
      content: [{
        type: "tool_result",
        toolUseId,
        content: images.map(img => ({ type: "image" as const, data: img.data, mediaType: img.mediaType })),
      }],
    });
  }

  /** Collect stream chunks into a complete assistant message */
  collectStreamResponse(chunks: StreamChunk[]): MessageContent[] {
    const content: MessageContent[] = [];
    let currentToolInput = "";
    let currentToolId = "";
    let currentToolName = "";

    for (const chunk of chunks) {
      switch (chunk.type) {
        case "text_delta":
          // Merge consecutive text deltas
          const last = content[content.length - 1];
          if (last?.type === "text") {
            last.text += chunk.text;
          } else {
            content.push({ type: "text", text: chunk.text });
          }
          break;
        case "tool_use_start":
          // Flush any pending tool
          if (currentToolId) {
            content.push({
              type: "tool_use",
              id: currentToolId,
              name: currentToolName,
              input: JSON.parse(currentToolInput || "{}"),
            });
          }
          currentToolId = chunk.id;
          currentToolName = chunk.name;
          currentToolInput = "";
          break;
        case "tool_input_delta":
          currentToolInput += chunk.input;
          break;
        case "done":
          // Flush final tool if pending
          if (currentToolId) {
            content.push({
              type: "tool_use",
              id: currentToolId,
              name: currentToolName,
              input: JSON.parse(currentToolInput || "{}"),
            });
          }
          break;
      }
    }

    return content;
  }

  /** Get all messages for sending to the LLM */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /** Clear all messages */
  clear() {
    this.messages = [];
  }

  /** Get message count */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Estimate token counts broken down by category.
   * Uses a rough 4-chars-per-token heuristic.
   */
  estimateContext(): ContextBreakdown {
    let userTokens = 0;
    let assistantTokens = 0;
    let toolTokens = 0;
    let imageCount = 0;

    for (const msg of this.messages) {
      for (const part of msg.content) {
        if (part.type === "text") {
          const tokens = estimateTokens(part.text);
          if (msg.role === "user") userTokens += tokens;
          else if (msg.role === "assistant") assistantTokens += tokens;
        } else if (part.type === "image") {
          imageCount++;
          // Images cost ~1600 tokens for vision APIs
          if (msg.role === "user") userTokens += 1600;
        } else if (part.type === "tool_use") {
          toolTokens += estimateTokens(JSON.stringify(part.input));
        } else if (part.type === "tool_result") {
          const resultText = typeof part.content === "string"
            ? part.content
            : JSON.stringify(part.content);
          toolTokens += estimateTokens(resultText);
        }
      }
    }

    return {
      userTokens,
      assistantTokens,
      toolTokens,
      imageCount,
      totalTokens: userTokens + assistantTokens + toolTokens,
      messageCount: this.messages.length,
    };
  }

  /**
   * Compact the conversation by replacing older messages with a summary.
   * Keeps the most recent `keepRecent` message pairs and replaces everything
   * before that with a single user message containing the summary.
   */
  compact(summary: string, keepRecent = 4) {
    if (this.messages.length <= keepRecent) return;
    const kept = this.messages.slice(-keepRecent);
    this.messages = [
      { role: "user", content: [{ type: "text", text: `[Previous conversation summary]\n${summary}` }] },
      ...kept,
    ];
  }
}

export interface ContextBreakdown {
  userTokens: number;
  assistantTokens: number;
  toolTokens: number;
  imageCount: number;
  totalTokens: number;
  messageCount: number;
}

/** Rough token estimate: ~4 characters per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
