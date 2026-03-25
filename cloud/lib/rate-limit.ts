/**
 * Rate limiting for Clark Cloud endpoints.
 *
 * Uses Upstash Redis with sliding window algorithm.
 * Rate limit keys are `rl:<clientId>` — no IP addresses stored.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return redis;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

/**
 * Create a rate limiter with the given configuration.
 *
 * @param limit - Maximum number of requests in the window
 * @param window - Time window (e.g., "60 s", "10 m")
 */
export function createRateLimiter(limit: number, window: Parameters<typeof Ratelimit.slidingWindow>[1]) {
  return new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: "rl",
  });
}

/**
 * Check rate limit for a given client ID.
 * Returns a 429 Response if the limit is exceeded, or null if the request is allowed.
 */
export async function checkRateLimit(
  limiter: Ratelimit,
  clientId: string,
): Promise<Response | null> {
  const { success, remaining, reset } = await limiter.limit(clientId);

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

/** Override the Redis instance (for testing). */
export function _setRedisForTesting(r: Redis) {
  redis = r;
}
