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
    let currentToolMeta: Record<string, unknown> | undefined;
    const activeText = new Map<string, { type: "text"; text: string }>();
    const activeThinking = new Map<string, { type: "thinking"; text: string }>();

    const flushTool = () => {
      if (!currentToolId) return;
      const tool: MessageContent & { type: "tool_use" } = {
        type: "tool_use",
        id: currentToolId,
        name: currentToolName,
        input: JSON.parse(currentToolInput || "{}"),
      };
      if (currentToolMeta) tool.providerMetadata = currentToolMeta;
      content.push(tool);
      currentToolId = "";
      currentToolName = "";
      currentToolInput = "";
      currentToolMeta = undefined;
    };

    for (const chunk of chunks) {
      switch (chunk.type) {
        case "text-start": {
          flushTool();
          const part = { type: "text" as const, text: "" };
          content.push(part);
          activeText.set(chunk.id, part);
          break;
        }
        case "text-delta": {
          flushTool();
          const part = activeText.get(chunk.id)
            ?? (() => {
              const next = { type: "text" as const, text: "" };
              content.push(next);
              activeText.set(chunk.id, next);
              return next;
            })();
          part.text += chunk.text;
          break;
        }
        case "text-end":
          activeText.delete(chunk.id);
          break;
        case "reasoning-start": {
          flushTool();
          const part = { type: "thinking" as const, text: "" };
          content.push(part);
          activeThinking.set(chunk.id, part);
          break;
        }
        case "reasoning-delta": {
          flushTool();
          const part = activeThinking.get(chunk.id)
            ?? (() => {
              const next = { type: "thinking" as const, text: "" };
              content.push(next);
              activeThinking.set(chunk.id, next);
              return next;
            })();
          part.text += chunk.text;
          break;
        }
        case "reasoning-end":
          activeThinking.delete(chunk.id);
          break;
        case "tool-input-start":
          // Flush any pending tool
          flushTool();
          currentToolId = chunk.id;
          currentToolName = chunk.toolName;
          currentToolInput = "";
          currentToolMeta = chunk.providerMetadata;
          break;
        case "tool-input-delta":
          currentToolInput += chunk.delta;
          break;
        case "tool-input-end":
          flushTool();
          break;
        case "tool-call": {
          flushTool();
          const tool: MessageContent & { type: "tool_use" } = {
            type: "tool_use",
            id: chunk.toolCallId,
            name: chunk.toolName,
            input: chunk.input,
          };
          if (chunk.providerMetadata) tool.providerMetadata = chunk.providerMetadata;
          content.push(tool);
          break;
        }
        case "finish":
        case "abort":
          // Flush final tool if pending
          flushTool();
          break;
      }
    }

    return content;
  }

  /** Get all messages for sending to the LLM (filters out ephemeral thinking content) */
  getMessages(): Message[] {
    return this.messages.map((msg) => {
      const filtered = msg.content.filter((c) => c.type !== "thinking");
      if (filtered.length === msg.content.length) return msg;
      return { ...msg, content: filtered };
    });
  }

  /** Clear all messages */
  clear() {
    this.messages = [];
  }

  /** Load a set of messages (e.g. from a resumed session). Replaces current history. */
  loadMessages(messages: Message[]) {
    this.messages = [...messages];
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
    let thinkingTokens = 0;
    let imageCount = 0;

    for (const msg of this.messages) {
      for (const part of msg.content) {
        if (part.type === "thinking") {
          thinkingTokens += estimateTokens(part.text);
        } else if (part.type === "text") {
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
      thinkingTokens,
      imageCount,
      totalTokens: userTokens + assistantTokens + toolTokens + thinkingTokens,
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
  thinkingTokens: number;
  imageCount: number;
  totalTokens: number;
  messageCount: number;
}

/** Rough token estimate: ~4 characters per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
