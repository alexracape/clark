/**
 * OpenAI LLM provider.
 */

import OpenAI from "openai";
import {
  type LLMProvider,
  type Message,
  type Tool,
  type StreamChunk,
  registerProvider,
} from "./provider.ts";

const DEFAULT_MODEL = "gpt-4o";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly supportsVision = true;

  private client: OpenAI;
  private model: string;

  constructor(model?: string) {
    this.client = new OpenAI();
    this.model = model ?? process.env.CLARK_MODEL ?? DEFAULT_MODEL;
  }

  async *chat(
    messages: Message[],
    tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk> {
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of messages) {
      if (msg.role === "assistant") {
        const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
        let textContent = "";

        for (const c of msg.content) {
          if (c.type === "text") textContent += c.text;
          if (c.type === "tool_use") {
            toolCalls.push({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.input) },
            });
          }
        }

        openaiMessages.push({
          role: "assistant",
          content: textContent || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      } else if (msg.role === "tool") {
        for (const c of msg.content) {
          if (c.type === "tool_result") {
            openaiMessages.push({
              role: "tool",
              tool_call_id: c.toolUseId,
              content: typeof c.content === "string" ? c.content : "[image]",
            });
          }
        }
      } else if (msg.role === "user") {
        const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
        for (const c of msg.content) {
          if (c.type === "text") {
            parts.push({ type: "text", text: c.text });
          } else if (c.type === "image") {
            parts.push({
              type: "image_url",
              image_url: {
                url: `data:${c.mediaType};base64,${c.data}`,
              },
            });
          }
        }
        openaiMessages.push({ role: "user", content: parts });
      }
    }

    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
      stream: true,
    });

    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: "text_delta", text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            toolCalls.set(tc.index, { id: tc.id, name: tc.function?.name ?? "", args: "" });
            yield { type: "tool_use_start", id: tc.id, name: tc.function?.name ?? "" };
          }
          if (tc.function?.arguments) {
            const existing = toolCalls.get(tc.index);
            if (existing) existing.args += tc.function.arguments;
            yield { type: "tool_input_delta", id: existing?.id ?? "", input: tc.function.arguments };
          }
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        yield {
          type: "done",
          stopReason: chunk.choices[0].finish_reason === "tool_calls" ? "tool_use" : "end_turn",
        };
      }
    }
  }
}

// Register this provider
registerProvider("openai", (model?) => new OpenAIProvider(model));
