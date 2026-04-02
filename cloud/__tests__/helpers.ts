/**
 * Shared test helpers for cloud endpoint tests.
 *
 * Provides mock Redis, env var management, and request builders
 * so every endpoint test starts from a consistent baseline.
 */

import { beforeEach, afterEach } from "bun:test";
import { _setRedisForTesting } from "../lib/redis.ts";
import { _bypassRateLimitForTesting } from "../lib/rate-limit.ts";

// Bypass rate limiting for all endpoint tests.
// Rate limiter logic has its own dedicated tests in lib/__tests__/rate-limit.test.ts.
_bypassRateLimitForTesting(true);

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

export type MockStore = Map<string, string>;

/** Create a minimal Redis mock that supports get/set. */
export function createMockRedis(store: MockStore = new Map()) {
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as any;
}

/**
 * Install a mock Redis for the duration of each test.
 * Returns the backing store so tests can inspect/mutate it.
 */
export function useMockRedis(initial?: [string, string][]): MockStore {
  const store: MockStore = new Map(initial);

  beforeEach(() => {
    _setRedisForTesting(createMockRedis(store));
  });

  return store;
}

/**
 * Set up a mock Redis where a specific clientId is marked as beta.
 * Returns the backing store.
 */
export function useBetaClient(clientId: string): MockStore {
  return useMockRedis([[`beta:${clientId}`, "1"]]);
}

// ---------------------------------------------------------------------------
// Env var management
// ---------------------------------------------------------------------------

const envBackup = new Map<string, string | undefined>();

/** Set env vars for testing and auto-restore in afterEach. */
export function useEnv(vars: Record<string, string>) {
  beforeEach(() => {
    for (const [key, value] of Object.entries(vars)) {
      envBackup.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(vars)) {
      const original = envBackup.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
      envBackup.delete(key);
    }
  });
}

/** Standard env vars needed by most endpoint tests (Redis + tier lookup). */
export function useCloudEnv(extras: Record<string, string> = {}) {
  useEnv({
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
    ...extras,
  });
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

const BASE = "https://test.clark.dev";

/** Create a Request with the X-Clark-Client-Id header set. */
export function clientRequest(
  path: string,
  opts: {
    method?: string;
    clientId?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Request {
  const { method = "POST", clientId = "test-client-uuid", body, headers = {} } = opts;
  const init: RequestInit = {
    method,
    headers: {
      "X-Clark-Client-Id": clientId,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, init);
}

/** Create a Request without X-Clark-Client-Id (to test 400 responses). */
export function anonRequest(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Request {
  const { method = "POST", body } = opts;
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, init);
}

// ---------------------------------------------------------------------------
// Fetch interception for upstream API mocking
// ---------------------------------------------------------------------------

const _originalFetch = globalThis.fetch;
type FetchInput = string | URL | Request;

/**
 * Install a fetch interceptor that routes upstream API calls to mocks
 * while allowing other calls through. Auto-restores in afterEach.
 *
 * @param interceptor - receives (url, init) and returns Response or null (pass-through)
 */
export function useFetchMock(
  interceptor: (url: string, init?: RequestInit) => Response | Promise<Response> | null,
) {
  beforeEach(() => {
    globalThis.fetch = (async (input: FetchInput, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const result = interceptor(url, init);
      if (result !== null) return result instanceof Promise ? result : result;
      return _originalFetch(input, init);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = _originalFetch;
  });
}

// ---------------------------------------------------------------------------
// Console capture
// ---------------------------------------------------------------------------

export function useConsoleCapture() {
  const errors: unknown[][] = [];
  const warns: unknown[][] = [];
  const infos: unknown[][] = [];

  const original = {
    error: console.error,
    warn: console.warn,
    info: console.info,
  };

  beforeEach(() => {
    errors.length = 0;
    warns.length = 0;
    infos.length = 0;

    console.error = (...args) => {
      errors.push(args);
    };
    console.warn = (...args) => {
      warns.push(args);
    };
    console.info = (...args) => {
      infos.push(args);
    };
  });

  afterEach(() => {
    console.error = original.error;
    console.warn = original.warn;
    console.info = original.info;
  });

  return { errors, warns, infos };
}

// ---------------------------------------------------------------------------
// Response assertion helpers
// ---------------------------------------------------------------------------

/** Parse a JSON response body. */
export async function jsonBody<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
