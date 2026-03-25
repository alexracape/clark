/**
 * LLM Chat Proxy — streams responses from Anthropic/OpenAI/Google via AI SDK.
 *
 * Accepts Clark's message format, routes to the correct provider,
 * and streams back StreamChunk events as SSE.
 */

import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { authenticate } from "../lib/auth.ts";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.ts";
import { errorResponse, methodNotAllowed } from "../lib/errors.ts";

const chatLimiter = createRateLimiter(30, "60 s");

/**
 * Map a model ID to the underlying provider name.
 * e.g., "claude-sonnet-4-6" → "anthropic", "gpt-4.1-mini" → "openai"
 */
function inferProvider(model: string): string {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt")) return "openai";
  if (model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai";
  if (model.startsWith("gemini")) return "google";
  throw new Error(`Cannot infer provider for model: ${model}`);
}

function getModel(provider: string, model: string) {
  switch (provider) {
    case "anthropic":
      return anthropic(model);
    case "openai":
      return openai(model);
    case "google":
      return google(model);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Convert Clark's Message[] format to AI SDK CoreMessage[] format.
 */
function convertMessages(messages: any[]): any[] {
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
            mimeType: c.mediaType,
          });
          break;
        case "tool_use":
          parts.push({
            type: "tool-call",
            toolCallId: c.id,
            toolName: c.name,
            args: c.input,
          });
          break;
        case "tool_result":
          parts.push({
            type: "tool-result",
            toolCallId: c.toolUseId,
            result: typeof c.content === "string" ? c.content : JSON.stringify(c.content),
            isError: c.isError ?? false,
          });
          break;
        // Skip thinking content — ephemeral
      }
    }

    return { role, content: parts };
  });
}

/**
 * Convert Clark's Tool[] format to AI SDK tool definitions.
 */
function convertTools(tools: any[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      parameters: tool.parameters,
    };
  }
  return result;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();

  // Auth
  const auth = authenticate(req);
  if (!auth.ok) return auth.response;

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
    const provider = body.provider ?? inferProvider(model);
    const aiModel = getModel(provider, model);
    const convertedMessages = convertMessages(messages);
    const convertedTools = tools?.length ? convertTools(tools) : undefined;

    const result = streamText({
      model: aiModel,
      messages: convertedMessages,
      system: systemPrompt,
      ...(convertedTools ? { tools: convertedTools } : {}),
      maxTokens: body.maxTokens ?? 4096,
    });

    // Stream response as SSE in Clark's StreamChunk format
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let currentToolCallId = "";

          for await (const part of result.fullStream) {
            let chunk: string | null = null;

            switch (part.type) {
              case "text-delta":
                chunk = JSON.stringify({ type: "text_delta", text: part.textDelta });
                break;
              case "reasoning":
                chunk = JSON.stringify({ type: "thinking_delta", text: part.textDelta });
                break;
              case "tool-call-streaming-start":
                currentToolCallId = part.toolCallId;
                chunk = JSON.stringify({
                  type: "tool_use_start",
                  id: part.toolCallId,
                  name: part.toolName,
                });
                break;
              case "tool-call-delta":
                chunk = JSON.stringify({
                  type: "tool_input_delta",
                  id: currentToolCallId,
                  input: part.argsTextDelta,
                });
                break;
              case "finish":
                chunk = JSON.stringify({
                  type: "done",
                  stopReason: part.finishReason === "tool-calls"
                    ? "tool_use"
                    : part.finishReason === "length"
                      ? "max_tokens"
                      : "end_turn",
                });
                break;
            }

            if (chunk) {
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
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
        "X-Clark-Provider": body.provider ?? inferProvider(model),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(500, msg);
  }
}
