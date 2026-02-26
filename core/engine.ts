/**
 * UI-agnostic conversation engine.
 *
 * Owns the conversation turn loop (stream LLM → dispatch tools → loop).
 * Both the CLI (Ink TUI) and GUI (Tauri) drive this engine via callbacks.
 */

import type { Conversation } from "./llm/messages.ts";
import type { LLMProvider, StreamChunk, Tool } from "./llm/provider.ts";
import type { ToolDefinition, ToolResult } from "./mcp/tools.ts";

type VisionMediaType = "image/png" | "image/jpeg" | "image/webp";

/** Events emitted during a conversation turn */
export interface TurnCallbacks {
  onStreamingText?: (text: string) => void;
  onStreamingThinking?: (text: string) => void;
  onStreamingDone?: () => void;
  onAssistantMessage?: (text: string) => void;
  onToolStart?: (name: string) => void;
  onSystemMessage?: (text: string) => void;
}

/** Convert MCP tool definitions to LLM tool format */
export function toLLMTools(tools: ToolDefinition[]): Tool[] {
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    parameters: inputSchema,
  }));
}

export function normalizeVisionMediaType(
  value: string | undefined,
): VisionMediaType | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === "image/png") return "image/png";
  if (lower === "image/jpeg" || lower === "image/jpg") return "image/jpeg";
  if (lower === "image/webp") return "image/webp";
  return null;
}

export class ConversationEngine {
  conversation: Conversation;
  private tools: ToolDefinition[];
  private systemPrompt: string;
  private maxToolCallsPerTurn: number;

  constructor(opts: {
    conversation: Conversation;
    tools: ToolDefinition[];
    systemPrompt: string;
    maxToolCallsPerTurn?: number;
  }) {
    this.conversation = opts.conversation;
    this.tools = opts.tools;
    this.systemPrompt = opts.systemPrompt;
    this.maxToolCallsPerTurn = opts.maxToolCallsPerTurn ?? 20;
  }

  /** Update tools (e.g. after provider change affects OCR) */
  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
  }

  /** Update system prompt */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Run a full conversation turn: stream LLM → dispatch tools → loop.
   * Provider is passed per-call since it can change at runtime.
   */
  async runTurn(
    provider: LLMProvider,
    callbacks?: TurnCallbacks,
    promptOverride?: string,
  ): Promise<void> {
    try {
      let continueLoop = true;
      let toolCallsUsed = 0;

      while (continueLoop) {
        const { chunks, text } = await this.streamLLM(
          provider,
          callbacks,
          promptOverride,
        );
        const stopReason = [...chunks]
          .reverse()
          .find((c) => c.type === "done")?.stopReason;

        // Collect the assistant message content
        const assistantContent =
          this.conversation.collectStreamResponse(chunks);
        this.conversation.addAssistantMessage(assistantContent);

        // Check if there are tool calls
        const toolUses = assistantContent.filter(
          (c) => c.type === "tool_use",
        );

        if (toolUses.length === 0) {
          // No tool calls — show the final text and stop
          if (text) callbacks?.onAssistantMessage?.(text);
          if (stopReason === "max_tokens") {
            callbacks?.onSystemMessage?.(
              'Response was truncated due to max_tokens limit. Set "maxTokens" in ~/.clark/config.json to increase.',
            );
          }
          continueLoop = false;
        } else {
          // Show any text before tool calls
          if (text) callbacks?.onAssistantMessage?.(text);

          if (toolCallsUsed + toolUses.length > this.maxToolCallsPerTurn) {
            const msg = `Stopped: max tool calls per turn reached (${this.maxToolCallsPerTurn}).`;
            callbacks?.onSystemMessage?.(msg);
            for (const toolUse of toolUses) {
              if (toolUse.type !== "tool_use") continue;
              this.conversation.addToolResult(toolUse.id, msg, true);
            }
            continueLoop = false;
            continue;
          }

          // Dispatch each tool call
          for (const toolUse of toolUses) {
            if (toolUse.type !== "tool_use") continue;

            callbacks?.onToolStart?.(toolUse.name);

            const result = await this.dispatchTool(toolUse.name, toolUse.input);
            this.processToolResult(provider, toolUse, result);
            toolCallsUsed++;
          }

          // Loop: send tool results back to the LLM
        }
      }
    } catch (err) {
      callbacks?.onStreamingDone?.();
      const msg = err instanceof Error ? err.message : String(err);
      callbacks?.onSystemMessage?.(`Error: ${msg}`);
    }
  }

  /**
   * Stream the LLM, calling callbacks with text deltas.
   * Returns the collected chunks and full text when done.
   */
  private async streamLLM(
    provider: LLMProvider,
    callbacks?: TurnCallbacks,
    promptOverride?: string,
  ): Promise<{ chunks: StreamChunk[]; text: string }> {
    const llmTools = toLLMTools(this.tools);
    const chunks: StreamChunk[] = [];
    let text = "";
    let thinking = "";
    const effectivePrompt = promptOverride ?? this.systemPrompt;

    callbacks?.onStreamingText?.("");

    for await (const chunk of provider.chat(
      this.conversation.getMessages(),
      llmTools,
      effectivePrompt,
    )) {
      chunks.push(chunk);
      if (chunk.type === "thinking_delta") {
        thinking += chunk.text;
        callbacks?.onStreamingThinking?.(thinking);
      } else if (chunk.type === "text_delta") {
        text += chunk.text;
        callbacks?.onStreamingText?.(text);
      }
    }

    callbacks?.onStreamingDone?.();
    return { chunks, text };
  }

  /** Dispatch a tool call and return the result. */
  private async dispatchTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    return tool.handler(input);
  }

  /** Process a tool result: handle images for Anthropic vs other providers. */
  private processToolResult(
    provider: LLMProvider,
    toolUse: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> },
    result: ToolResult,
  ): void {
    const resultText = result.content
      .filter(
        (c): c is { type: "text"; text: string } => c.type === "text",
      )
      .map((c) => c.text)
      .join("\n");

    const rawImageBlocks = result.content.filter(
      (
        c,
      ): c is {
        type: "image";
        data: string;
        mimeType?: string;
        mediaType?: string;
      } => c.type === "image",
    );
    const imageBlocks = rawImageBlocks
      .map((img) => ({
        data: img.data,
        mediaType: normalizeVisionMediaType(
          img.mediaType ?? img.mimeType,
        ),
      }))
      .filter(
        (img): img is { data: string; mediaType: VisionMediaType } =>
          img.mediaType !== null,
      );
    const droppedImageTypes = rawImageBlocks
      .map((img) => img.mediaType ?? img.mimeType)
      .filter(
        (t): t is string =>
          !!t && normalizeVisionMediaType(t) === null,
      );
    const resultTextWithWarnings =
      droppedImageTypes.length > 0
        ? `${resultText}${resultText ? "\n\n" : ""}[Skipped ${droppedImageTypes.length} unsupported image tool result(s): ${[...new Set(droppedImageTypes)].join(", ")}]`
        : resultText;

    if (
      imageBlocks.length > 0 &&
      provider.name === "anthropic"
    ) {
      // Anthropic supports images natively in tool results
      this.conversation.addToolResultWithImage(
        toolUse.id,
        imageBlocks.map((img) => ({
          data: img.data,
          mediaType: img.mediaType,
        })),
      );
    } else {
      // Text-only tool result for all providers
      this.conversation.addToolResult(
        toolUse.id,
        resultTextWithWarnings,
        result.isError,
      );

      // Re-inject images as a follow-up user message for non-Anthropic providers
      if (
        imageBlocks.length > 0 &&
        provider.name !== "anthropic"
      ) {
        for (const img of imageBlocks) {
          this.conversation.addUserImageMessage(
            `[Image from tool: ${toolUse.name}]`,
            img.data,
            img.mediaType,
          );
        }
      }
    }
  }
}
