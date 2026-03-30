import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createSidecarServer, subscribeStreamEvents } from "../gui/sidecar.ts";
import { isSidecarStreamEvent, type SidecarStreamEvent } from "../gui/src/stream-events.ts";
import { readVersionFile } from "../core/version.ts";

let server: Awaited<ReturnType<typeof createSidecarServer>>;
let workspaceDir: string;
let homeDir: string;
let configPath: string;

async function callRoute(path: string, method = "GET", body?: unknown): Promise<Response> {
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const response = await server.fetch(req, {
    upgrade: () => false,
  });

  if (!response) throw new Error(`No response returned for ${method} ${path}`);
  return response;
}

function waitForEventSequence(predicate: (events: SidecarStreamEvent[]) => boolean, timeoutMs = 10000) {
  return new Promise<SidecarStreamEvent[]>((resolve, reject) => {
    const events: SidecarStreamEvent[] = [];
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for stream events"));
    }, timeoutMs);

    const unsubscribe = subscribeStreamEvents((event) => {
      if (!isSidecarStreamEvent(event)) return;
      events.push(event);
      if (predicate(events)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(events);
      }
    });
  });
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "clark-sidecar-contract-"));
  workspaceDir = join(root, "workspace");
  homeDir = join(root, "home");
  configPath = join(root, "config", "config.json");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });

  process.env.CLARK_WORKSPACE_DIR = workspaceDir;
  process.env.HOME = homeDir;
  process.env.CLARK_CONFIG_PATH = configPath;

  server = await createSidecarServer();
});

afterAll(async () => {
  delete process.env.CLARK_WORKSPACE_DIR;
  delete process.env.CLARK_CONFIG_PATH;
});

describe("sidecar API contracts", () => {
  test("GET /api/status returns provider/model shape", async () => {
    const res = await callRoute("/api/status");
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.version).toBe(await readVersionFile());
    expect(typeof data.provider).toBe("string");
    expect(typeof data.model).toBe("string");
    expect(typeof data.workspace).toBe("string");
  });

  test("GET /api/models returns deterministic model payload shape", async () => {
    const res = await callRoute("/api/models");
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(Array.isArray(data.models)).toBe(true);
    expect(typeof data.providerAvailability).toBe("object");
    expect(typeof data.ollamaStatus).toBe("string");
  });

  test("POST /api/chat validates payload", async () => {
    const res = await callRoute("/api/chat", "POST", { text: "" });
    expect(res.status).toBe(400);
    const data = await res.json() as { error?: string };
    expect(data.error).toContain("Missing 'text'");
  });

  test("POST /api/command returns result payload", async () => {
    const res = await callRoute("/api/command", "POST", { command: "help", args: "" });
    expect(res.status).toBe(200);
    const data = await res.json() as { result?: string };
    expect(data.result).toContain("Available commands");
  });

  test("POST /api/ingest copies file and returns summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-ingest-"));
    const path = join(dir, "note.txt");
    await Bun.write(path, "test file");

    const res = await callRoute("/api/ingest", "POST", { path });
    expect(res.status).toBe(200);
    const data = await res.json() as { fileName?: string; summary?: string; destPath?: string };
    expect(data.fileName).toBe("note.txt");
    expect(data.summary).toContain("Copied note.txt");
    expect(data.destPath).toContain("Resources");
  });

  test("POST /api/ingest suppresses duplicate in-flight ingests for the same source path", async () => {
    await callRoute("/api/provider", "POST", { provider: "mock", model: "test" });

    const dir = await mkdtemp(join(tmpdir(), "clark-ingest-dup-"));
    const path = join(dir, "duplicate-note.txt");
    await Bun.write(path, "duplicate test file");

    const eventsPromise = waitForEventSequence((events) => {
      return events.some((event) => {
        return (
          (event.type === "ingest_complete" || event.type === "ingest_error")
          && event.fileName === "duplicate-note.txt"
        );
      });
    });

    const [firstRes, secondRes] = await Promise.all([
      callRoute("/api/ingest", "POST", { path }),
      callRoute("/api/ingest", "POST", { path }),
    ]);

    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);

    const secondData = await secondRes.json() as { summary?: string; deduped?: boolean };
    expect(secondData.deduped).toBe(true);
    expect(secondData.summary).toContain("Already importing duplicate-note.txt.");

    const events = await eventsPromise;
    const startEvents = events.filter((event) => {
      return event.type === "ingest_start" && event.fileName === "duplicate-note.txt";
    });
    expect(startEvents).toHaveLength(1);
  });

  test("POST /api/redeem-beta persists the generated cloud clientId for onboarding", async () => {
    const originalFetch = globalThis.fetch;
    let redeemedClientId: string | null = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/auth/beta")) {
        redeemedClientId = new Headers(init?.headers).get("X-Clark-Client-Id");
        return Response.json({ success: true, tier: "beta" });
      }
      return originalFetch(input, init);
    };

    try {
      const redeemRes = await callRoute("/api/redeem-beta", "POST", { code: "correct-beta-code" });
      expect(redeemRes.status).toBe(200);
      const redeemBody = await redeemRes.json() as { success?: boolean };
      expect(redeemBody.success).toBe(true);
      expect(typeof redeemedClientId).toBe("string");

      const completeRes = await callRoute("/api/complete-onboarding", "POST", {
        workspaceDir,
        workspaceIsNew: true,
      });
      expect(completeRes.status).toBe(200);

      const savedConfig = await Bun.file(configPath).json() as {
        cloud?: { clientId?: string; betaRedeemed?: boolean };
      };
      expect(savedConfig.cloud?.clientId).toBe(redeemedClientId);
      expect(savedConfig.cloud?.betaRedeemed).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fresh onboarding keeps the redeemed cloud clientId for OCR requests", async () => {
    const originalFetch = globalThis.fetch;
    let redeemedClientId: string | null = null;
    let ocrClientId: string | null = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);

      if (url.endsWith("/api/auth/beta")) {
        redeemedClientId = headers.get("X-Clark-Client-Id");
        return Response.json({ success: true, tier: "beta" });
      }

      if (url.endsWith("/api/ocr")) {
        ocrClientId = headers.get("X-Clark-Client-Id");
        return Response.json({
          markdown: "# OCR Transcript\n\nFresh install OCR works.",
          pageCount: 1,
          images: [],
        });
      }

      if (url.endsWith("/api/chat")) {
        return new Response(
          "data: {\"type\":\"text_delta\",\"text\":\"Sample Notes\"}\n\n" +
          "data: {\"type\":\"done\",\"stopReason\":\"end_turn\"}\n\n",
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }

      return originalFetch(input, init);
    };

    try {
      const pdfDir = await mkdtemp(join(tmpdir(), "clark-ingest-pdf-"));
      const pdfPath = join(pdfDir, "fresh-install.pdf");
      await Bun.write(pdfPath, "fake pdf bytes");

      const redeemRes = await callRoute("/api/redeem-beta", "POST", { code: "correct-beta-code" });
      expect(redeemRes.status).toBe(200);

      const completeRes = await callRoute("/api/complete-onboarding", "POST", {
        workspaceDir,
        workspaceIsNew: true,
      });
      expect(completeRes.status).toBe(200);

      const eventsPromise = waitForEventSequence((events) => {
        return events.some((event) => {
          return (
            (event.type === "ingest_complete" || event.type === "ingest_error")
            && event.fileName === "fresh-install.pdf"
          );
        });
      });

      const ingestRes = await callRoute("/api/ingest", "POST", { path: pdfPath });
      expect(ingestRes.status).toBe(200);

      const events = await eventsPromise;
      expect(events.some((event) => event.type === "ingest_error")).toBe(false);
      expect(redeemedClientId).toBeTruthy();
      expect(ocrClientId).toBe(redeemedClientId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("POST /api/chat uses the persisted cloud clientId for proxy auth", async () => {
    const originalFetch = globalThis.fetch;
    const cloudClientId = "beta-client-123";
    let chatClientId: string | null = null;

    await Bun.write(configPath, JSON.stringify({
      provider: "clark-cloud",
      model: "anthropic/claude-sonnet-4-6",
      cloud: {
        clientId: cloudClientId,
        betaRedeemed: true,
        url: "https://cloud.test",
      },
    }, null, 2));

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://cloud.test/api/chat") {
        chatClientId = new Headers(init?.headers).get("X-Clark-Client-Id");
        return new Response(
          "data: {\"type\":\"text_delta\",\"text\":\"hello\"}\n\n" +
          "data: {\"type\":\"done\",\"stopReason\":\"end_turn\"}\n\n",
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }

      return originalFetch(input, init);
    };

    try {
      const switchRes = await callRoute("/api/provider", "POST", {
        provider: "clark-cloud",
        model: "anthropic/claude-sonnet-4-6",
      });
      expect(switchRes.status).toBe(200);

      const eventsPromise = waitForEventSequence((events) => {
        return events.some((event) => event.type === "turn_complete");
      });

      const chatRes = await callRoute("/api/chat", "POST", { text: "hello" });
      expect(chatRes.status).toBe(200);

      await eventsPromise;
      expect(chatClientId).toBe(cloudClientId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("GET /api/context and /api/history are reachable", async () => {
    const contextRes = await callRoute("/api/context");
    expect(contextRes.status).toBe(200);
    const context = await contextRes.json() as Record<string, unknown>;
    expect(typeof context).toBe("object");

    const historyRes = await callRoute("/api/history");
    expect(historyRes.status).toBe(200);
    const history = await historyRes.json() as { messages?: unknown[] };
    expect(Array.isArray(history.messages)).toBe(true);
  });

  test("GET /api/file-content reads a file", async () => {
    const testPath = join(workspaceDir, "test-read.md");
    await Bun.write(testPath, "# Hello World");

    const res = await callRoute("/api/file-content?path=test-read.md");
    expect(res.status).toBe(200);
    const data = await res.json() as { path: string; content: string };
    expect(data.path).toBe("test-read.md");
    expect(data.content).toBe("# Hello World");
  });

  test("POST /api/file-content writes a file", async () => {
    const res = await callRoute("/api/file-content", "POST", {
      path: "test-write.md",
      content: "# Written",
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; path: string };
    expect(data.ok).toBe(true);

    const written = await Bun.file(join(workspaceDir, "test-write.md")).text();
    expect(written).toBe("# Written");
  });

  test("GET /api/file-content rejects path traversal", async () => {
    const res = await callRoute("/api/file-content?path=../etc/passwd");
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe("Invalid path");
  });

  test("POST /api/file-content rejects path traversal", async () => {
    const res = await callRoute("/api/file-content", "POST", {
      path: "../evil.md",
      content: "bad",
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/file-content returns 404 for missing file", async () => {
    const res = await callRoute("/api/file-content?path=nonexistent.md");
    expect(res.status).toBe(404);
  });

  test("stream emits assistant_message and turn_complete for a valid chat turn", async () => {
    const switchRes = await callRoute("/api/provider", "POST", { provider: "mock", model: "test" });
    expect(switchRes.status).toBe(200);

    const eventsPromise = waitForEventSequence((events) => {
      const types = events.map((e) => e.type);
      return types.includes("assistant_message") && types.includes("turn_complete");
    });

    const chatRes = await callRoute("/api/chat", "POST", { text: "hello" });
    expect(chatRes.status).toBe(200);

    const events = await eventsPromise;
    const types = events.map((e) => e.type);
    expect(types).toContain("streaming_text");
    expect(types).toContain("assistant_message");
    expect(types).toContain("turn_complete");
  });
});
