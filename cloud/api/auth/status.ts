/**
 * GET /api/auth/status — Check the client's access tier.
 *
 * Returns the current tier for the given client ID.
 */

import { authenticate } from "../../lib/auth.js";
import { createRateLimiter, checkRateLimit } from "../../lib/rate-limit.js";
import { methodNotAllowed } from "../../lib/errors.js";

const limiter = createRateLimiter(10, "60 s");

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return methodNotAllowed();

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  const rateLimited = await checkRateLimit(limiter, auth.clientId);
  if (rateLimited) return rateLimited;

  return new Response(
    JSON.stringify({ tier: auth.tier, clientId: auth.clientId }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
