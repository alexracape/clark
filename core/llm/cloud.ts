/**
 * Cloud LLM provider — routes chat requests through the Clark Cloud proxy.
 *
 * The proxy handles all provider-specific logic (streaming protocols,
 * thinking tokens, tool call formats) via the Vercel AI Gateway.
 * This provider is a thin SSE consumer that yields the same StreamChunk
 * types the engine expects.
 *
 * Model IDs use the Gateway "provider/model" format
 * (e.g. "anthropic/claude-sonnet-4.6"). Legacy bare IDs are supported
 * for backward compatibility.
 */

import type {
  LLMProvider,
  Message,
  Tool,
  StreamChunk,
} from "./provider.ts";
import { registerProvider } from "./provider.ts";
import { extractProvider, DEFAULT_CLOUD_MODEL } from "./catalog.ts";
import { DEFAULT_CLOUD_URL, normalizeCloudUrl } from "../config.ts";

/**
 * Ensure a model ID is in Gateway "provider/model" format.
 * Handles legacy bare model IDs from older configs.
 */
function toGatewayModelId(model: string): string {
  if (model.includes("/")) return model;
  // Legacy bare model ID — infer provider
  if (model.startsWith("claude")) return `anthropic/${model}`;
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return `openai/${model}`;
  if (model.startsWith("gemini")) return `google/${model}`;
  if (model.startsWith("grok")) return `xai/${model}`;
  return `anthropic/${model}`; // default fallback
}

export class CloudLLMProvider implements LLMProvider {
  /**
   * Returns the underlying provider name (e.g., "anthropic"), not "clark-cloud".
   * This is critical for engine.ts image tool result handling.
   */
  readonly name: string;
  readonly supportsVision = true;

  /** The full Gateway model ID, e.g. "anthropic/claude-sonnet-4.6" */
  readonly gatewayModelId: string;

  constructor(
    private cloudUrl: string,
    private clientId: string,
    model: string,
  ) {
    this.gatewayModelId = toGatewayModelId(model);
    this.name = extractProvider(this.gatewayModelId);
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
        model: this.gatewayModelId,
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
            const parsed = JSON.parse(data) as { type?: string; error?: string };
            if (parsed.type === "error") {
              throw new Error(`Cloud proxy stream error: ${parsed.error}`);
            }
            yield parsed as StreamChunk;
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
  const cloudUrl = normalizeCloudUrl(options?.cloudUrl)
    ?? normalizeCloudUrl(process.env.CLARK_CLOUD_URL)
    ?? DEFAULT_CLOUD_URL;
  const clientId = options?.apiKey ?? ""; // clientId is passed via the apiKey option slot

  const resolvedModel = model ?? DEFAULT_CLOUD_MODEL;
  return new CloudLLMProvider(cloudUrl, clientId, resolvedModel);
});
