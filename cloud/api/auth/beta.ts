/**
 * POST /api/auth/beta — Redeem a beta code.
 *
 * Marks the client ID as "beta" tier in Redis.
 * Rate-limited aggressively (3 req/min) to prevent brute-force.
 */

import { authenticate } from "../../lib/auth.ts";
import { createRateLimiter, checkRateLimit } from "../../lib/rate-limit.ts";
import { getRedis } from "../../lib/redis.ts";
import { errorResponse, methodNotAllowed } from "../../lib/errors.ts";

const limiter = createRateLimiter(3, "60 s");

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const { clientId } = auth;

    // Aggressive rate limiting on beta code redemption
    const rateLimited = await checkRateLimit(limiter, clientId);
    if (rateLimited) return rateLimited;

    let body: { code?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }

    const betaCode = process.env.BETA_CODE?.trim();
    if (!betaCode) {
      console.error("[auth/beta] missing BETA_CODE env");
      return errorResponse(500, "Server misconfigured: missing BETA_CODE");
    }

    const submittedCode = typeof body.code === "string" ? body.code.trim() : "";
    if (!submittedCode || submittedCode !== betaCode) {
      console.warn("[auth/beta] invalid beta code", {
        clientId,
        hasCode: Boolean(submittedCode),
        submittedLength: submittedCode.length,
        expectedLength: betaCode.length,
      });
      return errorResponse(401, "Invalid beta code");
    }

    const redis = getRedis();
    if (!redis) {
      return errorResponse(500, "Server misconfigured: missing Redis");
    }

    await redis.set(`beta:${clientId}`, "1");
    console.info("[auth/beta] beta code redeemed", { clientId });

    return new Response(
      JSON.stringify({ success: true, tier: "beta" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
};
