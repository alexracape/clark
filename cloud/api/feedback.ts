/**
 * Feedback Proxy — forwards user feedback to Discord webhook.
 *
 * Hides the Discord webhook URL from the client binary.
 */

import { authenticate } from "../lib/auth.js";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.js";
import { errorResponse, methodNotAllowed } from "../lib/errors.js";
import { logCloudError } from "../lib/logging.js";

const feedbackLimiter = createRateLimiter(5, "60 s");

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const rateLimited = await checkRateLimit(feedbackLimiter, auth.clientId);
    if (rateLimited) return rateLimited;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      logCloudError("feedback_missing_webhook", {
        endpoint: "/api/feedback",
        clientId: auth.clientId,
        error: new Error("Server misconfigured: missing DISCORD_WEBHOOK_URL"),
      });
      return errorResponse(500, "Server misconfigured: missing DISCORD_WEBHOOK_URL");
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logCloudError("feedback_webhook_failed", {
          endpoint: "/api/feedback",
          clientId: auth.clientId,
          details: {
            upstreamStatus: response.status,
          },
          error: new Error(`Discord webhook error: ${response.status}`),
        });
        return errorResponse(502, `Discord webhook error: ${response.status}`);
      }

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logCloudError("feedback_delivery_failed", {
        endpoint: "/api/feedback",
        clientId: auth.clientId,
        error: err,
      });
      return errorResponse(500, `Feedback delivery failed: ${msg}`);
    }
  },
};
