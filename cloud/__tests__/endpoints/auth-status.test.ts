import { describe, test, expect } from "bun:test";
import handler from "../../api/auth/status.ts";
import {
  useMockRedis,
  useCloudEnv,
  clientRequest,
  anonRequest,
  jsonBody,
} from "../helpers.ts";

describe("GET /api/auth/status", () => {
  const store = useMockRedis();
  useCloudEnv();

  test("rejects non-GET methods", async () => {
    const res = await handler.fetch(clientRequest("/api/auth/status", { method: "POST" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler.fetch(anonRequest("/api/auth/status", { method: "GET" }));
    expect(res.status).toBe(400);
  });

  test("returns anonymous tier for unknown client", async () => {
    store.clear();
    const res = await handler.fetch(
      clientRequest("/api/auth/status", { method: "GET", clientId: "unknown-client" }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.tier).toBe("anonymous");
    expect(body.clientId).toBe("unknown-client");
  });

  test("returns beta tier for client with beta key", async () => {
    store.set("beta:beta-client", "1");
    const res = await handler.fetch(
      clientRequest("/api/auth/status", { method: "GET", clientId: "beta-client" }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.tier).toBe("beta");
    expect(body.clientId).toBe("beta-client");
  });
});
