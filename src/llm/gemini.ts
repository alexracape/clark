/**
 * Google Gemini LLM provider.
 */

import {
  GoogleGenAI,
  type Content,
  type Part,
  type FunctionDeclaration,
} from "@google/genai";
import {
  type LLMProvider,
  type Message,
  type Tool,
  type StreamChunk,
  registerProvider,
} from "./provider.ts";

const DEFAULT_MODEL = "gemini-2.5-flash";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly supportsVision = true;

  private client: GoogleGenAI;
  private model: string;

  constructor(model?: string) {
    this.client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    this.model = model ?? process.env.CLARK_MODEL ?? DEFAULT_MODEL;
  }

  async *chat(
    messages: Message[],
    tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk> {
    const contents = messagesToGeminiContents(messages);

    const geminiTools: FunctionDeclaration[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: "OBJECT" as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([key, param]) => [
            key,
            {
              type: param.type.toUpperCase(),
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
            },
          ]),
        ),
        required: t.parameters.required ?? [],
      },
    }));

    const stream = await this.client.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        ...(geminiTools.length > 0
          ? { tools: [{ functionDeclarations: geminiTools }] }
          : {}),
      },
    });

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;

      for (const part of candidate.content.parts) {
        if (part.text) {
          yield { type: "text_delta", text: part.text };
        }

        if (part.functionCall) {
          const callId = `gemini-${part.functionCall.name}-${Date.now()}`;
          yield {
            type: "tool_use_start",
            id: callId,
            name: part.functionCall.name!,
          };
          yield {
            type: "tool_input_delta",
            id: callId,
            input: JSON.stringify(part.functionCall.args ?? {}),
          };
        }
      }

      const finishReason = candidate.finishReason;
      if (finishReason === "STOP" || finishReason === "MAX_TOKENS") {
        const hasToolCalls = candidate.content.parts.some(
          (p) => p.functionCall,
        );
        yield {
          type: "done",
          stopReason: hasToolCalls
            ? "tool_use"
            : finishReason === "MAX_TOKENS"
              ? "max_tokens"
              : "end_turn",
        };
      }
    }
  }
}

/**
 * Map Clark internal messages to Gemini Content[] format.
 *
 * Gemini uses "user" and "model" roles (not "assistant").
 * Tool results are sent as user messages with functionResponse parts.
 */
export function messagesToGeminiContents(messages: Message[]): Content[] {
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const parts: Part[] = [];
      for (const c of msg.content) {
        if (c.type === "text") {
          parts.push({ text: c.text });
        } else if (c.type === "image") {
          parts.push({
            inlineData: {
              data: c.data,
              mimeType: c.mediaType,
            },
          });
        }
      }
      contents.push({ role: "user", parts });
    } else if (msg.role === "assistant") {
      const parts: Part[] = [];
      for (const c of msg.content) {
        if (c.type === "text") {
          parts.push({ text: c.text });
        } else if (c.type === "tool_use") {
          parts.push({
            functionCall: {
              name: c.name,
              args: c.input as Record<string, unknown>,
            },
          });
        }
      }
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      const parts: Part[] = [];
      for (const c of msg.content) {
        if (c.type === "tool_result") {
          parts.push({
            functionResponse: {
              name: c.toolUseId,
              response: {
                result: typeof c.content === "string" ? c.content : "[image]",
              },
            },
          });
        }
      }
      contents.push({ role: "user", parts });
    }
  }

  return contents;
}

// Register this provider
registerProvider("gemini", (model?) => new GeminiProvider(model));
