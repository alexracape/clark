/**
 * Request authentication for Clark Cloud endpoints.
 *
 * Validates a shared beta secret and extracts the anonymous client ID.
 * The secret prevents random internet traffic; rate limiting (keyed by
 * clientId) provides the real abuse protection.
 */

export interface AuthResult {
  ok: true;
  clientId: string;
}

export interface AuthError {
  ok: false;
  response: Response;
}

/**
 * Authenticate an incoming request.
 *
 * Checks `Authorization: Bearer <secret>` against CLARK_CLOUD_SECRET env var,
 * and extracts the anonymous `X-Clark-Client-Id` header.
 */
export function authenticate(req: Request): AuthResult | AuthError {
  const secret = process.env.CLARK_CLOUD_SECRET;
  if (!secret) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Server misconfigured: missing CLARK_CLOUD_SECRET" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Missing or malformed Authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const token = authHeader.slice(7);
  if (token !== secret) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Invalid authorization token" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

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

  return { ok: true, clientId };
}
