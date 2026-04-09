/**
 * LLM Chat Proxy — streams responses via the Vercel AI Gateway.
 *
 * Accepts Clark's message format, routes to the correct provider through
 * the Gateway, and streams back StreamChunk events as SSE.
 *
 * Model IDs use the Gateway format: "provider/model" (e.g. "anthropic/claude-sonnet-4.6").
 * Legacy bare model IDs (e.g. "claude-sonnet-4-6") are auto-prefixed for
 * backward compatibility.
 */

import { streamText, gateway, jsonSchema } from "ai";
import { authenticate, requireTier } from "../lib/auth.js";
import { hashClientId, logDevEvent, isDevLoggingEnabled } from "../lib/dev-logging.js";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.js";
import { errorResponse, methodNotAllowed } from "../lib/errors.js";
import { logCloudError } from "../lib/logging.js";

const chatLimiter = createRateLimiter(30, "60 s");
const UPSTREAM_TIMEOUT_MS = 25_000;

/**
 * Ensure model ID is in Gateway "provider/model" format.
 * Handles legacy bare model IDs from older clients.
 */
function toGatewayModelId(model: string, provider?: string): string {
  // Already in gateway format
  if (model.includes("/")) return model;

  // Infer provider from legacy model ID
  const p = provider ?? inferProviderFromLegacyId(model);
  return `${p}/${model}`;
}

function inferProviderFromLegacyId(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini")) return "google";
  if (model.startsWith("grok")) return "xai";
  throw new Error(`Cannot infer provider for model: ${model}`);
}

function toStopReason(reason: string | undefined): "end_turn" | "tool_use" | "max_tokens" {
  if (reason === "tool-calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end_turn";
}

function supportsAnthropicThinking(model: string): boolean {
  return model.startsWith("anthropic/claude-opus-4")
    || model.startsWith("anthropic/claude-sonnet-4");
}

/**
 * Convert Clark's Message[] format to AI SDK v6 ModelMessage[] format.
 */
function convertMessages(messages: any[]): any[] {
  // Build toolCallId → toolName map from tool_use blocks
  const toolNameMap = new Map<string, string>();
  for (const msg of messages) {
    for (const c of msg.content) {
      if (c.type === "tool_use") {
        toolNameMap.set(c.id, c.name);
      }
    }
  }

  return messages.map((msg) => {
    const role = msg.role === "tool" ? "tool" : msg.role;
    const parts: any[] = [];

    for (const c of msg.content) {
      switch (c.type) {
        case "text":
          parts.push({ type: "text", text: c.text });
          break;
        case "image":
          parts.push({
            type: "image",
            image: c.data,
            mediaType: c.mediaType,
          });
          break;
        case "tool_use": {
          const toolCall: any = {
            type: "tool-call",
            toolCallId: c.id,
            toolName: c.name,
            input: c.input,
          };
          if (c.providerMetadata) {
            toolCall.providerOptions = c.providerMetadata;
          }
          parts.push(toolCall);
          break;
        }
        case "tool_result": {
          let output: any;
          if (c.isError) {
            const text = typeof c.content === "string"
              ? c.content
              : JSON.stringify(c.content);
            output = { type: "error-text", value: text };
          } else if (Array.isArray(c.content)) {
            // Image-bearing tool results (e.g., read_canvas snapshots)
            output = {
              type: "content",
              value: c.content.map((item: any) =>
                item.type === "image"
                  ? { type: "media", data: item.data, mediaType: item.mediaType }
                  : { type: "text", text: item.text ?? JSON.stringify(item) }
              ),
            };
          } else {
            output = { type: "text", value: c.content };
          }
          parts.push({
            type: "tool-result",
            toolCallId: c.toolUseId,
            toolName: toolNameMap.get(c.toolUseId) ?? "unknown",
            output,
          });
          break;
        }
        // Skip thinking content — ephemeral
      }
    }

    return { role, content: parts };
  });
}

/** Convert Clark's Tool[] format to AI SDK v6 tool definitions. */
function convertTools(tools: any[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.inputSchema),
    };
  }
  return result;
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed();

    // Auth
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const tierCheck = requireTier("beta", auth);
    if (tierCheck) return tierCheck;

    // Rate limit
    const rateLimited = await checkRateLimit(chatLimiter, auth.clientId);
    if (rateLimited) return rateLimited;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }

    const { model, messages, tools, systemPrompt } = body;
    if (!model || !messages) {
      return errorResponse(400, "Missing required fields: model, messages");
    }

    try {
      const gatewayModelId = toGatewayModelId(model, body.provider);
      const convertedMessages = convertMessages(messages);
      const convertedTools = tools?.length ? convertTools(tools) : undefined;
      const providerName = gatewayModelId.split("/")[0] ?? "";
      const allTools = convertedTools ?? {};

      if (isDevLoggingEnabled()) {
        logDevEvent("chat_request", {
          clientIdHash: hashClientId(auth.clientId),
          model: gatewayModelId,
          provider: providerName,
          messageCount: messages.length,
          clientTools: tools?.map((t: any) => t.name) ?? [],
          resolvedTools: Object.keys(allTools),
          maxTokens: body.maxTokens ?? 4096,
        });
      }

      const providerOptions = providerName === "anthropic"
        && supportsAnthropicThinking(gatewayModelId)
        ? {
            anthropic: {
              // Request surfaced thinking parts for supported Claude models.
              thinking: { type: "enabled", budgetTokens: 4096 },
            },
          }
        : undefined;

      const result = streamText({
        model: gateway(gatewayModelId),
        messages: convertedMessages,
        system: systemPrompt,
        ...(Object.keys(allTools).length > 0 ? { tools: allTools } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        maxOutputTokens: body.maxTokens ?? 4096,
        abortSignal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      // Stream response as SSE in Clark's StreamChunk format
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Track tool IDs that were already streamed via tool-input-start
            // to avoid duplicates when tool-call fires after streaming
            const streamedToolIds = new Set<string>();

            for await (const part of result.fullStream) {
              let chunk: string | null = null;

              switch (part.type) {
                case "start":
                  chunk = JSON.stringify({ type: "start" });
                  break;
                case "start-step":
                  chunk = JSON.stringify({ type: "start-step" });
                  break;
                case "text-start":
                  chunk = JSON.stringify({
                    type: "text-start",
                    id: part.id,
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                case "text-delta":
                  chunk = JSON.stringify({
                    type: "text-delta",
                    id: part.id,
                    text: part.text,
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                case "text-end":
                  chunk = JSON.stringify({
                    type: "text-end",
                    id: part.id,
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                case "reasoning-start":
                  chunk = JSON.stringify({
                    type: "reasoning-start",
                    id: part.id,
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                case "reasoning-delta":
                  chunk = JSON.stringify({
                    type: "reasoning-delta",
                    id: part.id,
                    text: part.text,
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                case "reasoning-end":
                  chunk = JSON.stringify({
                    type: "reasoning-end",
                    id: part.id,
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                case "tool-input-start": {
                  streamedToolIds.add(part.id);
                  const startChunk: any = {
                    type: "tool-input-start",
                    id: part.id,
                    toolName: part.toolName,
                  };
                  if (part.providerMetadata) {
                    startChunk.providerMetadata = part.providerMetadata;
                  }
                  chunk = JSON.stringify(startChunk);
                  break;
                }
                case "tool-input-delta":
                  chunk = JSON.stringify({
                    type: "tool-input-delta",
                    id: part.id,
                    delta: part.delta,
                  });
                  break;
                case "tool-input-end":
                  chunk = JSON.stringify({
                    type: "tool-input-end",
                    id: part.id,
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                case "tool-call": {
                  // Skip if already streamed via tool-input-start/delta
                  if (streamedToolIds.has(part.toolCallId)) break;
                  chunk = JSON.stringify({
                    type: "tool-call",
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    input: part.input,
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                }
                case "error": {
                  logCloudError("chat_upstream_error_part", {
                    endpoint: "/api/chat",
                    clientId: auth.clientId,
                    request: {
                      model: gatewayModelId,
                      messageCount: messages.length,
                      toolCount: Object.keys(allTools).length,
                    },
                    error: part.error,
                  });
                  const msg = part.error instanceof Error
                    ? part.error.message
                    : JSON.stringify(part.error);
                  chunk = JSON.stringify({ type: "error", error: msg });
                  break;
                }
                case "finish-step":
                  chunk = JSON.stringify({
                    type: "finish-step",
                    finishReason: toStopReason(part.finishReason),
                    ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}),
                  });
                  break;
                case "finish":
                  chunk = JSON.stringify({
                    type: "finish",
                    finishReason: toStopReason(part.finishReason),
                  });
                  if (isDevLoggingEnabled()) {
                    logDevEvent("chat_stream_finished", {
                      finishReason: part.finishReason,
                    });
                  }
                  break;
                case "abort":
                  chunk = JSON.stringify({
                    type: "abort",
                    ...(part.reason ? { reason: part.reason } : {}),
                  });
                  break;
              }

              if (chunk) {
                controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logCloudError("chat_stream_failed", {
              endpoint: "/api/chat",
              clientId: auth.clientId,
              request: {
                model: gatewayModelId,
                messageCount: messages.length,
                toolCount: Object.keys(allTools).length,
              },
              error: err,
            });
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`),
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Clark-Model": gatewayModelId,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logCloudError("chat_handler_failed", {
        endpoint: "/api/chat",
        clientId: auth.clientId,
        request: {
          model,
          messageCount: Array.isArray(messages) ? messages.length : undefined,
          toolCount: Array.isArray(tools) ? tools.length : undefined,
        },
        error: err,
      });
      return errorResponse(500, msg);
    }
  },
};
