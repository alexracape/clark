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

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly supportsVision = true;

  private client: Anthropic;
  private model: string;

  constructor(model?: string) {
    this.client = new Anthropic();
    this.model = model ?? process.env.CLARK_MODEL ?? DEFAULT_MODEL;
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
        }
      }),
    }));

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
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
        }
      } else if (event.type === "message_stop") {
        const finalMessage = await stream.finalMessage();
        yield {
          type: "done",
          stopReason: finalMessage.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        };
      }
    }
  }
}

// Register this provider
registerProvider("anthropic", (model?) => new AnthropicProvider(model));
