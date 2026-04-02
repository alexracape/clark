/**
 * Tiered authentication for Clark Cloud endpoints.
 *
 * Extracts the anonymous client ID from `X-Clark-Client-Id` and looks up
 * the client's tier in Redis. No shared secrets are embedded in the client.
 *
 * Tiers (ordered):
 *   anonymous (0) — anyone with a valid client ID
 *   beta     (1) — redeemed a beta code
 */

import { getRedis } from "./redis.js";

export type Tier = "anonymous" | "beta";

const TIER_LEVEL: Record<Tier, number> = {
  anonymous: 0,
  beta: 1,
};

export interface AuthResult {
  ok: true;
  clientId: string;
  tier: Tier;
}

export interface AuthError {
  ok: false;
  response: Response;
}

const REDIS_TIMEOUT_MS = 1000;

/**
 * Authenticate an incoming request.
 *
 * Extracts `X-Clark-Client-Id` and resolves the client's tier from Redis.
 * Returns AuthError with an appropriate Response if the request is invalid.
 */
export async function authenticate(req: Request): Promise<AuthResult | AuthError> {
  const clientId = req.headers.get("x-clark-client-id");
  if (!clientId) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Missing X-Clark-Client-Id header" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const redis = getRedis();
  if (!redis) {
    // No Redis configured — default to anonymous (rate limiter will catch misconfiguration separately)
    return { ok: true, clientId, tier: "anonymous" };
  }

  try {
    const betaKey = await Promise.race([
      redis.get<string>(`beta:${clientId}`),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Redis timeout")), REDIS_TIMEOUT_MS),
      ),
    ]);

    const tier: Tier = betaKey ? "beta" : "anonymous";
    return { ok: true, clientId, tier };
  } catch {
    // Redis failure — fail open to anonymous rather than blocking all requests
    return { ok: true, clientId, tier: "anonymous" };
  }
}

/**
 * Check that the authenticated client meets the minimum tier requirement.
 *
 * Returns a 403 Response if the client's tier is too low, or null if allowed.
 */
export function requireTier(minTier: Tier, auth: AuthResult): Response | null {
  if (TIER_LEVEL[auth.tier] >= TIER_LEVEL[minTier]) {
    return null; // allowed
  }

  return new Response(
    JSON.stringify({
      error: "Insufficient access tier",
      required: minTier,
      current: auth.tier,
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}
