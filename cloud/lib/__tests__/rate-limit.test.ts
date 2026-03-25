import { describe, test, expect } from "bun:test";
import { createRateLimiter, checkRateLimit } from "../rate-limit.ts";

describe("rate-limit", () => {
  test("createRateLimiter returns a Ratelimit instance", () => {
    // This tests that the factory function works without needing a real Redis connection.
    // The limiter object is created lazily — Redis is only contacted on .limit() calls.
    const limiter = createRateLimiter(10, "60 s");
    expect(limiter).toBeDefined();
    expect(typeof limiter.limit).toBe("function");
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
});
