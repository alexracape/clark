/**
 * Integration test for cloud providers.
 *
 * Starts a local Bun HTTP server that routes to the ACTUAL cloud handlers,
 * then tests CloudLLMProvider, CloudOCRProvider, and CloudEmbeddingProvider
 * against it end-to-end.
 *
 * External dependencies (Anthropic, OpenAI, Mistral, Discord) are mocked
 * via globalThis.fetch interception.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import type { Server } from "bun";
import { CloudLLMProvider } from "../core/llm/cloud.ts";
import { CloudOCRProvider } from "../core/ocr/cloud.ts";
import { CloudEmbeddingProvider } from "../core/embedding/cloud.ts";
import type { StreamChunk } from "../core/llm/provider.ts";

// Import actual handlers
import chatHandler from "../cloud/api/chat.ts";
import modelsHandler from "../cloud/api/models.ts";
import embedHandler from "../cloud/api/embed.ts";
import ocrHandler from "../cloud/api/ocr.ts";
import feedbackHandler from "../cloud/api/feedback.ts";
import telemetryHandler from "../cloud/api/telemetry.ts";

// Import test infrastructure
import { _setRedisForTesting } from "../cloud/lib/redis.ts";
import { _bypassRateLimitForTesting } from "../cloud/lib/rate-limit.ts";

const TEST_CLIENT_ID = "test-client-uuid";

let server: Server;
let baseUrl: string;
const originalFetch = globalThis.fetch;

// Mock Redis store
const redisStore = new Map<string, string>();

function createMockRedis() {
  return {
    get: async (key: string) => redisStore.get(key) ?? null,
    set: async (key: string, value: string) => { redisStore.set(key, value); },
  } as any;
}

/**
 * Build a fake AI Gateway streaming response (LanguageModelV3StreamPart SSE).
 */
function fakeGatewayStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = [
    `data: ${JSON.stringify({
      type: "response-metadata",
      id: "resp_test",
      modelId: "claude-sonnet-4-20250514",
      timestamp: new Date().toISOString(),
    })}\n\n`,
    `data: ${JSON.stringify({ type: "text-start", id: "text_0" })}\n\n`,
    `data: ${JSON.stringify({ type: "text-delta", id: "text_0", delta: text })}\n\n`,
    `data: ${JSON.stringify({ type: "text-end", id: "text_0" })}\n\n`,
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

beforeAll(() => {
  // Bypass rate limiting for integration tests
  _bypassRateLimitForTesting(true);

  // Set up mock Redis with beta access
  redisStore.set(`beta:${TEST_CLIENT_ID}`, "1");
  _setRedisForTesting(createMockRedis());

  // Set required env vars
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
  process.env.OPENAI_API_KEY = "sk-test-key";
  process.env.MISTRAL_API_KEY = "mistral-test-key";
  process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";

  // Start server routing to real handlers
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/api/chat": return chatHandler.fetch(req);
        case "/api/models": return modelsHandler.fetch(req);
        case "/api/embed": return embedHandler.fetch(req);
        case "/api/ocr": return ocrHandler.fetch(req);
        case "/api/feedback": return feedbackHandler.fetch(req);
        case "/api/telemetry": return telemetryHandler.fetch(req);
        default: return new Response("Not found", { status: 404 });
      }
    },
  });

  baseUrl = `http://localhost:${server.port}`;
});

beforeEach(() => {
  // Mock upstream API calls while letting local server requests through
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    // AI Gateway models mock
    if (url.includes("ai-gateway.vercel.sh/v1/models")) {
      return Response.json({
        data: [
          {
            id: "anthropic/claude-sonnet-4.6",
            name: "Claude Sonnet 4.6",
            type: "language",
            context_window: 200000,
            max_tokens: 128000,
            tags: ["tool-use", "vision", "reasoning"],
            owned_by: "anthropic",
          },
        ],
      });
    }

    // AI Gateway embedding model mock (must come before general gateway catch-all)
    if (url.includes("ai-gateway.vercel.sh") && url.includes("/embedding-model")) {
      const body = JSON.parse(init?.body as string);
      const values = body.values ?? body.input ?? [];
      const input = Array.isArray(values) ? values : [values];
      const embeddings = input.map(() =>
        Array.from({ length: 1536 }, () => Math.random()),
      );
      return Response.json({ embeddings });
    }

    // AI Gateway streaming mock
    if (url.includes("ai-gateway.vercel.sh")) {
      return new Response(fakeGatewayStream("Hello world!"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    // Mistral OCR mock
    if (url.includes("api.mistral.ai/v1/ocr")) {
      const body = JSON.parse(init?.body as string);
      const isPdf = body.document?.type === "document_url";
      return Response.json({
        pages: [
          { markdown: isPdf ? "# PDF Page 1\nContent" : "# Image transcription" },
          ...(isPdf ? [{ markdown: "# PDF Page 2\nMore content" }] : []),
        ],
      });
    }

    // Discord webhook mock
    if (url.includes("discord.com/api/webhooks")) {
      return new Response(null, { status: 204 });
    }

    // Pass through to real fetch (for local server requests)
    return originalFetch(input, init);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  server.stop();
  // Clean up env vars
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.DISCORD_WEBHOOK_URL;
});

// --- CloudLLMProvider ---

describe("CloudLLMProvider integration", () => {
  it("streams text deltas from real handler", async () => {
    const provider = new CloudLLMProvider(baseUrl, TEST_CLIENT_ID, "anthropic/claude-sonnet-4-20250514");
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.chat(
      [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      [],
      "You are a helpful assistant.",
    )) {
      chunks.push(chunk);
    }

    const textChunks = chunks.filter((c) => c.type === "text-delta");
    const doneChunks = chunks.filter((c) => c.type === "finish");
    expect(textChunks.length).toBeGreaterThan(0);
    expect(doneChunks.length).toBe(1);
    expect((doneChunks[0] as any).finishReason).toBe("end_turn");
  });

  it("rejects missing client ID", async () => {
    // Manually make a request without the X-Clark-Client-Id header
    const res = await originalFetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", messages: [] }),
    });
    expect(res.status).toBe(400);
  });
});

// --- Models endpoint ---

describe("Models endpoint integration", () => {
  it("returns filtered models from gateway", async () => {
    const res = await originalFetch(`${baseUrl}/api/models`, { method: "GET" });
    expect(res.status).toBe(200);
    const data = await res.json() as { models: any[] };
    expect(data.models.length).toBeGreaterThan(0);
    expect(data.models[0].id).toBe("anthropic/claude-sonnet-4.6");
    expect(data.models[0].provider).toBe("anthropic");
    expect(data.models[0].tags).toContain("tool-use");
    expect(data.models[0].tags).toContain("vision");
  });

  it("rejects non-GET methods", async () => {
    const res = await originalFetch(`${baseUrl}/api/models`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});

// --- CloudOCRProvider ---

describe("CloudOCRProvider integration", () => {
  it("transcribes an image through real handler", async () => {
    const provider = new CloudOCRProvider(baseUrl, TEST_CLIENT_ID);
    const result = await provider.transcribeImage(new ArrayBuffer(10), "image/png");
    expect(result).toContain("Image transcription");
  });

  it("transcribes a PDF through real handler", async () => {
    const provider = new CloudOCRProvider(baseUrl, TEST_CLIENT_ID);
    const result = await provider.transcribePDF(new ArrayBuffer(100));
    expect(result.markdown).toContain("PDF Page 1");
    expect(result.pageCount).toBe(2);
  });
});

// --- CloudEmbeddingProvider ---

describe("CloudEmbeddingProvider integration", () => {
  it("returns embeddings with correct dimensions through real handler", async () => {
    const provider = new CloudEmbeddingProvider(baseUrl, TEST_CLIENT_ID);
    const result = await provider.embed(["hello", "world"]);
    expect(result.length).toBe(2);
    expect(result[0]!.length).toBe(1536);
    expect(result[1]!.length).toBe(1536);
  });

  it("returns empty array for empty input", async () => {
    const provider = new CloudEmbeddingProvider(baseUrl, TEST_CLIENT_ID);
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });
});

// --- Telemetry ---

describe("Telemetry integration", () => {
  it("accepts telemetry ping through real handler", async () => {
    const res = await originalFetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clark-Client-Id": TEST_CLIENT_ID,
      },
      body: JSON.stringify({ version: "9.9.9", provider: "clark-cloud" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });
});

// --- Feedback ---

describe("Feedback integration", () => {
  it("sends feedback through real handler", async () => {
    const res = await originalFetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clark-Client-Id": TEST_CLIENT_ID,
      },
      body: JSON.stringify({ embeds: [{ title: "Test feedback" }] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });
});
