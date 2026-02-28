import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createSidecarServer, subscribeStreamEvents } from "../gui/sidecar.ts";
import { isSidecarStreamEvent, type SidecarStreamEvent } from "../gui/src/stream-events.ts";

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
