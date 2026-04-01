import { afterEach, describe, expect, test } from "bun:test";
import { CloudSearchProvider } from "../core/search/cloud.ts";

describe("CloudSearchProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends correct headers and body", async () => {
    let capturedRequest: { url: string; headers: Record<string, string>; body: any } | null = null;

    globalThis.fetch = async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [key, value] of Object.entries(init.headers)) {
          headers[key] = value as string;
        }
      }
      capturedRequest = {
        url,
        headers,
        body: JSON.parse(init.body as string),
      };
      return new Response(JSON.stringify({
        query: "latest ai news",
        backend: "tavily",
        tier: "beta",
        isFallback: false,
        results: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const provider = new CloudSearchProvider("https://api.clark.dev", "uuid-123");
    await provider.search("latest ai news", 7);

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe("https://api.clark.dev/api/search");
    expect(capturedRequest!.headers["X-Clark-Client-Id"]).toBe("uuid-123");
    expect(capturedRequest!.body).toEqual({
      query: "latest ai news",
      maxResults: 7,
    });
  });

  test("throws on HTTP error", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
      });

    const provider = new CloudSearchProvider("https://api.clark.dev", "uuid-123");
    await expect(provider.search("latest ai news")).rejects.toThrow("429");
  });

  test("throws on invalid response shape", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ nope: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const provider = new CloudSearchProvider("https://api.clark.dev", "uuid-123");
    await expect(provider.search("latest ai news")).rejects.toThrow("invalid response shape");
  });
});
