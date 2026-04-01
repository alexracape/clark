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
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { authenticate, requireTier } from "../lib/auth.ts";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.ts";
import { errorResponse, methodNotAllowed } from "../lib/errors.ts";

const chatLimiter = createRateLimiter(30, "60 s");
const UPSTREAM_TIMEOUT_MS = 25_000;

/** Enable verbose request logging during local development (vercel dev). */
const DEV_LOGGING = process.env.VERCEL_ENV === "development" || process.env.NODE_ENV === "development";

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
          const text = typeof c.content === "string"
            ? c.content
            : JSON.stringify(c.content);
          parts.push({
            type: "tool-result",
            toolCallId: c.toolUseId,
            toolName: toolNameMap.get(c.toolUseId) ?? "unknown",
            output: c.isError
              ? { type: "error-text", value: text }
              : { type: "text", value: text },
          });
          break;
        }
        // Skip thinking content — ephemeral
      }
    }

    return { role, content: parts };
  });
}

/**
 * Convert Clark's Tool[] format to AI SDK v6 tool definitions.
 * If the tool list contains "websearch", it is removed from the converted
 * tools — native provider search is injected separately in the streamText call.
 */
function convertTools(tools: any[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const tool of tools) {
    if (tool.name === "websearch") continue; // handled by injectWebSearchTool
    result[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.inputSchema),
    };
  }
  return result;
}

/**
 * Returns native provider web search tools based on the model's provider,
 * plus the set of tool names that are handled server-side (should not be
 * forwarded to the client for local dispatch).
 */
function getWebSearchTools(provider: string): {
  tools: Record<string, any>;
  nativeToolNames: Set<string>;
} {
  let tools: Record<string, any>;
  switch (provider) {
    case "anthropic":
      tools = { web_search: anthropic.tools.webSearch_20250305() };
      break;
    case "openai":
      tools = { web_search: openai.tools.webSearch({}) };
      break;
    case "google":
      tools = { google_search: google.tools.googleSearch({}) };
      break;
    default:
      tools = { perplexity_search: gateway.tools.perplexitySearch() };
      break;
  }
  return { tools, nativeToolNames: new Set(Object.keys(tools)) };
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

      // Inject native web search tools if the client sent a "websearch" tool
      const hasWebSearch = tools?.some((t: any) => t.name === "websearch");
      const providerName = gatewayModelId.split("/")[0] ?? "";
      const { tools: webSearchTools, nativeToolNames } = hasWebSearch
        ? getWebSearchTools(providerName)
        : { tools: {}, nativeToolNames: new Set<string>() };

      const allTools = { ...convertedTools, ...webSearchTools };

      if (DEV_LOGGING) {
        const clientToolNames = tools?.map((t: any) => t.name) ?? [];
        const nativeNames = [...nativeToolNames];
        console.log("[chat] request", {
          clientId: auth.clientId,
          model: gatewayModelId,
          provider: providerName,
          messageCount: messages.length,
          clientTools: clientToolNames,
          hasWebSearch,
          ...(hasWebSearch ? { nativeSearchTools: nativeNames } : {}),
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
            // Track tool IDs belonging to native provider tools (web search etc.)
            // These are handled server-side and should not be forwarded to the client.
            const nativeToolIds = new Set<string>();

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
                  // Skip native provider tools — they're fulfilled server-side
                  if (nativeToolNames.has(part.toolName)) {
                    nativeToolIds.add(part.id);
                    if (DEV_LOGGING) {
                      console.log("[chat] native tool started (not forwarded)", {
                        tool: part.toolName,
                        id: part.id,
                      });
                    }
                    break;
                  }
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
                  // Skip deltas for native provider tools
                  if (nativeToolIds.has(part.id)) break;
                  chunk = JSON.stringify({
                    type: "tool_input_delta",
                    id: part.id,
                    input: part.delta,
                  });
                  break;
                case "tool-call": {
                  // Skip native provider tool calls
                  if (nativeToolNames.has(part.toolName)) {
                    nativeToolIds.add(part.toolCallId);
                    if (DEV_LOGGING) {
                      console.log("[chat] native tool call (not forwarded)", {
                        tool: part.toolName,
                        id: part.toolCallId,
                      });
                    }
                    break;
                  }
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
                  const msg = part.error instanceof Error
                    ? part.error.message
                    : JSON.stringify(part.error);
                  console.error("[chat] upstream error part", {
                    clientId: auth.clientId,
                    model: gatewayModelId,
                    error: msg,
                  });
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
                  if (DEV_LOGGING) {
                    console.log("[chat] stream finished", {
                      finishReason: part.finishReason,
                      nativeToolsUsed: nativeToolIds.size,
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
            console.error("[chat] stream failed", {
              clientId: auth.clientId,
              model: gatewayModelId,
              error: msg,
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
      console.error("[chat] handler failed", {
        clientId: auth.clientId,
        model,
        error: msg,
      });
      return errorResponse(500, msg);
    }
  },
};
