import { describe, test, expect } from "bun:test";
import feedbackHandler from "../../api/feedback.ts";
import {
  useMockRedis,
  useCloudEnv,
  useFetchMock,
  clientRequest,
  anonRequest,
  jsonBody,
} from "../helpers.ts";

const handler = feedbackHandler.fetch.bind(feedbackHandler);

describe("POST /api/feedback", () => {
  useMockRedis();
  useCloudEnv({ DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test" });

  // Mock Discord webhook
  useFetchMock((url) => {
    if (url.includes("discord.com/api/webhooks")) {
      return new Response(null, { status: 204 });
    }
    return null;
  });

  test("rejects non-POST methods", async () => {
    const res = await handler(clientRequest("/api/feedback", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler(
      anonRequest("/api/feedback", { body: { embeds: [] } }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid JSON body", async () => {
    const req = new Request("https://test.clark.dev/api/feedback", {
      method: "POST",
      headers: { "X-Clark-Client-Id": "client-1" },
      body: "not json",
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("anonymous client can send feedback (no tier gate)", async () => {
    const res = await handler(
      clientRequest("/api/feedback", {
        body: { embeds: [{ title: "Test feedback" }] },
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
  });

  test("returns 500 when DISCORD_WEBHOOK_URL is missing", async () => {
    const original = process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_URL;
    try {
      const res = await handler(
        clientRequest("/api/feedback", {
          body: { embeds: [{ title: "Test" }] },
        }),
      );
      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toContain("DISCORD_WEBHOOK_URL");
    } finally {
      if (original) process.env.DISCORD_WEBHOOK_URL = original;
    }
  });

  test("returns 502 when Discord webhook fails", async () => {
    // Temporarily replace the fetch mock with one that returns an error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.includes("discord.com")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return originalFetch(input);
    }) as typeof fetch;
    try {
      const res = await handler(
        clientRequest("/api/feedback", {
          body: { embeds: [{ title: "Test" }] },
        }),
      );
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
