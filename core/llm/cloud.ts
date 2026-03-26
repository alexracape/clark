/**
 * Cloud LLM provider — routes chat requests through the Clark Cloud proxy.
 *
 * The proxy handles all provider-specific logic (streaming protocols,
 * thinking tokens, tool call formats) via the Vercel AI SDK server-side.
 * This provider is a thin SSE consumer that yields the same StreamChunk
 * types the engine expects.
 */

import type {
  LLMProvider,
  Message,
  Tool,
  StreamChunk,
} from "./provider.ts";
import { registerProvider } from "./provider.ts";

/**
 * Map a model ID to the underlying provider name.
 * This determines what `provider.name` returns, which matters for
 * engine.ts image handling (checks `provider.name === "anthropic"`).
 */
function inferProviderName(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini")) return "google";
  return "anthropic"; // default fallback
}

export class CloudLLMProvider implements LLMProvider {
  /**
   * Returns the underlying provider name (e.g., "anthropic"), not "clark-cloud".
   * This is critical for engine.ts image tool result handling.
   */
  readonly name: string;
  readonly supportsVision = true;

  constructor(
    private cloudUrl: string,
    private clientId: string,
    private provider: string,
    private model: string,
  ) {
    this.name = provider;
  }

  async *chat(
    messages: Message[],
    tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk> {
    const res = await fetch(`${this.cloudUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clark-Client-Id": this.clientId,
      },
      body: JSON.stringify({
        provider: this.provider,
        model: this.model,
        messages,
        tools,
        systemPrompt,
      }),
      signal: AbortSignal.timeout(120_000), // 2 minute timeout for long responses
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloud proxy error (${res.status}): ${text}`);
    }

    if (!res.body) {
      throw new Error("Cloud proxy returned empty response body");
    }

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!; // Keep incomplete last line in buffer

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const chunk = JSON.parse(data) as StreamChunk & { type: string; error?: string };
            if (chunk.type === "error") {
              throw new Error(`Cloud proxy stream error: ${chunk.error}`);
            }
            yield chunk as StreamChunk;
          } catch (err) {
            if (err instanceof SyntaxError) continue; // Skip malformed JSON
            throw err;
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6).trim();
        if (data) {
          try {
            const chunk = JSON.parse(data) as StreamChunk;
            yield chunk;
          } catch {
            // Ignore trailing incomplete data
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// Register the cloud provider
registerProvider("clark-cloud", (model, options) => {
  const cloudUrl = process.env.CLARK_CLOUD_URL ?? "https://clark-cloud.vercel.app";
  const clientId = options?.apiKey ?? ""; // clientId is passed via the apiKey option slot

  const resolvedModel = model ?? "claude-sonnet-4-6";
  const provider = inferProviderName(resolvedModel);

  return new CloudLLMProvider(cloudUrl, clientId, provider, resolvedModel);
});
