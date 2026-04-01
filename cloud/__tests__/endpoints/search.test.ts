import { describe, expect, test } from "bun:test";
import searchHandler from "../../api/search.ts";
import {
  anonRequest,
  clientRequest,
  jsonBody,
  useBetaClient,
  useCloudEnv,
  useFetchMock,
} from "../helpers.ts";

const handler = searchHandler.fetch.bind(searchHandler);

describe("POST /api/search", () => {
  const store = useBetaClient("test-client-uuid");
  useCloudEnv({ TAVILY_API_KEY: "test-tavily-key" });

  let tavilyCalls = 0;
  let ddgCalls = 0;
  let lastTavilyBody: any = null;

  useFetchMock((url, init) => {
    if (url === "https://api.tavily.com/search") {
      tavilyCalls++;
      lastTavilyBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({
        query: "latest ai news",
        results: [
          {
            title: "Result One",
            url: "https://example.com/1",
            content: "Snippet one",
            published_date: "2026-03-30",
            last_updated: "2026-03-31",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("duckduckgo.com")) {
      ddgCalls++;
      return new Response(
        `<html><body>
          <div class="result">
            <a class="result__a" href="https://example.com/fallback">Fallback Result</a>
            <a class="result__snippet">Fallback snippet</a>
          </div>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    return null;
  });

  test("rejects non-POST methods", async () => {
    const res = await handler(clientRequest("/api/search", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler(
      anonRequest("/api/search", { body: { query: "latest ai news" } }),
    );
    expect(res.status).toBe(400);
  });

  test("beta client uses Tavily backend", async () => {
    tavilyCalls = 0;
    ddgCalls = 0;
    lastTavilyBody = null;

    const res = await handler(
      clientRequest("/api/search", {
        body: { query: "latest ai news", maxResults: 3 },
      }),
    );

    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.backend).toBe("tavily");
    expect(body.tier).toBe("beta");
    expect(body.isFallback).toBe(false);
    expect(body.results).toEqual([
      {
        title: "Result One",
        url: "https://example.com/1",
        snippet: "Snippet one",
        date: "2026-03-30",
        lastUpdated: "2026-03-31",
      },
    ]);
    expect(tavilyCalls).toBe(1);
    expect(ddgCalls).toBe(0);
    expect(lastTavilyBody).toEqual({
      query: "latest ai news",
      search_depth: "basic",
      topic: "general",
      max_results: 3,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
    });
  });

  test("anonymous client uses DuckDuckGo fallback", async () => {
    store.clear();
    tavilyCalls = 0;
    ddgCalls = 0;

    const res = await handler(
      clientRequest("/api/search", {
        body: { query: "clark notes" },
      }),
    );

    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.backend).toBe("duckduckgo");
    expect(body.tier).toBe("anonymous");
    expect(body.isFallback).toBe(true);
    expect(body.results).toEqual([
      {
        title: "Fallback Result",
        url: "https://example.com/fallback",
        snippet: "Fallback snippet",
      },
    ]);
    expect(tavilyCalls).toBe(0);
    expect(ddgCalls).toBe(1);

    store.set("beta:test-client-uuid", "1");
  });

  test("returns 500 when TAVILY_API_KEY is missing", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;

    try {
      const res = await handler(
        clientRequest("/api/search", {
          body: { query: "latest ai news" },
        }),
      );

      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toContain("TAVILY_API_KEY");
    } finally {
      process.env.TAVILY_API_KEY = originalKey;
    }
  });

  test("beta Tavily failures do not fall back to DuckDuckGo", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === "https://api.tavily.com/search") {
        return new Response(JSON.stringify({ error: "insufficient credits" }), {
          status: 432,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("duckduckgo.com")) {
        expect.unreachable("DuckDuckGo fallback should not run for beta failures");
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const res = await handler(
        clientRequest("/api/search", {
          body: { query: "latest ai news failure case" },
        }),
      );

      expect(res.status).toBe(502);
      const body = await jsonBody(res);
      expect(body.error).toContain("Tavily search failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("duckduckgo fallback handles html endpoint failure and uses lite endpoint", async () => {
    store.clear();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.includes("html.duckduckgo.com")) {
        return new Response("blocked", { status: 403 });
      }
      if (url.includes("lite.duckduckgo.com")) {
        return new Response(
          `<html><body>
            <tr>
              <td><a class="result-link" href="https://example.com/lite">Example Lite</a></td>
              <td class="result-snippet">Lite endpoint snippet</td>
            </tr>
          </body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const res = await handler(
        clientRequest("/api/search", { body: { query: "example query" } }),
      );
      expect(res.status).toBe(200);

      const body = await jsonBody(res);
      expect(body.backend).toBe("duckduckgo");
      expect(body.results[0]).toMatchObject({
        title: "Example Lite",
        url: "https://example.com/lite",
        snippet: "Lite endpoint snippet",
      });
    } finally {
      globalThis.fetch = originalFetch;
      store.set("beta:test-client-uuid", "1");
    }
  });
});
