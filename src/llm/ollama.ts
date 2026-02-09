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
 * @returns The model size in bytes (for informational use).
 * @throws If Ollama is unreachable, the model isn't pulled, or it exceeds total RAM.
 */
export async function checkModelFits(
  modelName: string,
  client?: Ollama,
): Promise<{ sizeBytes: number; totalRam: number; pct: number }> {
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

  return { sizeBytes: modelSizeBytes, totalRam, pct };
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly supportsVision = true;

  private client: Ollama;
  private model: string;

  constructor(model: string) {
    const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.client = new Ollama({ host });
    this.model = model;
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
              content: typeof c.content === "string" ? c.content : "[image]",
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
        parameters: t.parameters,
      },
    }));

    const stream = await this.client.chat({
      model: this.model,
      messages: ollamaMessages,
      ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
      stream: true,
    });

    for await (const chunk of stream) {
      // Text content
      if (chunk.message?.content) {
        yield { type: "text_delta", text: chunk.message.content };
      }

      // Tool calls (Ollama sends them in a single chunk, not streamed)
      if (chunk.message?.tool_calls) {
        for (const tc of chunk.message.tool_calls) {
          const callId = `ollama-${tc.function.name}-${Date.now()}`;
          yield { type: "tool_use_start", id: callId, name: tc.function.name };
          yield {
            type: "tool_input_delta",
            id: callId,
            input: JSON.stringify(tc.function.arguments),
          };
        }
      }

      // Done
      if (chunk.done) {
        const hasToolCalls = !!chunk.message?.tool_calls?.length;
        yield {
          type: "done",
          stopReason: hasToolCalls
            ? "tool_use"
            : chunk.done_reason === "length"
              ? "max_tokens"
              : "end_turn",
        };
      }
    }
  }
}

// Register this provider
registerProvider("ollama", (model?) => {
  if (!model) {
    throw new Error(
      "Ollama requires a model name. Use /model to pick one, or set CLARK_MODEL.",
    );
  }
  return new OllamaProvider(model);
});
