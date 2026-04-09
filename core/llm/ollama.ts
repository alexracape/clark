/**
 * Ollama LLM provider — local model support.
 */

import { Ollama } from "ollama";
import { totalmem } from "node:os";
import {
  type LLMProvider,
  type Message,
  type Tool,
  type StreamChunk,
  registerProvider,
} from "./provider.ts";

/** Check if an error is an Ollama connection failure */
function isConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code;
  return (
    code === "ConnectionRefused" ||
    message.includes("ECONNREFUSED") ||
    message.includes("fetch failed") ||
    message.includes("Unable to connect")
  );
}

/**
 * List models available on the local Ollama server.
 *
 * @returns Array of model names and sizes, or throws if Ollama isn't reachable.
 */
export async function listLocalModels(
  client?: Ollama,
): Promise<Array<{ name: string; size: number }>> {
  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const ollama = client ?? new Ollama({ host });

  try {
    const list = await ollama.list();
    return list.models.map((m) => ({ name: m.name, size: m.size }));
  } catch (err: unknown) {
    if (isConnectionError(err)) {
      throw new Error("not-running");
    }
    throw err;
  }
}

/**
 * Check whether a model's size fits comfortably in system RAM.
 *
 * Uses Ollama's `show` endpoint to get the model size on disk, which
 * for GGUF models closely approximates runtime RAM usage. We compare
 * against total system RAM and warn or throw accordingly.
 *
 * Also detects vision capability from model families.
 *
 * @returns The model size in bytes, RAM info, and vision support.
 * @throws If Ollama is unreachable, the model isn't pulled, or it exceeds total RAM.
 */
export async function checkModelFits(
  modelName: string,
  client?: Ollama,
): Promise<{ sizeBytes: number; totalRam: number; pct: number; supportsVision: boolean }> {
  const ollama = client ?? new Ollama();

  let modelInfo;
  try {
    modelInfo = await ollama.show({ model: modelName });
  } catch (err: unknown) {
    if (isConnectionError(err)) {
      const host = ollama.config?.host ?? "http://localhost:11434";
      throw new Error(
        `Cannot connect to Ollama at ${host}.\n` +
          `  Start it with:  ollama serve\n` +
          `  Install:        brew install ollama`,
      );
    }
    throw new Error(
      `Model "${modelName}" not found locally.\n` +
        `  Pull it with:   ollama pull ${modelName}\n` +
        `  List available: ollama list`,
    );
  }

  // Detect vision support from model families
  const families: string[] = (modelInfo.details as any)?.families ?? [];
  const supportsVision = families.some(
    (f) => f === "clip" || f === "mllama",
  );

  // Get model size from the list endpoint (show doesn't include size directly)
  let modelSizeBytes = 0;
  try {
    const list = await ollama.list();
    const entry = list.models.find(
      (m) => m.name === modelName || m.name === `${modelName}:latest`,
    );
    if (entry) {
      modelSizeBytes = entry.size;
    }
  } catch {
    // If list fails, fall back to parameter_size heuristic
  }

  // Fallback: estimate from parameter_size (e.g. "7B" → ~4GB at Q4)
  if (modelSizeBytes === 0 && modelInfo.details?.parameter_size) {
    const match = modelInfo.details.parameter_size.match(/([\d.]+)([BM])/i);
    if (match) {
      const num = parseFloat(match[1]!);
      const unit = match[2]!.toUpperCase();
      const params = unit === "B" ? num * 1e9 : num * 1e6;
      // Q4 quantization ≈ 0.5 bytes per parameter
      modelSizeBytes = Math.round(params * 0.5);
    }
  }

  const totalRam = totalmem();
  const pct = modelSizeBytes / totalRam;

  if (modelSizeBytes > totalRam) {
    const sizeGB = (modelSizeBytes / 1e9).toFixed(1);
    const ramGB = (totalRam / 1e9).toFixed(1);
    throw new Error(
      `Model "${modelName}" (${sizeGB} GB) exceeds total system RAM (${ramGB} GB).\n` +
        `  Try a smaller model: ollama pull llama3.2\n` +
        `  List available:      ollama list`,
    );
  }

  return { sizeBytes: modelSizeBytes, totalRam, pct, supportsVision };
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly supportsVision: boolean;

  private client: Ollama;
  private model: string;
  private maxTokens: number | undefined;

  constructor(model: string, supportsVision = false, maxTokens?: number) {
    const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.client = new Ollama({ host });
    this.model = model;
    this.supportsVision = supportsVision;
    this.maxTokens = maxTokens;
  }

  async *chat(
    messages: Message[],
    tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk> {
    const ollamaMessages: Array<{
      role: string;
      content: string;
      images?: string[];
      tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
    }> = [{ role: "system", content: systemPrompt }];

    for (const msg of messages) {
      if (msg.role === "user") {
        let text = "";
        const images: string[] = [];
        for (const c of msg.content) {
          if (c.type === "text") text += c.text;
          if (c.type === "image") images.push(c.data);
        }
        ollamaMessages.push({
          role: "user",
          content: text,
          ...(images.length > 0 ? { images } : {}),
        });
      } else if (msg.role === "assistant") {
        let text = "";
        const toolCalls: Array<{
          function: { name: string; arguments: Record<string, unknown> };
        }> = [];
        for (const c of msg.content) {
          if (c.type === "text") text += c.text;
          if (c.type === "tool_use") {
            toolCalls.push({
              function: { name: c.name, arguments: c.input },
            });
          }
          // Skip thinking content
        }
        ollamaMessages.push({
          role: "assistant",
          content: text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      } else if (msg.role === "tool") {
        for (const c of msg.content) {
          if (c.type === "tool_result") {
            ollamaMessages.push({
              role: "tool",
              content: typeof c.content === "string" ? c.content : c.content.map((img) => img.data).join(""),
            });
          }
        }
      }
    }

    const ollamaTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const stream = await this.client.chat({
      model: this.model,
      messages: ollamaMessages,
      ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
      ...(this.maxTokens ? { options: { num_predict: this.maxTokens } } : {}),
      stream: true,
    });
    yield { type: "start" };
    yield { type: "start-step" };

    // State for parsing <think>...</think> tags from deepseek-r1 style models
    let inThinkBlock = false;
    let buffer = "";
    let nextTextId = 0;
    let nextReasoningId = 0;
    let activeTextId: string | null = null;
    let activeReasoningId: string | null = null;

    const openText = () => {
      const isNew = activeTextId === null;
      if (activeTextId === null) {
        activeTextId = `text-${nextTextId++}`;
      }
      return { id: activeTextId, isNew } as { id: string; isNew: boolean };
    };

    const openReasoning = () => {
      const isNew = activeReasoningId === null;
      if (activeReasoningId === null) {
        activeReasoningId = `reasoning-${nextReasoningId++}`;
      }
      return { id: activeReasoningId, isNew } as { id: string; isNew: boolean };
    };

    for await (const chunk of stream) {
      // Text content — parse <think> tags
      if (chunk.message?.content) {
        buffer += chunk.message.content;

        while (buffer.length > 0) {
          if (inThinkBlock) {
            const closeIdx = buffer.indexOf("</think>");
            if (closeIdx === -1) {
              // Still inside think block, emit all buffered as thinking
              const reasoning = openReasoning();
              if (reasoning.isNew) {
                yield { type: "reasoning-start", id: reasoning.id };
              }
              yield { type: "reasoning-delta", id: reasoning.id, text: buffer };
              buffer = "";
            } else {
              // Emit content before closing tag as thinking
              if (closeIdx > 0) {
                const reasoning = openReasoning();
                if (reasoning.isNew) {
                  yield { type: "reasoning-start", id: reasoning.id };
                }
                yield {
                  type: "reasoning-delta",
                  id: reasoning.id,
                  text: buffer.slice(0, closeIdx),
                };
              }
              if (activeReasoningId !== null) {
                yield { type: "reasoning-end", id: activeReasoningId };
                activeReasoningId = null;
              }
              buffer = buffer.slice(closeIdx + "</think>".length);
              inThinkBlock = false;
            }
          } else {
            const openIdx = buffer.indexOf("<think>");
            if (openIdx === -1) {
              // No think tag — emit all as text
              const text = openText();
              if (text.isNew) {
                yield { type: "text-start", id: text.id };
              }
              yield { type: "text-delta", id: text.id, text: buffer };
              buffer = "";
            } else {
              // Emit content before opening tag as text
              if (openIdx > 0) {
                const text = openText();
                if (text.isNew) {
                  yield { type: "text-start", id: text.id };
                }
                yield {
                  type: "text-delta",
                  id: text.id,
                  text: buffer.slice(0, openIdx),
                };
              }
              if (activeTextId !== null) {
                yield { type: "text-end", id: activeTextId };
                activeTextId = null;
              }
              buffer = buffer.slice(openIdx + "<think>".length);
              inThinkBlock = true;
            }
          }
        }
      }

      // Tool calls (Ollama sends them in a single chunk, not streamed)
      if (chunk.message?.tool_calls) {
        for (const tc of chunk.message.tool_calls) {
          const callId = `ollama-${tc.function.name}-${Date.now()}`;
          yield {
            type: "tool-call",
            toolCallId: callId,
            toolName: tc.function.name,
            input: tc.function.arguments,
          };
        }
      }

      // Done
      if (chunk.done) {
        // Flush any remaining buffer
        if (buffer.length > 0) {
          if (inThinkBlock) {
            const reasoning = openReasoning();
            if (reasoning.isNew) {
              yield { type: "reasoning-start", id: reasoning.id };
            }
            yield { type: "reasoning-delta", id: reasoning.id, text: buffer };
          } else {
            const text = openText();
            if (text.isNew) {
              yield { type: "text-start", id: text.id };
            }
            yield { type: "text-delta", id: text.id, text: buffer };
          }
          buffer = "";
        }
        if (activeReasoningId !== null) {
          yield { type: "reasoning-end", id: activeReasoningId };
          activeReasoningId = null;
        }
        if (activeTextId !== null) {
          yield { type: "text-end", id: activeTextId };
          activeTextId = null;
        }

        const hasToolCalls = !!chunk.message?.tool_calls?.length;
        const finishReason = hasToolCalls
          ? "tool_use"
          : chunk.done_reason === "length"
            ? "max_tokens"
            : "end_turn";
        yield { type: "finish-step", finishReason };
        yield { type: "finish", finishReason };
      }
    }
  }
}

// Register this provider
registerProvider("ollama", (model?, options?) => {
  if (!model) {
    throw new Error(
      "Ollama requires a model name. Use /model to pick one, or set CLARK_MODEL.",
    );
  }
  return new OllamaProvider(model, options?.supportsVision, options?.maxTokens);
});
