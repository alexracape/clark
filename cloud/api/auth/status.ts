/**
 * GET /api/auth/status — Check the client's access tier.
 *
 * Returns the current tier for the given client ID.
 */

import { authenticate } from "../../lib/auth.js";
import { createRateLimiter, checkRateLimit } from "../../lib/rate-limit.js";
import { errorResponse, methodNotAllowed } from "../../lib/errors.js";
import { logCloudError } from "../../lib/logging.js";

const limiter = createRateLimiter(10, "60 s");

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "GET") return methodNotAllowed();

    try {
      const auth = await authenticate(req);
      if (!auth.ok) return auth.response;

      const rateLimited = await checkRateLimit(limiter, auth.clientId);
      if (rateLimited) return rateLimited;

      return new Response(
        JSON.stringify({ tier: auth.tier, clientId: auth.clientId }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logCloudError("auth_status_failed", {
        endpoint: "/api/auth/status",
        request: {
          method: req.method,
        },
        error: err,
      });
      return errorResponse(500, msg);
    }
  },
};
