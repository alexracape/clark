import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createRateLimiter, checkRateLimit, _bypassRateLimitForTesting } from "../rate-limit.ts";

describe("rate-limit", () => {
  const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
  const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    // Disable bypass so we can test actual rate limit logic
    _bypassRateLimitForTesting(false);
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  afterEach(() => {
    // Re-enable bypass for other test files that share the module
    _bypassRateLimitForTesting(true);
    if (ORIGINAL_URL !== undefined) {
      process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
    } else {
      delete process.env.UPSTASH_REDIS_REST_URL;
    }

    if (ORIGINAL_TOKEN !== undefined) {
      process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
    } else {
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
  });

  test("createRateLimiter returns a Ratelimit instance", () => {
    // This tests that the factory function works without needing a real Redis connection.
    // The limiter object is created lazily — Redis is only contacted on .limit() calls.
    const limiter = createRateLimiter(10, "60 s");
    expect(limiter).toBeDefined();
    expect(typeof limiter.limit).toBe("function");
  });

  test("createRateLimiter returns null when Upstash env is missing", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const limiter = createRateLimiter(10, "60 s");
    expect(limiter).toBeNull();
  });

  test("checkRateLimit returns 500 when Upstash env is missing", async () => {
    const result = await checkRateLimit(null, "test-client-id");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);

    const body = await result!.json();
    expect(body.error).toContain("missing Upstash Redis configuration");
  });

  test("checkRateLimit returns null when rate limit succeeds", async () => {
    // Create a mock limiter that always succeeds
    const mockLimiter = {
      limit: async (_id: string) => ({
        success: true,
        remaining: 9,
        limit: 10,
        reset: Date.now() + 60000,
        pending: Promise.resolve(),
      }),
    } as any;

    const result = await checkRateLimit(mockLimiter, "test-client-id");
    expect(result).toBeNull();
  });

  test("checkRateLimit returns 429 response when rate limit exceeded", async () => {
    const resetTime = Date.now() + 30000;
    const mockLimiter = {
      limit: async (_id: string) => ({
        success: false,
        remaining: 0,
        limit: 10,
        reset: resetTime,
        pending: Promise.resolve(),
      }),
    } as any;

    const result = await checkRateLimit(mockLimiter, "test-client-id");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);

    const body = await result!.json();
    expect(body.error).toBe("Rate limit exceeded");
    expect(typeof body.retryAfter).toBe("number");
    expect(result!.headers.get("Retry-After")).toBeTruthy();
  });

  test("checkRateLimit returns 500 when Redis throws", async () => {
    const mockLimiter = {
      limit: async () => {
        throw new Error("redis unavailable");
      },
    } as any;

    const result = await checkRateLimit(mockLimiter, "test-client-id");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);

    const body = await result!.json();
    expect(body.error).toContain("Rate limiting unavailable");
  });
});
