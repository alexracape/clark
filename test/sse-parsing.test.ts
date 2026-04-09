/**
 * Tests for real SSE byte-level parsing in CloudLLMProvider.
 *
 * Starts a real Bun HTTP server that emits raw `data: {...}\n\n` SSE text,
 * then feeds it through a real CloudLLMProvider to verify the parser in
 * core/llm/cloud.ts handles all edge cases correctly.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { CloudLLMProvider } from "../core/llm/cloud.ts";
import type { StreamChunk } from "../core/llm/provider.ts";
import type { Server } from "bun";

let server: Server;
let baseUrl: string;

/** Swappable handler — each test sets this before making requests */
let currentHandler: (req: Request) => Response | Promise<Response>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      return currentHandler(req);
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

/** Encode chunks as raw SSE text, exactly matching cloud/api/chat.ts output */
function sseLines(chunks: StreamChunk[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");
}

/** Create a streaming SSE Response from raw text, optionally split into multiple enqueues */
function sseResponse(text: string, splitAt?: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (splitAt !== undefined && splitAt < text.length) {
        // Split into two chunks to test buffer accumulation
        controller.enqueue(encoder.encode(text.slice(0, splitAt)));
        controller.enqueue(encoder.encode(text.slice(splitAt)));
      } else {
        controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Collect all chunks from a provider.chat() call */
async function collectChunks(provider: CloudLLMProvider): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of provider.chat([], [], "test")) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("SSE Parsing", () => {
  test("parses normal multi-chunk text streaming", async () => {
    const expected: StreamChunk[] = [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "Hello " },
      { type: "text-delta", id: "text-0", text: "world" },
      { type: "text-end", id: "text-0" },
      { type: "finish-step", finishReason: "end_turn" },
      { type: "finish", finishReason: "end_turn" },
    ];

    currentHandler = () => sseResponse(sseLines(expected));
    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const chunks = await collectChunks(provider);

    expect(chunks).toEqual(expected);
  });

  test("parses tool call streaming with input deltas", async () => {
    const expected: StreamChunk[] = [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "Let me check." },
      { type: "text-end", id: "text-0" },
      { type: "tool-input-start", id: "t1", toolName: "read_file" },
      { type: "tool-input-delta", id: "t1", delta: '{"path":' },
      { type: "tool-input-delta", id: "t1", delta: '"Notes/GRPO.md"}' },
      { type: "tool-input-end", id: "t1" },
      { type: "finish-step", finishReason: "tool_use" },
      { type: "finish", finishReason: "tool_use" },
    ];

    currentHandler = () => sseResponse(sseLines(expected));
    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const chunks = await collectChunks(provider);

    expect(chunks).toEqual(expected);
  });

  test("skips malformed JSON lines and continues", async () => {
    const raw = [
      `data: {"type":"start"}\n\n`,
      `data: {INVALID JSON}\n\n`,
      `data: {"type":"text-start","id":"text-0"}\n\n`,
      `data: {"type":"text-delta","id":"text-0","text":"survived"}\n\n`,
      `data: {"type":"text-end","id":"text-0"}\n\n`,
      `data: {"type":"finish","finishReason":"end_turn"}\n\n`,
    ].join("");

    currentHandler = () => sseResponse(raw);
    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const chunks = await collectChunks(provider);

    // Malformed line should be skipped; valid chunks still yielded
    expect(chunks).toHaveLength(5);
    expect(chunks[0]!.type).toBe("start");
    expect(chunks[1]!.type).toBe("text-start");
    const textDelta = chunks[2] as StreamChunk & { type: "text-delta" };
    expect(textDelta.text).toBe("survived");
  });

  test("handles SSE event split across read boundaries", async () => {
    const chunks: StreamChunk[] = [
      { type: "start" },
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", text: "split test" },
      { type: "text-end", id: "text-0" },
      { type: "finish", finishReason: "end_turn" },
    ];
    const raw = sseLines(chunks);

    // Split in the middle of a JSON object so buffer accumulation is exercised
    const splitPoint = raw.indexOf('"split test"') + 5;
    currentHandler = () => sseResponse(raw, splitPoint);
    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const result = await collectChunks(provider);

    expect(result).toEqual(chunks);
  });

  test("throws on error chunk mid-stream", async () => {
    const raw = [
      `data: {"type":"start"}\n\n`,
      `data: {"type":"text-start","id":"text-0"}\n\n`,
      `data: {"type":"error","error":"rate limit exceeded"}\n\n`,
    ].join("");

    currentHandler = () => sseResponse(raw);
    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");

    const collected: StreamChunk[] = [];
    let caughtError: Error | null = null;
    try {
      for await (const chunk of provider.chat([], [], "test")) {
        collected.push(chunk);
      }
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("rate limit exceeded");
    // Should have yielded the chunks before the error
    expect(collected.length).toBeGreaterThanOrEqual(1);
  });

  test("throws on non-200 HTTP status with body text", async () => {
    currentHandler = () =>
      new Response("Service temporarily unavailable", { status: 503 });
    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");

    let caughtError: Error | null = null;
    try {
      for await (const _chunk of provider.chat([], [], "test")) {
        // Should not reach here
      }
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain("503");
    expect(caughtError!.message).toContain("Service temporarily unavailable");
  });

  test("yields nothing for empty SSE stream", async () => {
    // An empty stream (no data lines) should yield zero chunks without error
    currentHandler = () =>
      new Response("", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const chunks = await collectChunks(provider);

    expect(chunks).toHaveLength(0);
  });

  test("ignores empty data lines and non-data lines", async () => {
    const raw = [
      `: this is an SSE comment\n\n`,
      `data: {"type":"start"}\n\n`,
      `data: \n\n`,
      `\n`,
      `data: {"type":"text-start","id":"text-0"}\n\n`,
      `data: {"type":"text-delta","id":"text-0","text":"ok"}\n\n`,
      `data: {"type":"text-end","id":"text-0"}\n\n`,
      `data: {"type":"finish","finishReason":"end_turn"}\n\n`,
    ].join("");

    currentHandler = () => sseResponse(raw);
    const provider = new CloudLLMProvider(baseUrl, "test-client", "anthropic/test");
    const chunks = await collectChunks(provider);

    expect(chunks).toHaveLength(5);
    expect(chunks[0]!.type).toBe("start");
  });

  test("sends correct request headers and body", async () => {
    let capturedHeaders: Headers | null = null;
    let capturedBody: any = null;

    currentHandler = async (req) => {
      capturedHeaders = req.headers;
      capturedBody = await req.json();
      return sseResponse(sseLines([
        { type: "start" },
        { type: "finish", finishReason: "end_turn" },
      ]));
    };

    const provider = new CloudLLMProvider(baseUrl, "my-client-id", "anthropic/claude-sonnet-4.6");
    await collectChunks(provider);

    expect(capturedHeaders!.get("X-Clark-Client-Id")).toBe("my-client-id");
    expect(capturedHeaders!.get("Content-Type")).toBe("application/json");
    expect(capturedBody.model).toBe("anthropic/claude-sonnet-4.6");
    expect(capturedBody.systemPrompt).toBe("test");
  });
});
