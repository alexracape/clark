import { describe, test, expect } from "bun:test";
import handler from "../../api/auth/beta.ts";
import {
  useMockRedis,
  useCloudEnv,
  clientRequest,
  anonRequest,
  jsonBody,
  useConsoleCapture,
} from "../helpers.ts";
import { hashClientId } from "../../lib/dev-logging.ts";

describe("POST /api/auth/beta", () => {
  const store = useMockRedis();
  const logs = useConsoleCapture();
  useCloudEnv({ BETA_CODE: "correct-beta-code" });

  test("rejects non-POST methods", async () => {
    const res = await handler.fetch(clientRequest("/api/auth/beta", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler.fetch(anonRequest("/api/auth/beta", { body: { code: "abc" } }));
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toContain("X-Clark-Client-Id");
  });

  test("returns 400 for invalid JSON body", async () => {
    const req = new Request("https://test.clark.dev/api/auth/beta", {
      method: "POST",
      headers: { "X-Clark-Client-Id": "client-1" },
      body: "not json",
    });
    const res = await handler.fetch(req);
    expect(res.status).toBe(400);
  });

  test("returns 401 for wrong beta code", async () => {
    const res = await handler.fetch(
      clientRequest("/api/auth/beta", { body: { code: "wrong-code" } }),
    );
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect(body.error).toContain("Invalid beta code");
  });

  test("logs hashed client id for invalid beta code", async () => {
    const clientId = "beta-log-client";
    await handler.fetch(
      clientRequest("/api/auth/beta", {
        clientId,
        body: { code: "wrong-code" },
      }),
    );

    expect(logs.warns).toHaveLength(1);
    expect(logs.warns[0]?.[0]).toBe("[cloud] auth_beta_invalid_code");
    expect(logs.warns[0]?.[1]).toMatchObject({
      endpoint: "/api/auth/beta",
      clientIdHash: hashClientId(clientId),
      request: {
        hasCode: true,
      },
    });
    expect(JSON.stringify(logs.warns[0]?.[1])).not.toContain(clientId);
  });

  test("returns 401 when no code provided", async () => {
    const res = await handler.fetch(
      clientRequest("/api/auth/beta", { body: {} }),
    );
    expect(res.status).toBe(401);
  });

  test("succeeds with correct beta code and sets Redis key", async () => {
    store.clear();
    const clientId = "redeem-client";
    const res = await handler.fetch(
      clientRequest("/api/auth/beta", {
        clientId,
        body: { code: "correct-beta-code" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.success).toBe(true);
    expect(body.tier).toBe("beta");

    // Verify Redis key was set
    expect(store.get(`beta:${clientId}`)).toBe("1");
  });

  test("logs hashed client id on successful redemption", async () => {
    store.clear();
    const clientId = "redeem-log-client";
    await handler.fetch(
      clientRequest("/api/auth/beta", {
        clientId,
        body: { code: "correct-beta-code" },
      }),
    );

    expect(logs.infos).toHaveLength(1);
    expect(logs.infos[0]?.[0]).toBe("[cloud] auth_beta_redeemed");
    expect(logs.infos[0]?.[1]).toMatchObject({
      endpoint: "/api/auth/beta",
      clientIdHash: hashClientId(clientId),
    });
    expect(JSON.stringify(logs.infos[0]?.[1])).not.toContain(clientId);
  });

  test("returns 500 when BETA_CODE env var is not set", async () => {
    const original = process.env.BETA_CODE;
    delete process.env.BETA_CODE;
    try {
      const res = await handler.fetch(
        clientRequest("/api/auth/beta", { body: { code: "anything" } }),
      );
      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toContain("missing BETA_CODE");
    } finally {
      if (original) process.env.BETA_CODE = original;
    }
  });
});
