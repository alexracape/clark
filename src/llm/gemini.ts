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
  private maxTokens: number | undefined;

  constructor(model?: string, apiKey?: string, maxTokens?: number) {
    this.client = new GoogleGenAI({ apiKey: apiKey ?? process.env.GOOGLE_API_KEY });
    this.model = model ?? process.env.CLARK_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = maxTokens;
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
        ...(this.maxTokens ? { maxOutputTokens: this.maxTokens } : {}),
        ...(geminiTools.length > 0
          ? { tools: [{ functionDeclarations: geminiTools }] }
          : {}),
      },
    });

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;

      for (const part of candidate.content.parts) {
        // Gemini 2.5 thinking parts
        if ((part as any).thought === true && part.text) {
          yield { type: "thinking_delta", text: part.text };
          continue;
        }

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
 * Builds a toolUseId → toolName map from assistant messages to resolve
 * function names in tool results (Gemini requires the function name, not the ID).
 */
export function messagesToGeminiContents(messages: Message[]): Content[] {
  const contents: Content[] = [];

  // Build a map of toolUseId → toolName from assistant tool_use blocks
  const toolNameMap = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const c of msg.content) {
        if (c.type === "tool_use") {
          toolNameMap.set(c.id, c.name);
        }
      }
    }
  }

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
        // Skip thinking content
      }
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      const parts: Part[] = [];
      for (const c of msg.content) {
        if (c.type === "tool_result") {
          const functionName = toolNameMap.get(c.toolUseId) ?? c.toolUseId;
          parts.push({
            functionResponse: {
              name: functionName,
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
registerProvider("gemini", (model, options) => new GeminiProvider(model, options?.apiKey, options?.maxTokens));
