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

      const result = streamText({
        model: gateway(gatewayModelId),
        messages: convertedMessages,
        system: systemPrompt,
        ...(Object.keys(allTools).length > 0 ? { tools: allTools } : {}),
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
                case "text-delta":
                  chunk = JSON.stringify({ type: "text_delta", text: part.text });
                  break;
                case "reasoning-delta":
                  chunk = JSON.stringify({ type: "thinking_delta", text: part.text });
                  break;
                case "tool-input-start": {
                  streamedToolIds.add(part.id);
                  const startChunk: any = {
                    type: "tool_use_start",
                    id: part.id,
                    name: part.toolName,
                  };
                  if (part.providerMetadata) {
                    startChunk.providerMetadata = part.providerMetadata;
                  }
                  chunk = JSON.stringify(startChunk);
                  break;
                }
                case "tool-input-delta":
                  chunk = JSON.stringify({
                    type: "tool_input_delta",
                    id: part.id,
                    input: part.delta,
                  });
                  break;
                case "tool-call": {
                  // Skip if already streamed via tool-input-start/delta
                  if (streamedToolIds.has(part.toolCallId)) break;
                  // Non-streaming tool call — emit start + input as a single pair
                  const tcStart: any = {
                    type: "tool_use_start",
                    id: part.toolCallId,
                    name: part.toolName,
                  };
                  if (part.providerMetadata) {
                    tcStart.providerMetadata = part.providerMetadata;
                  }
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(tcStart)}\n\n`),
                  );
                  chunk = JSON.stringify({
                    type: "tool_input_delta",
                    id: part.toolCallId,
                    input: JSON.stringify(part.input),
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
                case "finish":
                  chunk = JSON.stringify({
                    type: "done",
                    stopReason: part.finishReason === "tool-calls"
                      ? "tool_use"
                      : part.finishReason === "length"
                        ? "max_tokens"
                        : "end_turn",
                  });
                  if (isDevLoggingEnabled()) {
                    logDevEvent("chat_stream_finished", {
                      finishReason: part.finishReason,
                    });
                  }
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
