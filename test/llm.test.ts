import { test, expect, describe } from "bun:test";
import { Conversation } from "../core/llm/messages.ts";
import { listProviders } from "../core/llm/provider.ts";
import { checkModelFits, listLocalModels } from "../core/llm/ollama.ts";
import type { Message } from "../core/llm/provider.ts";

// Import to trigger provider registration
import "../core/llm/cloud.ts";
import "../core/llm/ollama.ts";

describe("LLM Provider Registry", () => {
  test("cloud and ollama providers are registered", () => {
    const providers = listProviders();
    expect(providers).toContain("clark-cloud");
    expect(providers).toContain("ollama");
  });

  test("old providers are not registered", () => {
    const providers = listProviders();
    expect(providers).not.toContain("anthropic");
    expect(providers).not.toContain("openai");
    expect(providers).not.toContain("gemini");
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
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "Hello " },
      { type: "text-delta", id: "text-0", text: "world" },
      { type: "text-end", id: "text-0" },
      { type: "finish", finishReason: "end_turn" },
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

  test("collectStreamResponse handles text-delta without text-start", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "text-delta", id: "text-0", text: "orphan " },
      { type: "text-delta", id: "text-0", text: "delta" },
      { type: "text-end", id: "text-0" },
      { type: "finish", finishReason: "end_turn" },
    ]);

    // Should auto-create the text part and accumulate deltas
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "orphan delta" });
  });

  test("collectStreamResponse handles missing text-end before finish", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "no end" },
      { type: "finish", finishReason: "end_turn" },
    ]);

    // Text should still be collected even without explicit text-end
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "no end" });
  });

  test("collectStreamResponse handles reasoning-delta without reasoning-start", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "reasoning-delta", id: "r-0", text: "orphan thought" },
      { type: "reasoning-end", id: "r-0" },
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "answer" },
      { type: "text-end", id: "text-0" },
      { type: "finish", finishReason: "end_turn" },
    ]);

    // Should auto-create thinking part + have text
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "thinking", text: "orphan thought" });
    expect(content[1]).toEqual({ type: "text", text: "answer" });
  });

  test("collectStreamResponse handles empty text deltas", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "" },
      { type: "text-delta", id: "text-0", text: "real content" },
      { type: "text-delta", id: "text-0", text: "" },
      { type: "text-end", id: "text-0" },
      { type: "finish", finishReason: "end_turn" },
    ]);

    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "real content" });
  });

  test("collectStreamResponse handles multiple interleaved text blocks", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "text-start", id: "a" },
      { type: "text-delta", id: "a", text: "first " },
      { type: "text-start", id: "b" },
      { type: "text-delta", id: "b", text: "second " },
      { type: "text-delta", id: "a", text: "block" },
      { type: "text-delta", id: "b", text: "block" },
      { type: "text-end", id: "a" },
      { type: "text-end", id: "b" },
      { type: "finish", finishReason: "end_turn" },
    ]);

    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "first block" });
    expect(content[1]).toEqual({ type: "text", text: "second block" });
  });

  test("collectStreamResponse handles finish with no content", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "finish", finishReason: "end_turn" },
    ]);

    expect(content).toHaveLength(0);
  });

  test("collectStreamResponse handles tool input with invalid JSON", () => {
    const conv = new Conversation();

    expect(() => {
      conv.collectStreamResponse([
        { type: "tool-input-start", id: "t1", toolName: "read_file" },
        { type: "tool-input-delta", id: "t1", delta: "{invalid json" },
        { type: "tool-input-end", id: "t1" },
        { type: "finish", finishReason: "tool_use" },
      ]);
    }).toThrow(); // JSON.parse should throw SyntaxError
  });

  test("collectStreamResponse handles tool-call (non-streamed) chunks", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "tool-call", toolCallId: "tc1", toolName: "echo", input: { text: "hi" } },
      { type: "finish", finishReason: "tool_use" },
    ]);

    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      type: "tool_use",
      id: "tc1",
      name: "echo",
      input: { text: "hi" },
    });
  });

  test("collectStreamResponse handles tool use", () => {
    const conv = new Conversation();
    const content = conv.collectStreamResponse([
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "Let me check." },
      { type: "text-end", id: "text-0" },
      { type: "tool-input-start", id: "t1", toolName: "read_canvas" },
      { type: "tool-input-delta", id: "t1", delta: '{"page":' },
      { type: "tool-input-delta", id: "t1", delta: '"1"}' },
      { type: "tool-input-end", id: "t1" },
      { type: "finish", finishReason: "tool_use" },
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
