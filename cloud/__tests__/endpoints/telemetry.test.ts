import { describe, test, expect } from "bun:test";
import telemetryHandler from "../../api/telemetry.ts";
import {
  useMockRedis,
  useCloudEnv,
  clientRequest,
  anonRequest,
  jsonBody,
} from "../helpers.ts";

const handler = telemetryHandler.fetch.bind(telemetryHandler);

describe("POST /api/telemetry", () => {
  useMockRedis();
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
    const res = await handler(
      clientRequest("/api/telemetry", {
        body: { version: "0.1.0", provider: "clark-cloud" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
  });

  test("accepts telemetry with minimal body", async () => {
    const res = await handler(
      clientRequest("/api/telemetry", { body: {} }),
    );
    expect(res.status).toBe(200);
  });
});
