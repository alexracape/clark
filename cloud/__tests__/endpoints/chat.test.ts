import { describe, test, expect } from "bun:test";
import chatHandler from "../../api/chat.ts";
import {
  useBetaClient,
  useCloudEnv,
  useFetchMock,
  clientRequest,
  anonRequest,
  jsonBody,
} from "../helpers.ts";

const handler = chatHandler.fetch.bind(chatHandler);

/**
 * Build a fake Anthropic streaming response body.
 * Returns an SSE stream that the AI SDK can parse.
 */
function fakeAnthropicStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-sonnet-4-20250514",
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({
      type: "content_block_stop",
      index: 0,
    })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 5 },
    })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];

  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
}

const validBody = {
  model: "claude-sonnet-4-20250514",
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    },
  ],
};

describe("POST /api/chat", () => {
  const store = useBetaClient("test-client-uuid");
  useCloudEnv({ ANTHROPIC_API_KEY: "sk-ant-test-key" });

  // Mock Anthropic API
  useFetchMock((url, init) => {
    if (url.includes("api.anthropic.com")) {
      return new Response(fakeAnthropicStream("Hello from Claude!"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return null;
  });

  test("rejects non-POST methods", async () => {
    const res = await handler(clientRequest("/api/chat", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler(
      anonRequest("/api/chat", { body: validBody }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 403 for anonymous client (beta-gated)", async () => {
    store.clear();
    const res = await handler(
      clientRequest("/api/chat", { body: validBody }),
    );
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.required).toBe("beta");
    expect(body.current).toBe("anonymous");

    // Restore beta status
    store.set("beta:test-client-uuid", "1");
  });

  test("returns 400 when model is missing", async () => {
    const res = await handler(
      clientRequest("/api/chat", {
        body: { messages: validBody.messages },
      }),
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toContain("model");
  });

  test("returns 400 when messages is missing", async () => {
    const res = await handler(
      clientRequest("/api/chat", {
        body: { model: "claude-sonnet-4-20250514" },
      }),
    );
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toContain("messages");
  });

  test("streams a text response", async () => {
    const res = await handler(
      clientRequest("/api/chat", { body: validBody }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("X-Clark-Provider")).toBe("anthropic");

    // Read the full SSE stream
    const text = await res.text();
    const lines = text
      .split("\n\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.replace("data: ", "")));

    // Should contain at least a text_delta and a done event
    const textDeltas = lines.filter((l: any) => l.type === "text_delta");
    const doneEvents = lines.filter((l: any) => l.type === "done");

    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas[0].text).toContain("Hello from Claude!");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].stopReason).toBe("end_turn");
  });

  test("infers provider from model name", async () => {
    const res = await handler(
      clientRequest("/api/chat", { body: validBody }),
    );
    expect(res.headers.get("X-Clark-Provider")).toBe("anthropic");
  });

  test("returns 500 for unsupported provider", async () => {
    const res = await handler(
      clientRequest("/api/chat", {
        body: {
          ...validBody,
          model: "unknown-model",
        },
      }),
    );
    expect(res.status).toBe(500);
  });

  test("streams error event when upstream throws", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.anthropic.com")) {
        // Throw a network error (non-retryable) instead of returning an HTTP error
        throw new Error("Network connection refused");
      }
      return originalFetch(input);
    };
    try {
      const res = await handler(
        clientRequest("/api/chat", { body: validBody }),
      );
      // The handler returns 200 SSE, but the stream should contain an error event
      const text = await res.text();
      const lines = text
        .split("\n\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.replace("data: ", "")));

      const errorEvents = lines.filter((l: any) => l.type === "error");
      expect(errorEvents.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
