/**
 * Integration test for cloud providers.
 *
 * Starts a local Bun HTTP server that mimics all cloud endpoints,
 * then tests CloudLLMProvider, CloudOCRProvider, and CloudEmbeddingProvider
 * against it end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Server } from "bun";
import { CloudLLMProvider } from "../core/llm/cloud.ts";
import { CloudOCRProvider } from "../core/ocr/cloud.ts";
import { CloudEmbeddingProvider } from "../core/embedding/cloud.ts";
import type { StreamChunk } from "../core/llm/provider.ts";

const TEST_SECRET = "test-integration-secret";
const TEST_CLIENT_ID = "test-client-uuid";

let server: Server;
let baseUrl: string;

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      // Auth check (skip for telemetry)
      if (url.pathname !== "/api/telemetry") {
        const auth = req.headers.get("Authorization");
        if (auth !== `Bearer ${TEST_SECRET}`) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        const clientId = req.headers.get("X-Clark-Client-Id");
        if (!clientId) {
          return new Response(JSON.stringify({ error: "Missing client ID" }), { status: 400 });
        }
      }

      // POST /api/chat — mock streaming response
      if (url.pathname === "/api/chat" && req.method === "POST") {
        const body = await req.json() as any;
        const events = [
          sseEvent({ type: "text_delta", text: "Hello " }),
          sseEvent({ type: "text_delta", text: "world!" }),
          sseEvent({ type: "done", stopReason: "end_turn" }),
        ];

        // If tools are provided and message asks about them, simulate tool use
        if (body.tools?.length > 0 && body.messages?.some((m: any) =>
          m.content?.some?.((c: any) => c.text?.includes("use tool")))
        ) {
          return new Response(
            [
              sseEvent({ type: "tool_use_start", id: "t1", name: body.tools[0].name }),
              sseEvent({ type: "tool_input_delta", text: '{"query":"test"}' }),
              sseEvent({ type: "done", stopReason: "tool_use" }),
            ].join(""),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }

        return new Response(events.join(""), {
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      // POST /api/ocr — mock OCR
      if (url.pathname === "/api/ocr" && req.method === "POST") {
        const body = await req.json() as any;
        if (body.pdf) {
          return Response.json({ markdown: "# PDF Page 1\nContent here", pageCount: 1 });
        }
        if (body.image) {
          return Response.json({ markdown: "# Image transcription" });
        }
        return new Response(JSON.stringify({ error: "Missing pdf or image" }), { status: 400 });
      }

      // POST /api/embed — mock embeddings
      if (url.pathname === "/api/embed" && req.method === "POST") {
        const body = await req.json() as any;
        const embeddings = (body.texts as string[]).map(() =>
          Array.from({ length: 1536 }, () => Math.random())
        );
        return Response.json({
          embeddings,
          dimensions: 1536,
          model: "text-embedding-3-small",
        });
      }

      // POST /api/feedback — mock feedback
      if (url.pathname === "/api/feedback" && req.method === "POST") {
        return Response.json({ ok: true });
      }

      // POST /api/telemetry — mock telemetry
      if (url.pathname === "/api/telemetry" && req.method === "POST") {
        return Response.json({ ok: true });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop();
});

// --- CloudLLMProvider ---

describe("CloudLLMProvider integration", () => {
  it("streams text deltas from mock server", async () => {
    const provider = new CloudLLMProvider(baseUrl, TEST_SECRET, TEST_CLIENT_ID, "anthropic", "claude-sonnet-4-6");
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.chat(
      [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      [],
      "You are a helpful assistant.",
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(3);
    expect(chunks[0]).toEqual({ type: "text_delta", text: "Hello " });
    expect(chunks[1]).toEqual({ type: "text_delta", text: "world!" });
    expect(chunks[2]).toEqual({ type: "done", stopReason: "end_turn" });
  });

  it("streams tool use from mock server", async () => {
    const provider = new CloudLLMProvider(baseUrl, TEST_SECRET, TEST_CLIENT_ID, "anthropic", "claude-sonnet-4-6");
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.chat(
      [{ role: "user", content: [{ type: "text", text: "please use tool" }] }],
      [{ name: "search", description: "Search notes", inputSchema: { type: "object", properties: { query: { type: "string" } } } }],
      "System prompt",
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(3);
    expect(chunks[0]).toEqual({ type: "tool_use_start", id: "t1", name: "search" });
    expect(chunks[1]).toEqual({ type: "tool_input_delta", text: '{"query":"test"}' });
    expect(chunks[2]).toEqual({ type: "done", stopReason: "tool_use" });
  });

  it("rejects unauthorized requests", async () => {
    const provider = new CloudLLMProvider(baseUrl, "wrong-secret", TEST_CLIENT_ID, "anthropic", "claude-sonnet-4-6");

    await expect(async () => {
      for await (const _chunk of provider.chat(
        [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        [],
        "System",
      )) {
        // should throw before yielding
      }
    }).toThrow("Cloud proxy error (401)");
  });
});

// --- CloudOCRProvider ---

describe("CloudOCRProvider integration", () => {
  it("transcribes an image", async () => {
    const provider = new CloudOCRProvider(baseUrl, TEST_SECRET, TEST_CLIENT_ID);
    const result = await provider.transcribeImage(new ArrayBuffer(10), "image/png");
    expect(result).toBe("# Image transcription");
  });

  it("transcribes a PDF", async () => {
    const provider = new CloudOCRProvider(baseUrl, TEST_SECRET, TEST_CLIENT_ID);
    const result = await provider.transcribePDF(new ArrayBuffer(100));
    expect(result.markdown).toBe("# PDF Page 1\nContent here");
    expect(result.pageCount).toBe(1);
  });

  it("rejects unauthorized requests", async () => {
    const provider = new CloudOCRProvider(baseUrl, "wrong-secret", TEST_CLIENT_ID);
    await expect(provider.transcribeImage(new ArrayBuffer(10), "image/png"))
      .rejects.toThrow("Cloud OCR error (401)");
  });
});

// --- CloudEmbeddingProvider ---

describe("CloudEmbeddingProvider integration", () => {
  it("returns embeddings with correct dimensions", async () => {
    const provider = new CloudEmbeddingProvider(baseUrl, TEST_SECRET, TEST_CLIENT_ID);
    const result = await provider.embed(["hello", "world"]);
    expect(result.length).toBe(2);
    expect(result[0]!.length).toBe(1536);
    expect(result[1]!.length).toBe(1536);
  });

  it("returns empty array for empty input", async () => {
    const provider = new CloudEmbeddingProvider(baseUrl, TEST_SECRET, TEST_CLIENT_ID);
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it("rejects unauthorized requests", async () => {
    const provider = new CloudEmbeddingProvider(baseUrl, "wrong-secret", TEST_CLIENT_ID);
    await expect(provider.embed(["test"]))
      .rejects.toThrow("Cloud embedding error (401)");
  });
});

// --- Telemetry ---

describe("Telemetry integration", () => {
  it("accepts anonymous telemetry ping", async () => {
    const res = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: TEST_CLIENT_ID, version: "0.1.0", provider: "clark-cloud" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });
});

// --- Feedback ---

describe("Feedback integration", () => {
  it("sends feedback through proxy", async () => {
    const res = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TEST_SECRET}`,
        "X-Clark-Client-Id": TEST_CLIENT_ID,
      },
      body: JSON.stringify({ embeds: [{ title: "Test feedback" }] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });
});
