/**
 * Shared Upstash Redis singleton for Clark Cloud.
 *
 * Used by both auth (beta tier lookup) and rate limiting.
 */

import { Redis } from "@upstash/redis";

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!redis) {
    redis = new Redis({ url, token });
  }
  return redis;
}

/** Override the Redis instance (for testing). */
export function _setRedisForTesting(r: Redis) {
  redis = r;
}
