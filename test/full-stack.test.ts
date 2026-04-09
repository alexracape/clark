/**
 * Full-stack integration test — no real LLM calls.
 *
 * Tests the complete path: raw SSE bytes → CloudLLMProvider parsing →
 * ConversationEngine orchestration → real tool dispatch → conversation state.
 *
 * A "fake cloud" Bun server emits deterministic SSE responses based on
 * inspecting the request body. This catches bugs at every integration seam
 * without calling any LLM API.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { CloudLLMProvider } from "../core/llm/cloud.ts";
import { ConversationEngine, toLLMTools } from "../core/engine.ts";
import { Conversation } from "../core/llm/messages.ts";
import { createTools } from "../core/mcp/tools.ts";
import type { StreamChunk } from "../core/llm/provider.ts";
import type { TurnCallbacks } from "../core/engine.ts";
import type { Server } from "bun";

const TEST_VAULT = resolve(import.meta.dir, "test_vault");

const tools = createTools({
  getBroker: () => null,
  vaultDir: TEST_VAULT,
  getSaveCanvas: () => null,
});

/** Encode a StreamChunk as an SSE data line */
function sse(chunk: StreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/** Build a complete SSE text-only response */
function textResponse(text: string): string {
  const lines = [
    sse({ type: "start" }),
    sse({ type: "start-step" }),
    sse({ type: "text-start", id: "text-0" }),
  ];
  // Stream text in small chunks like a real provider
  for (let i = 0; i < text.length; i += 12) {
    lines.push(sse({ type: "text-delta", id: "text-0", text: text.slice(i, i + 12) }));
  }
  lines.push(
    sse({ type: "text-end", id: "text-0" }),
    sse({ type: "finish-step", finishReason: "end_turn" }),
    sse({ type: "finish", finishReason: "end_turn" }),
  );
  return lines.join("");
}

/** Build an SSE response that requests a tool call */
function toolCallResponse(toolName: string, input: Record<string, unknown>, id = "tc1", prefixText?: string): string {
  const lines = [
    sse({ type: "start" }),
    sse({ type: "start-step" }),
  ];
  if (prefixText) {
    lines.push(
      sse({ type: "text-start", id: "text-0" }),
      sse({ type: "text-delta", id: "text-0", text: prefixText }),
      sse({ type: "text-end", id: "text-0" }),
    );
  }
  // Stream tool input as deltas (like a real provider would)
  const inputJson = JSON.stringify(input);
  lines.push(sse({ type: "tool-input-start", id, toolName }));
  for (let i = 0; i < inputJson.length; i += 15) {
    lines.push(sse({ type: "tool-input-delta", id, delta: inputJson.slice(i, i + 15) }));
  }
  lines.push(
    sse({ type: "tool-input-end", id }),
    sse({ type: "finish-step", finishReason: "tool_use" }),
    sse({ type: "finish", finishReason: "tool_use" }),
  );
  return lines.join("");
}

/** Build an SSE response with reasoning before text */
function reasoningResponse(thinking: string, text: string): string {
  const lines = [
    sse({ type: "start" }),
    sse({ type: "start-step" }),
    sse({ type: "reasoning-start", id: "r-0" }),
  ];
  for (let i = 0; i < thinking.length; i += 10) {
    lines.push(sse({ type: "reasoning-delta", id: "r-0", text: thinking.slice(i, i + 10) }));
  }
  lines.push(sse({ type: "reasoning-end", id: "r-0" }));
  lines.push(sse({ type: "text-start", id: "text-0" }));
  for (let i = 0; i < text.length; i += 12) {
    lines.push(sse({ type: "text-delta", id: "text-0", text: text.slice(i, i + 12) }));
  }
  lines.push(
    sse({ type: "text-end", id: "text-0" }),
    sse({ type: "finish-step", finishReason: "end_turn" }),
    sse({ type: "finish", finishReason: "end_turn" }),
  );
  return lines.join("");
}

// --- Fake cloud server ---

let server: Server;
let baseUrl: string;

/** Track how many requests the fake cloud received */
let requestCount: number;

/** Swappable response logic — each test configures this */
let respondToRequest: (body: any) => string;

beforeAll(() => {
  requestCount = 0;

  server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      requestCount++;
      const body = await req.json();
      const sseText = respondToRequest(body);

      return new Response(sseText, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

/** Collect callback events */
function trackCallbacks() {
  const events: Array<{ type: string; value?: string; order: number }> = [];
  let counter = 0;
  const callbacks: TurnCallbacks = {
    onStreamingText: (t) => events.push({ type: "streaming_text", value: t, order: counter++ }),
    onStreamingThinking: (t) => events.push({ type: "streaming_thinking", value: t, order: counter++ }),
    onStreamingDone: () => events.push({ type: "streaming_done", order: counter++ }),
    onAssistantMessage: (t) => events.push({ type: "assistant", value: t, order: counter++ }),
    onToolStart: (name) => events.push({ type: "tool_start", value: name, order: counter++ }),
    onToolResult: (name) => events.push({ type: "tool_result", value: name, order: counter++ }),
    onSystemMessage: (msg) => events.push({ type: "system", value: msg, order: counter++ }),
  };
  return { events, callbacks };
}

describe("Full-Stack Integration", () => {
  test("text-only turn through real SSE parsing and engine", async () => {
    respondToRequest = () => textResponse("Hello from the fake cloud!");
    requestCount = 0;

    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const conversation = new Conversation();
    const engine = new ConversationEngine({
      conversation,
      tools,
      systemPrompt: "You are a helpful tutor.",
    });
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("Hi there");
    await engine.runTurn(provider, callbacks);

    // One HTTP request
    expect(requestCount).toBe(1);

    // Final text should come through
    expect(events.some((e) => e.type === "assistant" && e.value === "Hello from the fake cloud!")).toBe(true);

    // Conversation state: user + assistant
    const messages = conversation.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
  });

  test("tool-using turn reads real file through full pipeline", async () => {
    requestCount = 0;

    respondToRequest = (body) => {
      const messages = body.messages as Array<{ role: string }>;
      const hasToolResult = messages.some((m) => m.role === "tool");

      if (!hasToolResult) {
        // First request: ask to read a real file
        return toolCallResponse("read_file", { path: "Notes/GRPO.md" }, "tc1", "Let me read that.");
      } else {
        // Second request: respond based on tool result
        return textResponse("GRPO stands for Group Relative Policy Optimization.");
      }
    };

    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const conversation = new Conversation();
    const engine = new ConversationEngine({
      conversation,
      tools,
      systemPrompt: "You are a helpful tutor.",
    });
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("What is GRPO?");
    await engine.runTurn(provider, callbacks);

    // Two HTTP round-trips: initial + after tool result
    expect(requestCount).toBe(2);

    // Tool was dispatched
    expect(events.some((e) => e.type === "tool_start" && e.value === "read_file")).toBe(true);

    // Final response came through
    expect(events.some((e) =>
      e.type === "assistant" &&
      e.value === "GRPO stands for Group Relative Policy Optimization.",
    )).toBe(true);

    // Conversation: user → assistant (tool_use) → tool → assistant (text)
    const messages = conversation.getMessages();
    expect(messages).toHaveLength(4);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[1]!.content.some((c) => c.type === "tool_use")).toBe(true);
    expect(messages[2]!.role).toBe("tool");
    // Verify real file content flowed through the tool result
    const toolContent = messages[2]!.content.find((c) => c.type === "tool_result");
    if (toolContent?.type === "tool_result") {
      expect((toolContent.content as string)).toContain("Group relative policy optimization");
    }
    expect(messages[3]!.role).toBe("assistant");
  });

  test("tool error recovery through full pipeline", async () => {
    requestCount = 0;

    respondToRequest = (body) => {
      const messages = body.messages as Array<{ role: string }>;
      const hasToolResult = messages.some((m) => m.role === "tool");

      if (!hasToolResult) {
        return toolCallResponse("read_file", { path: "Notes/NonExistent.md" });
      } else {
        return textResponse("Sorry, that file doesn't exist.");
      }
    };

    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const conversation = new Conversation();
    const engine = new ConversationEngine({
      conversation,
      tools,
      systemPrompt: "You are a helpful tutor.",
    });

    conversation.addUserMessage("Read NonExistent.md");
    await engine.runTurn(provider, {});

    // Two requests: tool call + recovery
    expect(requestCount).toBe(2);

    // Tool result should have error flag
    const messages = conversation.getMessages();
    const toolMsg = messages.find((m) => m.role === "tool");
    const toolResult = toolMsg!.content.find((c) => c.type === "tool_result");
    if (toolResult?.type === "tool_result") {
      expect(toolResult.isError).toBe(true);
    }

    // Engine recovered — final assistant message present
    expect(messages[messages.length - 1]!.role).toBe("assistant");
  });

  test("reasoning streams through full pipeline", async () => {
    respondToRequest = () =>
      reasoningResponse("The student is asking about GRPO...", "GRPO is a reinforcement learning technique.");
    requestCount = 0;

    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const conversation = new Conversation();
    const engine = new ConversationEngine({
      conversation,
      tools,
      systemPrompt: "You are a helpful tutor.",
    });
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("Explain GRPO");
    await engine.runTurn(provider, callbacks);

    // Reasoning should have streamed
    expect(events.some((e) => e.type === "streaming_thinking")).toBe(true);
    // Text should have streamed after reasoning
    expect(events.some((e) => e.type === "streaming_text")).toBe(true);
    // Final message
    expect(events.some((e) =>
      e.type === "assistant" &&
      e.value === "GRPO is a reinforcement learning technique.",
    )).toBe(true);
  });

  test("path traversal rejected through full pipeline", async () => {
    requestCount = 0;

    respondToRequest = (body) => {
      const messages = body.messages as Array<{ role: string }>;
      const hasToolResult = messages.some((m) => m.role === "tool");

      if (!hasToolResult) {
        return toolCallResponse("read_file", { path: "../../etc/passwd" });
      } else {
        return textResponse("I cannot access that file.");
      }
    };

    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const conversation = new Conversation();
    const engine = new ConversationEngine({
      conversation,
      tools,
      systemPrompt: "You are a helpful tutor.",
    });

    conversation.addUserMessage("Read /etc/passwd");
    await engine.runTurn(provider, {});

    const messages = conversation.getMessages();
    const toolMsg = messages.find((m) => m.role === "tool");
    const toolResult = toolMsg!.content.find((c) => c.type === "tool_result");
    if (toolResult?.type === "tool_result") {
      expect(toolResult.isError).toBe(true);
      expect((toolResult.content as string)).toMatch(/outside|vault/i);
    }
  });
});
