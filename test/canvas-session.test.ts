import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanvasSessionManager } from "../src/app/canvas-session.ts";

describe("CanvasSessionManager", () => {
  test("close rejects in-flight export deterministically", async () => {
    const canvasDir = await mkdtemp(join(tmpdir(), "clark-canvas-session-"));

    try {
      const manager = new CanvasSessionManager({
        port: 0,
        canvasDir,
        getHost: () => "127.0.0.1",
        bindHost: "127.0.0.1",
      });

      const info = await manager.open("HW-Session");
      const url = new URL(info.url);
      const token = url.searchParams.get("token");
      if (!token) throw new Error("Missing token in canvas URL");

      const ws = new WebSocket(`ws://${url.host}/ws?token=${token}`);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket did not connect")), 3000);
        ws.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket failed to connect"));
        };
      });

      const startedAt = Date.now();
      const pendingExport = manager.exportPages(60_000);
      await manager.close();

      await expect(pendingExport).rejects.toThrow("Canvas session closed");
      expect(Date.now() - startedAt).toBeLessThan(1500);
      expect(manager.connectionStatus.state).toBe("disconnected");

      ws.close();
    } finally {
      await rm(canvasDir, { recursive: true, force: true });
    }
  });
});
