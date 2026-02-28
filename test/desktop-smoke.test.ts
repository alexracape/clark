import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createSidecarServer, subscribeStreamEvents } from "../gui/sidecar.ts";
import { type SidecarStreamEvent } from "../gui/src/stream-events.ts";

let server: Awaited<ReturnType<typeof createSidecarServer>>;

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

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "clark-desktop-smoke-"));
  const workspaceDir = join(root, "workspace");
  const homeDir = join(root, "home");
  const configPath = join(root, "config", "config.json");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });

  process.env.CLARK_WORKSPACE_DIR = workspaceDir;
  process.env.HOME = homeDir;
  process.env.CLARK_CONFIG_PATH = configPath;

  server = await createSidecarServer();
});

describe("desktop smoke", () => {
  test("sidecar startup + status roundtrip", async () => {
    const statusRes = await callRoute("/api/status");
    expect(statusRes.status).toBe(200);
    const status = await statusRes.json() as { provider?: string; model?: string };
    expect(typeof status.provider).toBe("string");
    expect(typeof status.model).toBe("string");
  });

  test("stream channel receives valid event from chat", async () => {
    await callRoute("/api/provider", "POST", { provider: "mock", model: "test" });

    const eventPromise = new Promise<SidecarStreamEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("no stream event"));
      }, 10000);

      const unsubscribe = subscribeStreamEvents((event) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(event);
      });
    });

    const chatRes = await callRoute("/api/chat", "POST", { text: "smoke" });
    expect(chatRes.status).toBe(200);

    const event = await eventPromise;
    expect(typeof event.type).toBe("string");
  });
});
