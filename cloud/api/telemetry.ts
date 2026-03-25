/**
 * Telemetry endpoint — records anonymous DAU data.
 *
 * Accepts a lightweight ping with clientId, version, and provider.
 * Stores only a set membership (SADD) in Redis for DAU counting.
 * No auth required — payload is fully anonymous.
 */

import { Redis } from "@upstash/redis";
import { errorResponse, methodNotAllowed } from "../lib/errors.ts";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return redis;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return methodNotAllowed();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const { clientId, version, provider } = body;
  if (!clientId) {
    return errorResponse(400, "Missing required field: clientId");
  }

  try {
    const db = getRedis();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Track DAU: SADD dau:<date> <clientId>
    await db.sadd(`dau:${today}`, clientId);

    // Set 90-day TTL on the key (idempotent)
    await db.expire(`dau:${today}`, 90 * 24 * 60 * 60);

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch {
    // Telemetry is best-effort — never fail the request
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}
