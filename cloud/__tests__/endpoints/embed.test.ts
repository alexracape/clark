import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import embedHandler from "../../api/embed.ts";
import {
  useMockRedis,
  useBetaClient,
  useCloudEnv,
  clientRequest,
  anonRequest,
  jsonBody,
  useConsoleCapture,
} from "../helpers.ts";
import { hashClientId } from "../../lib/dev-logging.ts";

const handler = embedHandler.fetch.bind(embedHandler);

// Mock the AI SDK's embedMany function
const mockEmbedMany = mock(() =>
  Promise.resolve({
    embeddings: [
      Array.from({ length: 1536 }, () => Math.random()),
      Array.from({ length: 1536 }, () => Math.random()),
    ],
  }),
);

// Mock the gateway module
mock.module("ai", () => ({
  embedMany: mockEmbedMany,
}));

mock.module("@ai-sdk/gateway", () => ({
  gateway: {
    textEmbeddingModel: (modelId: string) => ({ modelId }),
  },
}));

describe("POST /api/embed", () => {
  const store = useBetaClient("test-client-uuid");
  const logs = useConsoleCapture();
  useCloudEnv({});

  beforeEach(() => {
    mockEmbedMany.mockClear();
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
    // Should not call embedMany for empty input
    expect(mockEmbedMany).not.toHaveBeenCalled();
  });

  test("returns embeddings for valid input", async () => {
    const res = await handler(
      clientRequest("/api/embed", { body: { texts: ["hello", "world"] } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.embeddings.length).toBe(2);
    expect(body.embeddings[0].length).toBe(1536);
    expect(body.model).toBe("openai/text-embedding-3-small");
    expect(mockEmbedMany).toHaveBeenCalledTimes(1);
  });

  test("returns 500 when embedMany throws", async () => {
    mockEmbedMany.mockRejectedValueOnce(new Error("Gateway unavailable"));
    const clientId = "embed-log-client";
    store.set(`beta:${clientId}`, "1");
    const res = await handler(
      clientRequest("/api/embed", { clientId, body: { texts: ["hello"] } }),
    );
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body.error).toContain("Gateway unavailable");
    expect(logs.errors).toHaveLength(1);
    expect(logs.errors[0]?.[0]).toBe("[cloud] embed_failed");
    expect(logs.errors[0]?.[1]).toMatchObject({
      endpoint: "/api/embed",
      clientIdHash: hashClientId(clientId),
      request: {
        model: "openai/text-embedding-3-small",
        textCount: 1,
        totalChars: 5,
      },
      error: {
        kind: "internal",
        message: "Gateway unavailable",
      },
    });
    expect(JSON.stringify(logs.errors[0]?.[1])).not.toContain(clientId);
  });
});
