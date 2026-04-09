import { test, expect, describe, beforeEach } from "bun:test";
import { ConversationEngine, toLLMTools, normalizeVisionMediaType } from "../core/engine.ts";
import { Conversation } from "../core/llm/messages.ts";
import { MockProvider, type MockResponse } from "../core/llm/mock.ts";
import type { ToolDefinition, ToolResult } from "../core/mcp/tools.ts";
import type { TurnCallbacks } from "../core/engine.ts";

/** Helper: create a simple echo tool */
function echoTool(): ToolDefinition {
  return {
    name: "echo",
    description: "Echoes input back",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to echo" },
      },
      required: ["text"],
    },
    handler: async (input) => ({
      content: [{ type: "text", text: `echo: ${input.text}` }],
      isError: false,
    }),
  };
}

/** Helper: create a tool that returns an image */
function imageTool(): ToolDefinition {
  return {
    name: "screenshot",
    description: "Returns a screenshot",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => ({
      content: [
        { type: "image", data: "base64data", mimeType: "image/png" },
        { type: "text", text: "Screenshot captured" },
      ],
      isError: false,
    }),
  };
}

/** Helper: collect callback events with ordering */
function trackCallbacks() {
  const events: Array<{ type: string; value?: string; order: number }> = [];
  let counter = 0;
  const callbacks: TurnCallbacks = {
    onStreamingText: (t) => events.push({ type: "streaming_text", value: t, order: counter++ }),
    onStreamingThinking: (t) => events.push({ type: "streaming_thinking", value: t, order: counter++ }),
    onStreamingDone: () => events.push({ type: "streaming_done", order: counter++ }),
    onAssistantMessage: (t) => events.push({ type: "assistant", value: t, order: counter++ }),
    onToolStart: (name) => events.push({ type: "tool_start", value: name, order: counter++ }),
    onSystemMessage: (msg) => events.push({ type: "system", value: msg, order: counter++ }),
  };
  return { events, callbacks };
}

/** Assert that event types appear in the given relative order */
function assertEventOrder(
  events: Array<{ type: string; order: number }>,
  expectedOrder: string[],
) {
  const positions = expectedOrder.map((type) => {
    const event = events.find((e) => e.type === type);
    if (!event) throw new Error(`Expected event "${type}" not found. Got: ${events.map(e => e.type).join(", ")}`);
    return { type, order: event.order };
  });

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1]!;
    const curr = positions[i]!;
    if (prev.order >= curr.order) {
      throw new Error(
        `Event "${prev.type}" (order ${prev.order}) should come before "${curr.type}" (order ${curr.order})`,
      );
    }
  }
}

describe("toLLMTools", () => {
  test("converts ToolDefinition[] to Tool[]", () => {
    const tools = toLLMTools([echoTool()]);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("echo");
    expect(tools[0]!.description).toBe("Echoes input back");
    expect(tools[0]!.inputSchema).toEqual(echoTool().inputSchema);
  });
});

describe("normalizeVisionMediaType", () => {
  test("normalizes supported types", () => {
    expect(normalizeVisionMediaType("image/png")).toBe("image/png");
    expect(normalizeVisionMediaType("image/jpeg")).toBe("image/jpeg");
    expect(normalizeVisionMediaType("image/jpg")).toBe("image/jpeg");
    expect(normalizeVisionMediaType("image/webp")).toBe("image/webp");
    expect(normalizeVisionMediaType("IMAGE/PNG")).toBe("image/png");
  });

  test("returns null for unsupported types", () => {
    expect(normalizeVisionMediaType("image/gif")).toBeNull();
    expect(normalizeVisionMediaType("text/plain")).toBeNull();
    expect(normalizeVisionMediaType(undefined)).toBeNull();
  });
});

describe("ConversationEngine", () => {
  let conversation: Conversation;
  let engine: ConversationEngine;

  beforeEach(() => {
    conversation = new Conversation();
    engine = new ConversationEngine({
      conversation,
      tools: [echoTool()],
      systemPrompt: "You are a helpful assistant.",
    });
  });

  test("simple text response", async () => {
    const provider = new MockProvider([{ text: "Hello world" }]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("Hi");
    await engine.runTurn(provider, callbacks);

    // Should have streamed text and emitted assistant message
    expect(events.some((e) => e.type === "assistant" && e.value === "Hello world")).toBe(true);
    expect(events.some((e) => e.type === "streaming_done")).toBe(true);
    // Provider should have been called once
    expect(provider.calls).toHaveLength(1);

    // Verify callback ordering: text before done, done before assistant
    assertEventOrder(events, ["streaming_text", "streaming_done", "assistant"]);

    // Verify conversation state
    const messages = conversation.getMessages();
    expect(messages).toHaveLength(2); // user + assistant
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
  });

  test("streams reasoning before text when available", async () => {
    const provider = new MockProvider([
      { thinking: "let me think", text: "Here is the answer" },
    ]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("Hi");
    await engine.runTurn(provider, callbacks);

    expect(events.some((e) => e.type === "streaming_thinking" && e.value?.includes("let me think"))).toBe(true);
    expect(events.some((e) => e.type === "assistant" && e.value === "Here is the answer")).toBe(true);

    // Engine fires an initial empty streaming_text to clear the display, then thinking, then text content, then done
    // Verify thinking fires before done, and done fires before assistant
    assertEventOrder(events, ["streaming_thinking", "streaming_done", "assistant"]);
  });

  test("tool call and follow-up response", async () => {
    const provider = new MockProvider([
      // First response: tool call
      {
        toolCalls: [{ id: "tc1", name: "echo", input: { text: "ping" } }],
      },
      // Second response: final text after tool result
      { text: "The echo said: ping" },
    ]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("echo ping");
    await engine.runTurn(provider, callbacks);

    // Should have dispatched the tool
    expect(events.some((e) => e.type === "tool_start" && e.value === "echo")).toBe(true);
    // Should have final text
    expect(events.some((e) => e.type === "assistant" && e.value === "The echo said: ping")).toBe(true);
    // Provider called twice (initial + after tool result)
    expect(provider.calls).toHaveLength(2);

    // Verify ordering: first stream done, then tool, then second stream, then assistant
    assertEventOrder(events, ["streaming_done", "tool_start", "assistant"]);

    // Verify conversation state: user → assistant (tool_use) → tool → assistant (text)
    const messages = conversation.getMessages();
    expect(messages).toHaveLength(4);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[1]!.content.some((c) => c.type === "tool_use")).toBe(true);
    expect(messages[2]!.role).toBe("tool");
    expect(messages[3]!.role).toBe("assistant");
    expect(messages[3]!.content.some((c) => c.type === "text")).toBe(true);
  });

  test("unknown tool returns error result", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [{ id: "tc1", name: "nonexistent", input: {} }],
      },
      { text: "Sorry about that" },
    ]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("do something");
    await engine.runTurn(provider, callbacks);

    // Should still complete without throwing
    expect(events.some((e) => e.type === "assistant")).toBe(true);
    // The conversation should contain the error tool result
    const messages = conversation.getMessages();
    const toolResultMsg = messages.find(
      (m) => m.role === "tool" && m.content.some(
        (c) => c.type === "tool_result" && typeof c.content === "string" && c.content.includes("Unknown tool"),
      ),
    );
    expect(toolResultMsg).toBeDefined();
  });

  test("tool call limit enforcement", async () => {
    const engine2 = new ConversationEngine({
      conversation,
      tools: [echoTool()],
      systemPrompt: "test",
      maxToolCallsPerTurn: 2,
    });

    const provider = new MockProvider([
      // First call: 2 tool uses
      {
        toolCalls: [
          { id: "tc1", name: "echo", input: { text: "a" } },
          { id: "tc2", name: "echo", input: { text: "b" } },
        ],
      },
      // Second call: 1 more tool use (should exceed limit)
      {
        toolCalls: [
          { id: "tc3", name: "echo", input: { text: "c" } },
        ],
      },
    ]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("echo many times");
    await engine2.runTurn(provider, callbacks);

    // Should have a system message about the limit
    expect(events.some((e) => e.type === "system" && e.value?.includes("max tool calls"))).toBe(true);
  });

  test("max_tokens stop reason emits warning", async () => {
    const provider = new MockProvider([{ text: "partial...", stopReason: "max_tokens" }]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("write a very long essay");
    await engine.runTurn(provider, callbacks);

    expect(events.some((e) => e.type === "system" && e.value?.includes("max_tokens"))).toBe(true);
  });

  test("streaming error is caught and reported", async () => {
    // Create a provider that throws during streaming
    const errorProvider: any = {
      name: "error",
      supportsVision: false,
      async *chat() {
        throw new Error("Connection reset");
      },
    };
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("Hi");
    await engine.runTurn(errorProvider, callbacks);

    expect(events.some((e) => e.type === "system" && e.value?.includes("Connection reset"))).toBe(true);
    // Should also call onStreamingDone to clear UI state
    expect(events.some((e) => e.type === "streaming_done")).toBe(true);
  });

  test("image tool result with anthropic provider uses native images", async () => {
    const engineWithImage = new ConversationEngine({
      conversation,
      tools: [imageTool()],
      systemPrompt: "test",
    });

    const provider = new MockProvider([
      {
        toolCalls: [{ id: "tc1", name: "screenshot", input: {} }],
      },
      { text: "I see the screenshot" },
    ]);
    // Override name to anthropic
    Object.defineProperty(provider, "name", { value: "anthropic" });

    conversation.addUserMessage("take a screenshot");
    await engineWithImage.runTurn(provider, {});

    // The tool result should use addToolResultWithImage (image content, not text)
    const messages = conversation.getMessages();
    const toolResult = messages.find(
      (m) => m.role === "tool" && m.content.some((c) => c.type === "tool_result"),
    );
    expect(toolResult).toBeDefined();
    const content = toolResult!.content[0]!;
    expect(content.type).toBe("tool_result");
    if (content.type === "tool_result") {
      // For Anthropic, content should be an array of images (not a string)
      expect(Array.isArray(content.content)).toBe(true);
    }
  });

  test("image tool result with non-anthropic provider adds user image message", async () => {
    const engineWithImage = new ConversationEngine({
      conversation,
      tools: [imageTool()],
      systemPrompt: "test",
    });

    const provider = new MockProvider([
      {
        toolCalls: [{ id: "tc1", name: "screenshot", input: {} }],
      },
      { text: "I see the screenshot" },
    ]);

    conversation.addUserMessage("take a screenshot");
    await engineWithImage.runTurn(provider, {});

    // For non-Anthropic, should have a user image message injected
    const messages = conversation.getMessages();
    const userImageMsg = messages.find(
      (m) => m.role === "user" && m.content.some((c) => c.type === "image"),
    );
    expect(userImageMsg).toBeDefined();
  });

  test("setTools updates tools at runtime", async () => {
    const newTool: ToolDefinition = {
      name: "greet",
      description: "Greets someone",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Name" } },
        required: ["name"],
      },
      handler: async (input) => ({
        content: [{ type: "text", text: `Hello, ${input.name}!` }],
        isError: false,
      }),
    };

    engine.setTools([newTool]);

    const provider = new MockProvider([
      {
        toolCalls: [{ id: "tc1", name: "greet", input: { name: "World" } }],
      },
      { text: "Greeted!" },
    ]);

    conversation.addUserMessage("greet World");
    await engine.runTurn(provider, {});

    // The greet tool should have been dispatched successfully
    const messages = conversation.getMessages();
    const toolResult = messages.find(
      (m) => m.role === "tool" && m.content.some(
        (c) => c.type === "tool_result" && typeof c.content === "string" && c.content.includes("Hello, World!"),
      ),
    );
    expect(toolResult).toBeDefined();
  });

  test("works with no callbacks", async () => {
    const provider = new MockProvider([{ text: "response" }]);
    conversation.addUserMessage("Hi");
    // Should not throw when callbacks are undefined
    await engine.runTurn(provider);
    expect(provider.calls).toHaveLength(1);
  });
});
