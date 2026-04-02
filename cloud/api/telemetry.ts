/**
 * Telemetry endpoint — temporarily stubbed during cloud migration debugging.
 *
 * Accepts the same lightweight ping, validates the payload shape, and exits
 * immediately so telemetry cannot mask backend issues elsewhere.
 */

import { authenticate } from "../lib/auth.js";
import { errorResponse, methodNotAllowed } from "../lib/errors.js";

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }

    const { version, provider } = body;

    console.info("[telemetry] stubbed", {
      clientId: auth.clientId,
      version: version ?? null,
      provider: provider ?? null,
    });

    return new Response(
      JSON.stringify({ ok: true, stubbed: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
};
