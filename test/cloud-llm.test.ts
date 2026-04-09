import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { CloudLLMProvider } from "../core/llm/cloud.ts";
import type { StreamChunk } from "../core/llm/provider.ts";

/**
 * Create a mock SSE response body from a list of StreamChunks.
 */
function mockSSEResponse(chunks: StreamChunk[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("CloudLLMProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("preserves underlying provider name", () => {
    const provider = new CloudLLMProvider(
      "https://example.com", "client-1", "anthropic/claude-sonnet-4-6",
    );
    expect(provider.name).toBe("anthropic");
    expect(provider.supportsVision).toBe(true);
  });

  test("streams text deltas from SSE", async () => {
    const expectedChunks: StreamChunk[] = [
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "Hello" },
      { type: "text-delta", id: "text-0", text: " world" },
      { type: "text-end", id: "text-0" },
      { type: "finish", finishReason: "end_turn" },
    ];

    globalThis.fetch = async () => mockSSEResponse(expectedChunks);

    const provider = new CloudLLMProvider(
      "https://example.com", "client-1", "anthropic/claude-sonnet-4-6",
    );

    const received: StreamChunk[] = [];
    for await (const chunk of provider.chat([], [], "system prompt")) {
      received.push(chunk);
    }

    expect(received).toEqual(expectedChunks);
  });

  test("streams tool use events", async () => {
    const expectedChunks: StreamChunk[] = [
      { type: "tool-input-start", id: "t1", toolName: "read_file" },
      { type: "tool-input-delta", id: "t1", delta: '{"path":' },
      { type: "tool-input-delta", id: "t1", delta: '"test.md"}' },
      { type: "tool-input-end", id: "t1" },
      { type: "finish", finishReason: "tool_use" },
    ];

    globalThis.fetch = async () => mockSSEResponse(expectedChunks);

    const provider = new CloudLLMProvider(
      "https://example.com", "client-1", "anthropic/claude-sonnet-4-6",
    );

    const received: StreamChunk[] = [];
    for await (const chunk of provider.chat([], [], "")) {
      received.push(chunk);
    }

    expect(received).toEqual(expectedChunks);
  });

  test("streams reasoning events", async () => {
    const expectedChunks: StreamChunk[] = [
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", text: "working it out" },
      { type: "reasoning-end", id: "r1" },
      { type: "finish", finishReason: "end_turn" },
    ];

    globalThis.fetch = async () => mockSSEResponse(expectedChunks);

    const provider = new CloudLLMProvider(
      "https://example.com", "client-1", "anthropic/claude-sonnet-4-6",
    );

    const received: StreamChunk[] = [];
    for await (const chunk of provider.chat([], [], "")) {
      received.push(chunk);
    }

    expect(received).toEqual(expectedChunks);
  });

  test("throws on HTTP error", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
      });

    const provider = new CloudLLMProvider(
      "https://example.com", "client-1", "anthropic/claude-sonnet-4-6",
    );

    const chunks: StreamChunk[] = [];
    try {
      for await (const chunk of provider.chat([], [], "")) {
        chunks.push(chunk);
      }
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("429");
    }
  });

  test("throws on empty response body", async () => {
    globalThis.fetch = async () =>
      new Response(null, { status: 200 });

    const provider = new CloudLLMProvider(
      "https://example.com", "client-1", "anthropic/claude-sonnet-4-6",
    );

    try {
      for await (const _ of provider.chat([], [], "")) {
        // consume
      }
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("empty response body");
    }
  });

  test("sends correct headers and body", async () => {
    let capturedRequest: { url: string; headers: Record<string, string>; body: any } | null = null;

    globalThis.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers)) {
          headers[k] = v as string;
        }
      }
      capturedRequest = {
        url,
        headers,
        body: JSON.parse(init?.body as string),
      };
      return mockSSEResponse([{ type: "finish", finishReason: "end_turn" }]);
    };

    const provider = new CloudLLMProvider(
      "https://api.clark.dev", "uuid-123", "openai/gpt-4.1-mini",
    );

    for await (const _ of provider.chat(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      [],
      "Be helpful",
    )) {
      // consume
    }

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe("https://api.clark.dev/api/chat");
    expect(capturedRequest!.headers["X-Clark-Client-Id"]).toBe("uuid-123");
    expect(capturedRequest!.body.model).toBe("openai/gpt-4.1-mini");
    expect(capturedRequest!.body.systemPrompt).toBe("Be helpful");
  });
});
