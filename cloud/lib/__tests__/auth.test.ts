import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { authenticate, requireTier, type AuthResult } from "../auth.ts";
import { _setRedisForTesting } from "../redis.ts";

/**
 * Minimal mock Redis that supports get/set for beta:<clientId> keys.
 */
function createMockRedis(store: Map<string, string> = new Map()) {
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); },
  } as any;
}

describe("authenticate", () => {
  const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
  const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    // Ensure Redis env vars are set so getRedis() returns the mock
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  });

  afterEach(() => {
    if (ORIGINAL_URL !== undefined) process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
    else delete process.env.UPSTASH_REDIS_REST_URL;
    if (ORIGINAL_TOKEN !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
    else delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const req = new Request("https://example.com/api/chat");
    const result = await authenticate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  test("returns anonymous tier when client has no beta key", async () => {
    _setRedisForTesting(createMockRedis());

    const req = new Request("https://example.com/api/chat", {
      headers: { "X-Clark-Client-Id": "uuid-1234" },
    });

    const result = await authenticate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clientId).toBe("uuid-1234");
      expect(result.tier).toBe("anonymous");
    }
  });

  test("returns beta tier when client has beta key in Redis", async () => {
    const store = new Map([["beta:uuid-1234", "1"]]);
    _setRedisForTesting(createMockRedis(store));

    const req = new Request("https://example.com/api/chat", {
      headers: { "X-Clark-Client-Id": "uuid-1234" },
    });

    const result = await authenticate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clientId).toBe("uuid-1234");
      expect(result.tier).toBe("beta");
    }
  });

  test("falls back to anonymous when Redis is unavailable", async () => {
    // No Redis env vars → getRedis() returns null
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // Force null by resetting the singleton
    _setRedisForTesting(null as any);

    const req = new Request("https://example.com/api/chat", {
      headers: { "X-Clark-Client-Id": "uuid-1234" },
    });

    // Need to clear the redis module cache to pick up deleted env vars
    // Since _setRedisForTesting sets the singleton, and getRedis checks the singleton first,
    // we need a different approach — just verify the timeout/error path
    const result = await authenticate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tier).toBe("anonymous");
    }
  });
});

describe("requireTier", () => {
  const anonymousAuth: AuthResult = { ok: true, clientId: "test", tier: "anonymous" };
  const betaAuth: AuthResult = { ok: true, clientId: "test", tier: "beta" };

  test("allows anonymous when anonymous is required", () => {
    expect(requireTier("anonymous", anonymousAuth)).toBeNull();
  });

  test("allows beta when anonymous is required", () => {
    expect(requireTier("anonymous", betaAuth)).toBeNull();
  });

  test("allows beta when beta is required", () => {
    expect(requireTier("beta", betaAuth)).toBeNull();
  });

  test("rejects anonymous when beta is required", () => {
    const result = requireTier("beta", anonymousAuth);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
