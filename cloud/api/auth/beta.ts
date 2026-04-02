/**
 * POST /api/auth/beta — Redeem a beta code.
 *
 * Marks the client ID as "beta" tier in Redis.
 * Rate-limited aggressively (3 req/min) to prevent brute-force.
 */

import { authenticate } from "../../lib/auth.js";
import { createRateLimiter, checkRateLimit } from "../../lib/rate-limit.js";
import { getRedis } from "../../lib/redis.js";
import { errorResponse, methodNotAllowed } from "../../lib/errors.js";
import { logCloudError, logCloudInfo, logCloudWarn } from "../../lib/logging.js";

const limiter = createRateLimiter(3, "60 s");

function getSubmittedCode(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const { code } = body as { code?: unknown };
  return typeof code === "string" ? code.trim() : "";
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const { clientId } = auth;

    // Aggressive rate limiting on beta code redemption
    const rateLimited = await checkRateLimit(limiter, clientId);
    if (rateLimited) return rateLimited;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }

    const betaCode = process.env.BETA_CODE?.trim();
    if (!betaCode) {
      logCloudError("auth_beta_missing_code_env", {
        endpoint: "/api/auth/beta",
        clientId,
        error: new Error("Server misconfigured: missing BETA_CODE"),
      });
      return errorResponse(500, "Server misconfigured: missing BETA_CODE");
    }

    const submittedCode = getSubmittedCode(body);
    if (!submittedCode || submittedCode !== betaCode) {
      logCloudWarn("auth_beta_invalid_code", {
        endpoint: "/api/auth/beta",
        clientId,
        request: {
          hasCode: Boolean(submittedCode),
          submittedLength: submittedCode.length,
          expectedLength: betaCode.length,
        },
      });
      return errorResponse(401, "Invalid beta code");
    }

    const redis = getRedis();
    if (!redis) {
      logCloudError("auth_beta_missing_redis", {
        endpoint: "/api/auth/beta",
        clientId,
        error: new Error("Server misconfigured: missing Redis"),
      });
      return errorResponse(500, "Server misconfigured: missing Redis");
    }

    try {
      await redis.set(`beta:${clientId}`, "1");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logCloudError("auth_beta_redis_write_failed", {
        endpoint: "/api/auth/beta",
        clientId,
        error: err,
      });
      return errorResponse(500, `Beta redemption failed: ${msg}`);
    }

    logCloudInfo("auth_beta_redeemed", {
      endpoint: "/api/auth/beta",
      clientId,
    });

    return new Response(
      JSON.stringify({ success: true, tier: "beta" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
};
