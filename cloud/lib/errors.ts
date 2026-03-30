/**
 * Standardized error response helpers for Clark Cloud endpoints.
 */

export function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export function methodNotAllowed(): Response {
  return errorResponse(405, "Method not allowed");
}
