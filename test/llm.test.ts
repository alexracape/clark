import { test, expect, describe } from "bun:test";
import { Conversation } from "../src/llm/messages.ts";
import { listProviders } from "../src/llm/provider.ts";

// Import to trigger provider registration
import "../src/llm/anthropic.ts";
import "../src/llm/openai.ts";

describe("LLM Provider Registry", () => {
  test("anthropic and openai providers are registered", () => {
    const providers = listProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
  });
});

describe("Conversation", () => {
  test("addUserMessage and getMessages", () => {
    const conv = new Conversation();
    conv.addUserMessage("hello");

    const messages = conv.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content[0]).toEqual({ type: "text", text: "hello" });
  });

  test("addToolResult", () => {
    const conv = new Conversation();
    conv.addToolResult("tool-123", "result text");

    const messages = conv.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("tool");
  });

  test("clear resets messages", () => {
    const conv = new Conversation();
    conv.addUserMessage("hello");
    conv.addUserMessage("world");
    expect(conv.length).toBe(2);

    conv.clear();
    expect(conv.length).toBe(0);
    expect(conv.getMessages()).toHaveLength(0);
  });

  test("collectStreamResponse merges text deltas", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "done", stopReason: "end_turn" },
    ]);

    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "Hello world" });
  });

  test("collectStreamResponse handles tool use", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "text_delta", text: "Let me check." },
      { type: "tool_use_start", id: "t1", name: "read_canvas" },
      { type: "tool_input_delta", id: "t1", input: '{"page":' },
      { type: "tool_input_delta", id: "t1", input: '"1"}' },
      { type: "done", stopReason: "tool_use" },
    ]);

    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Let me check." });
    expect(content[1]).toEqual({
      type: "tool_use",
      id: "t1",
      name: "read_canvas",
      input: { page: "1" },
    });
  });
});
