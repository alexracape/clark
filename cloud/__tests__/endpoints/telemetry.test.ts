import { describe, test, expect } from "bun:test";
import telemetryHandler from "../../api/telemetry.ts";
import {
  useMockRedis,
  useCloudEnv,
  clientRequest,
  anonRequest,
  jsonBody,
  useConsoleCapture,
} from "../helpers.ts";
import { hashClientId } from "../../lib/dev-logging.ts";

const handler = telemetryHandler.fetch.bind(telemetryHandler);

describe("POST /api/telemetry", () => {
  useMockRedis();
  const logs = useConsoleCapture();
  useCloudEnv();

  test("rejects non-POST methods", async () => {
    const res = await handler(clientRequest("/api/telemetry", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler(
      anonRequest("/api/telemetry", { body: { version: "1.0" } }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid JSON body", async () => {
    const req = new Request("https://test.clark.dev/api/telemetry", {
      method: "POST",
      headers: { "X-Clark-Client-Id": "client-1" },
      body: "not json",
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("accepts valid telemetry ping", async () => {
    const clientId = "telemetry-client";
    const res = await handler(
      clientRequest("/api/telemetry", {
        clientId,
        body: { version: "9.9.9", provider: "clark-cloud" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
    expect(logs.infos).toHaveLength(1);
    expect(logs.infos[0]?.[0]).toBe("[cloud] telemetry_stubbed");
    expect(logs.infos[0]?.[1]).toMatchObject({
      endpoint: "/api/telemetry",
      clientIdHash: hashClientId(clientId),
      request: {
        version: "9.9.9",
        provider: "clark-cloud",
      },
    });
    expect(JSON.stringify(logs.infos[0]?.[1])).not.toContain(clientId);
  });

  test("accepts telemetry with minimal body", async () => {
    const res = await handler(
      clientRequest("/api/telemetry", { body: {} }),
    );
    expect(res.status).toBe(200);
  });
});
