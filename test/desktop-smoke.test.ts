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

  test("GET /api/onboarding-status returns needsOnboarding", async () => {
    const res = await callRoute("/api/onboarding-status");
    expect(res.status).toBe(200);
    const data = await res.json() as { needsOnboarding: boolean };
    expect(typeof data.needsOnboarding).toBe("boolean");
  });

  test("POST /api/complete-onboarding saves config and returns ok", async () => {
    const res = await callRoute("/api/complete-onboarding", "POST", {
      provider: "ollama",
      workspaceDir: process.env.CLARK_WORKSPACE_DIR,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; provider: string; model: string };
    expect(data.ok).toBe(true);
    expect(data.provider).toBe("ollama");

    // After completing onboarding, status should say not needed
    const statusRes = await callRoute("/api/onboarding-status");
    const status = await statusRes.json() as { needsOnboarding: boolean };
    expect(status.needsOnboarding).toBe(false);

    // Status endpoint should reflect the onboarded provider
    const providerStatus = await callRoute("/api/status");
    const ps = await providerStatus.json() as { provider: string };
    expect(ps.provider).toBe("ollama");
  });

  test("POST /api/complete-onboarding defaults to clark-cloud without provider", async () => {
    const res = await callRoute("/api/complete-onboarding", "POST", {});
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; provider: string };
    expect(data.ok).toBe(true);
    expect(data.provider).toBe("clark-cloud");
  });

  test("GET /api/ollama-models returns models array and status", async () => {
    const res = await callRoute("/api/ollama-models");
    expect(res.status).toBe(200);
    const data = await res.json() as { models: string[]; status: string };
    expect(Array.isArray(data.models)).toBe(true);
    expect(["running", "not-running", "no-models"]).toContain(data.status);
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
