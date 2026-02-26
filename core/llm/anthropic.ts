/**
 * Anthropic (Claude) LLM provider.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  type LLMProvider,
  type Message,
  type Tool,
  type StreamChunk,
  registerProvider,
} from "./provider.ts";
import { getDefaultModelForProvider } from "./catalog.ts";

const DEFAULT_MODEL = getDefaultModelForProvider("anthropic") ?? "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 4096;
const THINKING_BUDGET = 10000;

/** Models that support extended thinking */
function supportsThinking(model: string): boolean {
  return (
    model.includes("claude-3-5-sonnet") ||
    model.includes("claude-sonnet-4") ||
    model.includes("claude-4") ||
    model.includes("claude-opus")
  );
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly supportsVision = true;

  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(model?: string, apiKey?: string, maxTokens?: number) {
    this.client = new Anthropic(apiKey ? { apiKey } : undefined);
    this.model = model ?? process.env.CLARK_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async *chat(
    messages: Message[],
    tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk> {
    const anthropicMessages = messages.map((msg) => ({
      role: msg.role === "tool" ? ("user" as const) : (msg.role as "user" | "assistant"),
      content: msg.content.map((c) => {
        switch (c.type) {
          case "text":
            return { type: "text" as const, text: c.text };
          case "image":
            return {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: c.mediaType,
                data: c.data,
              },
            };
          case "tool_use":
            return {
              type: "tool_use" as const,
              id: c.id,
              name: c.name,
              input: c.input,
            };
          case "tool_result":
            return {
              type: "tool_result" as const,
              tool_use_id: c.toolUseId,
              content: typeof c.content === "string" ? c.content : c.content.map((img) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: img.mediaType,
                  data: img.data,
                },
              })),
              is_error: c.isError,
            };
          default:
            // Skip thinking content — it's ephemeral
            return { type: "text" as const, text: "" };
        }
      }).filter((c) => c.type !== "text" || c.text !== ""),
    }));

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));

    const useThinking = supportsThinking(this.model);
    const maxTokens = useThinking
      ? Math.max(this.maxTokens, THINKING_BUDGET + 1)
      : this.maxTokens;

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: anthropicMessages,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      ...(useThinking ? { thinking: { type: "enabled", budget_tokens: THINKING_BUDGET } } : {}),
    });

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          yield {
            type: "tool_use_start",
            id: event.content_block.id,
            name: event.content_block.name,
          };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          yield {
            type: "tool_input_delta",
            id: "",
            input: event.delta.partial_json,
          };
        } else if (event.delta.type === "thinking_delta") {
          yield { type: "thinking_delta", text: (event.delta as any).thinking };
        }
      } else if (event.type === "message_stop") {
        const finalMessage = await stream.finalMessage();
        const stopReason = finalMessage.stop_reason === "tool_use"
          ? "tool_use"
          : finalMessage.stop_reason === "max_tokens"
            ? "max_tokens"
            : "end_turn";
        yield { type: "done", stopReason };
      }
    }
  }
}

// Register this provider
registerProvider("anthropic", (model, options) => new AnthropicProvider(model, options?.apiKey, options?.maxTokens));
