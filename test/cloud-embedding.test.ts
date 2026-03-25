import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CloudEmbeddingProvider } from "../core/embedding/cloud.ts";

const CLOUD_URL = "https://test-cloud.example.com";
const CLOUD_SECRET = "test-secret";
const CLIENT_ID = "test-client-id";

describe("CloudEmbeddingProvider", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("has correct metadata", () => {
    const provider = new CloudEmbeddingProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    expect(provider.name).toBe("clark-cloud");
    expect(provider.modelId).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(1536);
  });

  it("returns empty array for empty input", async () => {
    const provider = new CloudEmbeddingProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it("embeds texts via cloud endpoint", async () => {
    const mockEmbeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe(`${CLOUD_URL}/api/embed`);
      expect(init?.method).toBe("POST");

      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${CLOUD_SECRET}`);
      expect(headers["X-Clark-Client-Id"]).toBe(CLIENT_ID);

      const body = JSON.parse(init?.body as string);
      expect(body.texts).toEqual(["hello", "world"]);

      return new Response(JSON.stringify({
        embeddings: mockEmbeddings,
        dimensions: 3,
        model: "text-embedding-3-small",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const provider = new CloudEmbeddingProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    const result = await provider.embed(["hello", "world"]);
    expect(result).toEqual(mockEmbeddings);
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = async () => {
      return new Response("Rate limited", { status: 429 });
    };

    const provider = new CloudEmbeddingProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    await expect(provider.embed(["test"]))
      .rejects.toThrow("Cloud embedding error (429)");
  });
});
