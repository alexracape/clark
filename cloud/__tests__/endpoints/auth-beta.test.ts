import { describe, test, expect } from "bun:test";
import handler from "../../api/auth/beta.ts";
import {
  useMockRedis,
  useCloudEnv,
  clientRequest,
  anonRequest,
  jsonBody,
} from "../helpers.ts";

describe("POST /api/auth/beta", () => {
  const store = useMockRedis();
  useCloudEnv({ BETA_CODE: "correct-beta-code" });

  test("rejects non-POST methods", async () => {
    const res = await handler(clientRequest("/api/auth/beta", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler(anonRequest("/api/auth/beta", { body: { code: "abc" } }));
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
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("returns 401 for wrong beta code", async () => {
    const res = await handler(
      clientRequest("/api/auth/beta", { body: { code: "wrong-code" } }),
    );
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect(body.error).toContain("Invalid beta code");
  });

  test("returns 401 when no code provided", async () => {
    const res = await handler(
      clientRequest("/api/auth/beta", { body: {} }),
    );
    expect(res.status).toBe(401);
  });

  test("succeeds with correct beta code and sets Redis key", async () => {
    store.clear();
    const clientId = "redeem-client";
    const res = await handler(
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

  test("returns 401 when BETA_CODE env var is not set", async () => {
    const original = process.env.BETA_CODE;
    delete process.env.BETA_CODE;
    try {
      const res = await handler(
        clientRequest("/api/auth/beta", { body: { code: "anything" } }),
      );
      expect(res.status).toBe(401);
    } finally {
      if (original) process.env.BETA_CODE = original;
    }
  });
});
