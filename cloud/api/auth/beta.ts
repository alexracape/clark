/**
 * POST /api/auth/beta — Redeem a beta code.
 *
 * Marks the client ID as "beta" tier in Redis.
 * Rate-limited aggressively (3 req/min) to prevent brute-force.
 */

import { createRateLimiter, checkRateLimit } from "../../lib/rate-limit.js";
import { getRedis } from "../../lib/redis.js";
import { errorResponse, methodNotAllowed } from "../../lib/errors.js";

const limiter = createRateLimiter(3, "60 s");

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();

  const clientId = req.headers.get("x-clark-client-id");
  if (!clientId) {
    return errorResponse(400, "Missing X-Clark-Client-Id header");
  }

  // Aggressive rate limiting on beta code redemption
  const rateLimited = await checkRateLimit(limiter, clientId);
  if (rateLimited) return rateLimited;

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const betaCode = process.env.BETA_CODE;
  if (!betaCode || body.code !== betaCode) {
    return errorResponse(401, "Invalid beta code");
  }

  const redis = getRedis();
  if (!redis) {
    return errorResponse(500, "Server misconfigured: missing Redis");
  }

  await redis.set(`beta:${clientId}`, "1");

  return new Response(
    JSON.stringify({ success: true, tier: "beta" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
