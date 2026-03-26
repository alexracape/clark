/**
 * Rate limiting for Clark Cloud endpoints.
 *
 * Uses Upstash Redis with sliding window algorithm.
 * Rate limit keys are `rl:<clientId>` — no IP addresses stored.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./redis.js";

const REDIS_TIMEOUT_MS = 1000;

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

function timeoutAfter<T>(ms: number): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Rate limit timed out after ${ms}ms`)), ms);
  });
}

/**
 * Create a rate limiter with the given configuration.
 *
 * @param limit - Maximum number of requests in the window
 * @param window - Time window (e.g., "60 s", "10 m")
 */
export function createRateLimiter(
  limit: number,
  window: Parameters<typeof Ratelimit.slidingWindow>[1],
): Ratelimit | null {
  const db = getRedis();
  if (!db) return null;

  return new Ratelimit({
    redis: db,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: "rl",
  });
}

let _bypass = false;

/** Bypass rate limiting for tests. Rate limiter logic is tested separately. */
export function _bypassRateLimitForTesting(bypass: boolean) {
  _bypass = bypass;
}

/**
 * Check rate limit for a given client ID.
 * Returns a 429 Response if the limit is exceeded, or null if the request is allowed.
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  clientId: string,
): Promise<Response | null> {
  if (_bypass) return null;

  if (!limiter) {
    console.error("[rate-limit] missing Upstash Redis configuration", {
      hasUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      hasToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
      clientId,
    });
    return new Response(
      JSON.stringify({ error: "Server misconfigured: missing Upstash Redis configuration" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  let result: Awaited<ReturnType<Ratelimit["limit"]>>;
  try {
    result = await Promise.race([
      limiter.limit(clientId),
      timeoutAfter<Awaited<ReturnType<Ratelimit["limit"]>>>(REDIS_TIMEOUT_MS),
    ]);
  } catch (err) {
    console.error("[rate-limit] Upstash Redis request failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ error: "Rate limiting unavailable: Upstash Redis request failed" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { success, remaining, reset } = result;

  if (!success) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded", retryAfter }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(reset),
        },
      },
    );
  }

  return null;
}

