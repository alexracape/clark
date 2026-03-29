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
 * Build a fake AI Gateway streaming response.
 * The Gateway uses SSE with LanguageModelV3StreamPart JSON events.
 */
function fakeGatewayStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = [
    // response metadata
    `data: ${JSON.stringify({
      type: "response-metadata",
      id: "resp_test",
      modelId: "claude-sonnet-4-20250514",
      timestamp: new Date().toISOString(),
    })}\n\n`,
    // text content
    `data: ${JSON.stringify({
      type: "text-start",
      id: "text_0",
    })}\n\n`,
    `data: ${JSON.stringify({
      type: "text-delta",
      id: "text_0",
      delta: text,
    })}\n\n`,
    `data: ${JSON.stringify({
      type: "text-end",
      id: "text_0",
    })}\n\n`,
    // finish
    `data: ${JSON.stringify({
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5 },
    })}\n\n`,
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
  model: "anthropic/claude-sonnet-4-20250514",
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    },
  ],
};

describe("POST /api/chat", () => {
  const store = useBetaClient("test-client-uuid");
  useCloudEnv({ AI_GATEWAY_API_KEY: "test-gateway-key" });
  let lastGatewayRequestBody: any = null;

  // Mock AI Gateway
  useFetchMock((url, init) => {
    if (url.includes("ai-gateway.vercel.sh")) {
      lastGatewayRequestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(fakeGatewayStream("Hello from Claude!"), {
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
        body: { model: "anthropic/claude-sonnet-4-20250514" },
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
    expect(res.headers.get("X-Clark-Model")).toBe("anthropic/claude-sonnet-4-20250514");

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

  test("returns gateway model ID in response header", async () => {
    const res = await handler(
      clientRequest("/api/chat", { body: validBody }),
    );
    expect(res.headers.get("X-Clark-Model")).toBe("anthropic/claude-sonnet-4-20250514");
  });

  test("forwards tool schemas in AI SDK format", async () => {
    lastGatewayRequestBody = null;

    const res = await handler(
      clientRequest("/api/chat", {
        body: {
          ...validBody,
          tools: [
            {
              name: "echo",
              description: "Echo text back",
              inputSchema: {
                type: "object",
                properties: {
                  text: {
                    type: "string",
                    description: "Text to echo",
                  },
                },
                required: ["text"],
              },
            },
          ],
        },
      }),
    );

    expect(res.status).toBe(200);
    await res.text();
    expect(lastGatewayRequestBody?.tools).toHaveLength(1);
    expect(lastGatewayRequestBody?.tools[0]).toMatchObject({
      type: "function",
      name: "echo",
      description: "Echo text back",
      inputSchema: {
        type: "object",
        required: ["text"],
      },
    });
    expect(lastGatewayRequestBody?.tools[0]?.inputSchema?.properties?.text).toMatchObject({
      type: "string",
      description: "Text to echo",
    });
  });

  test("handles legacy bare model IDs", async () => {
    const res = await handler(
      clientRequest("/api/chat", {
        body: { ...validBody, model: "claude-sonnet-4-20250514" },
      }),
    );
    expect(res.headers.get("X-Clark-Model")).toBe("anthropic/claude-sonnet-4-20250514");
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
      if (url.includes("ai-gateway.vercel.sh")) {
        throw new Error("Network connection refused");
      }
      return originalFetch(input);
    };
    try {
      const res = await handler(
        clientRequest("/api/chat", { body: validBody }),
      );
      // The handler catches the error; check for 500 or error in stream
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
