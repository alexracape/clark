import { test, expect, describe } from "bun:test";
import { Conversation } from "../src/llm/messages.ts";
import { listProviders } from "../src/llm/provider.ts";
import { messagesToGeminiContents } from "../src/llm/gemini.ts";
import { checkModelFits, listLocalModels } from "../src/llm/ollama.ts";
import type { Message } from "../src/llm/provider.ts";

// Import to trigger provider registration
import "../src/llm/anthropic.ts";
import "../src/llm/openai.ts";
import "../src/llm/gemini.ts";
import "../src/llm/ollama.ts";

describe("LLM Provider Registry", () => {
  test("all providers are registered", () => {
    const providers = listProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("gemini");
    expect(providers).toContain("ollama");
  });
});

describe("Gemini message mapping", () => {
  test("maps user text message", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    const contents = messagesToGeminiContents(messages);
    expect(contents).toHaveLength(1);
    expect(contents[0]!.role).toBe("user");
    expect(contents[0]!.parts).toEqual([{ text: "hello" }]);
  });

  test("maps user image message", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "describe this" },
          { type: "image", data: "base64data", mediaType: "image/png" },
        ],
      },
    ];
    const contents = messagesToGeminiContents(messages);
    expect(contents).toHaveLength(1);
    expect(contents[0]!.parts).toHaveLength(2);
    expect(contents[0]!.parts![0]).toEqual({ text: "describe this" });
    expect(contents[0]!.parts![1]).toEqual({
      inlineData: { data: "base64data", mimeType: "image/png" },
    });
  });

  test("maps assistant role to model role", () => {
    const messages: Message[] = [
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    ];
    const contents = messagesToGeminiContents(messages);
    expect(contents[0]!.role).toBe("model");
  });

  test("maps assistant tool_use to functionCall", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "notes.md" },
          },
        ],
      },
    ];
    const contents = messagesToGeminiContents(messages);
    expect(contents[0]!.parts![0]).toEqual({
      functionCall: { name: "read_file", args: { path: "notes.md" } },
    });
  });

  test("maps tool_result to functionResponse", () => {
    const messages: Message[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool_result",
            toolUseId: "read_file",
            content: "file contents here",
          },
        ],
      },
    ];
    const contents = messagesToGeminiContents(messages);
    expect(contents[0]!.role).toBe("user");
    expect(contents[0]!.parts![0]).toEqual({
      functionResponse: {
        name: "read_file",
        response: { result: "file contents here" },
      },
    });
  });

  test("maps multi-turn conversation", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "help me" }] },
      { role: "assistant", content: [{ type: "text", text: "sure" }] },
      { role: "user", content: [{ type: "text", text: "thanks" }] },
    ];
    const contents = messagesToGeminiContents(messages);
    expect(contents).toHaveLength(3);
    expect(contents[0]!.role).toBe("user");
    expect(contents[1]!.role).toBe("model");
    expect(contents[2]!.role).toBe("user");
  });
});

describe("Ollama checkModelFits", () => {
  test("throws clear error when Ollama is unreachable", async () => {
    // Create a client pointed at a non-existent server
    const { Ollama } = await import("ollama");
    const client = new Ollama({ host: "http://localhost:1" });

    await expect(checkModelFits("llama3.2", client)).rejects.toThrow(
      /Cannot connect to Ollama.*ollama serve/s,
    );
  });

  test("throws when model is not found", async () => {
    // Create a mock client that rejects show() with a not-found error
    const mockClient = {
      config: { host: "http://localhost:11434" },
      show: async () => {
        throw new Error("model not found");
      },
      list: async () => ({ models: [] }),
    } as any;

    await expect(
      checkModelFits("nonexistent-model", mockClient),
    ).rejects.toThrow(/not found.*ollama pull nonexistent-model/s);
  });

  test("returns size info when model fits in RAM", async () => {
    const mockClient = {
      config: { host: "http://localhost:11434" },
      show: async () => ({
        details: { parameter_size: "3B", quantization_level: "Q4_0" },
      }),
      list: async () => ({
        models: [{ name: "small-model:latest", size: 2_000_000_000 }],
      }),
    } as any;

    const result = await checkModelFits("small-model", mockClient);
    expect(result.sizeBytes).toBe(2_000_000_000);
    expect(result.totalRam).toBeGreaterThan(0);
    expect(result.pct).toBeLessThan(1);
  });

  test("throws when model exceeds total RAM", async () => {
    // Simulate a model larger than total RAM
    const { totalmem } = await import("node:os");
    const totalRam = totalmem();

    const mockClient = {
      config: { host: "http://localhost:11434" },
      show: async () => ({
        details: { parameter_size: "70B", quantization_level: "Q4_0" },
      }),
      list: async () => ({
        models: [
          { name: "huge-model:latest", size: totalRam + 10_000_000_000 },
        ],
      }),
    } as any;

    await expect(checkModelFits("huge-model", mockClient)).rejects.toThrow(
      /exceeds total system RAM.*ollama pull/s,
    );
  });

  test("falls back to parameter_size estimation when list has no match", async () => {
    const mockClient = {
      config: { host: "http://localhost:11434" },
      show: async () => ({
        details: { parameter_size: "7B", quantization_level: "Q4_0" },
      }),
      list: async () => ({ models: [] }),
    } as any;

    const result = await checkModelFits("some-model", mockClient);
    // 7B * 0.5 bytes/param = 3.5 GB
    expect(result.sizeBytes).toBe(3_500_000_000);
  });
});

describe("Ollama listLocalModels", () => {
  test("returns models when Ollama is reachable", async () => {
    const mockClient = {
      list: async () => ({
        models: [
          { name: "llama3.2:latest", size: 2_000_000_000 },
          { name: "codellama:latest", size: 3_500_000_000 },
        ],
      }),
    } as any;

    const models = await listLocalModels(mockClient);
    expect(models).toHaveLength(2);
    expect(models[0]!.name).toBe("llama3.2:latest");
    expect(models[1]!.name).toBe("codellama:latest");
  });

  test("returns empty array when no models pulled", async () => {
    const mockClient = {
      list: async () => ({ models: [] }),
    } as any;

    const models = await listLocalModels(mockClient);
    expect(models).toHaveLength(0);
  });

  test("throws 'not-running' when Ollama is unreachable", async () => {
    const mockClient = {
      list: async () => {
        const err = new Error("Unable to connect");
        (err as any).code = "ConnectionRefused";
        throw err;
      },
    } as any;

    await expect(listLocalModels(mockClient)).rejects.toThrow("not-running");
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

  test("estimateContext returns token breakdown", () => {
    const conv = new Conversation();
    conv.addUserMessage("Hello world"); // 11 chars → ~3 tokens
    conv.addAssistantMessage([{ type: "text", text: "How can I help?" }]); // 15 chars → ~4 tokens
    conv.addToolResult("t1", "some tool result text"); // 20 chars → ~5 tokens

    const ctx = conv.estimateContext();
    expect(ctx.messageCount).toBe(3);
    expect(ctx.userTokens).toBeGreaterThan(0);
    expect(ctx.assistantTokens).toBeGreaterThan(0);
    expect(ctx.toolTokens).toBeGreaterThan(0);
    expect(ctx.totalTokens).toBe(ctx.userTokens + ctx.assistantTokens + ctx.toolTokens);
    expect(ctx.imageCount).toBe(0);
  });

  test("estimateContext counts images", () => {
    const conv = new Conversation();
    conv.addUserImageMessage("My work", "base64data", "image/png");

    const ctx = conv.estimateContext();
    expect(ctx.imageCount).toBe(1);
    expect(ctx.userTokens).toBeGreaterThanOrEqual(1600); // image token cost
  });

  test("compact replaces older messages with summary", () => {
    const conv = new Conversation();
    for (let i = 0; i < 10; i++) {
      conv.addUserMessage(`Message ${i}`);
    }
    expect(conv.length).toBe(10);

    conv.compact("Summary of earlier conversation", 4);

    const msgs = conv.getMessages();
    // 1 summary + 4 kept = 5
    expect(msgs).toHaveLength(5);
    expect(msgs[0]!.role).toBe("user");
    expect((msgs[0]!.content[0] as any).text).toContain("Previous conversation summary");
    expect((msgs[0]!.content[0] as any).text).toContain("Summary of earlier conversation");
  });

  test("compact is a no-op when conversation is short", () => {
    const conv = new Conversation();
    conv.addUserMessage("hello");
    conv.addUserMessage("world");

    conv.compact("summary", 4);
    expect(conv.length).toBe(2); // unchanged
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
