import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { authenticate } from "../auth.ts";

describe("authenticate", () => {
  const ORIGINAL_SECRET = process.env.CLARK_CLOUD_SECRET;

  beforeEach(() => {
    process.env.CLARK_CLOUD_SECRET = "test-secret-abc123";
  });

  afterEach(() => {
    if (ORIGINAL_SECRET !== undefined) {
      process.env.CLARK_CLOUD_SECRET = ORIGINAL_SECRET;
    } else {
      delete process.env.CLARK_CLOUD_SECRET;
    }
  });

  test("returns ok with valid auth and client ID", () => {
    const req = new Request("https://example.com/api/chat", {
      headers: {
        Authorization: "Bearer test-secret-abc123",
        "X-Clark-Client-Id": "uuid-1234",
      },
    });

    const result = authenticate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clientId).toBe("uuid-1234");
    }
  });

  test("returns 401 when Authorization header is missing", () => {
    const req = new Request("https://example.com/api/chat", {
      headers: { "X-Clark-Client-Id": "uuid-1234" },
    });

    const result = authenticate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  test("returns 401 when Authorization header has wrong format", () => {
    const req = new Request("https://example.com/api/chat", {
      headers: {
        Authorization: "Basic dXNlcjpwYXNz",
        "X-Clark-Client-Id": "uuid-1234",
      },
    });

    const result = authenticate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  test("returns 401 when token is wrong", () => {
    const req = new Request("https://example.com/api/chat", {
      headers: {
        Authorization: "Bearer wrong-secret",
        "X-Clark-Client-Id": "uuid-1234",
      },
    });

    const result = authenticate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  test("returns 400 when X-Clark-Client-Id is missing", () => {
    const req = new Request("https://example.com/api/chat", {
      headers: {
        Authorization: "Bearer test-secret-abc123",
      },
    });

    const result = authenticate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  test("returns 500 when CLARK_CLOUD_SECRET is not set", () => {
    delete process.env.CLARK_CLOUD_SECRET;

    const req = new Request("https://example.com/api/chat", {
      headers: {
        Authorization: "Bearer anything",
        "X-Clark-Client-Id": "uuid-1234",
      },
    });

    const result = authenticate(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
    }
  });
});
