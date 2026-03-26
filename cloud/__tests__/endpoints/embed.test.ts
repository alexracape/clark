import { describe, test, expect } from "bun:test";
import embedHandler from "../../api/embed.ts";
import {
  useMockRedis,
  useBetaClient,
  useCloudEnv,
  useFetchMock,
  clientRequest,
  anonRequest,
  jsonBody,
} from "../helpers.ts";

const handler = embedHandler.fetch.bind(embedHandler);

describe("POST /api/embed", () => {
  const store = useBetaClient("test-client-uuid");
  useCloudEnv({ OPENAI_API_KEY: "sk-test-key" });

  // Mock OpenAI embeddings API
  useFetchMock((url, init) => {
    if (url.includes("api.openai.com/v1/embeddings")) {
      const body = JSON.parse(init?.body as string);
      const texts = body.input as string[];
      const data = texts.map((_, i) => ({
        object: "embedding",
        index: i,
        embedding: Array.from({ length: 1536 }, () => Math.random()),
      }));
      return Response.json({ object: "list", data, model: "text-embedding-3-small" });
    }
    return null;
  });

  test("rejects non-POST methods", async () => {
    const res = await handler(clientRequest("/api/embed", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler(
      anonRequest("/api/embed", { body: { texts: ["hello"] } }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 403 for anonymous client (beta-gated)", async () => {
    store.clear(); // remove beta key → anonymous
    const res = await handler(
      clientRequest("/api/embed", { body: { texts: ["hello"] } }),
    );
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.required).toBe("beta");
    expect(body.current).toBe("anonymous");

    // Restore beta status for other tests
    store.set("beta:test-client-uuid", "1");
  });

  test("returns 400 when texts is not an array", async () => {
    const res = await handler(
      clientRequest("/api/embed", { body: { texts: "not an array" } }),
    );
    expect(res.status).toBe(400);
  });

  test("returns empty embeddings for empty input", async () => {
    const res = await handler(
      clientRequest("/api/embed", { body: { texts: [] } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.embeddings).toEqual([]);
  });

  test("returns embeddings for valid input", async () => {
    const res = await handler(
      clientRequest("/api/embed", { body: { texts: ["hello", "world"] } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.embeddings.length).toBe(2);
    expect(body.embeddings[0].length).toBe(1536);
    expect(body.model).toBe("text-embedding-3-small");
  });

  test("returns 500 when OPENAI_API_KEY is missing", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const res = await handler(
        clientRequest("/api/embed", { body: { texts: ["hello"] } }),
      );
      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toContain("OPENAI_API_KEY");
    } finally {
      if (original) process.env.OPENAI_API_KEY = original;
    }
  });
});
