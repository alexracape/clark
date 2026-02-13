import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSlashCommandHandler } from "../src/app/command-router.ts";
import type { CanvasSessionManager } from "../src/app/canvas-session.ts";

const minimalPNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

describe("createSlashCommandHandler /export", () => {
  test("exports using the current default export directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-export-router-"));

    try {
      let exportDir = dir;
      const handler = createSlashCommandHandler({
        canvas: {
          activeInfo: { name: "HW1", url: "http://example.test" },
          exportPages: async () => ({
            pages: [{ name: "Page 1", png: minimalPNG }],
            source: "live" as const,
          }),
        } as unknown as CanvasSessionManager,
        getExportDir: () => exportDir,
        setExportDir: (next) => {
          exportDir = next;
        },
        skills: [],
        conversation: {} as never,
        provider: {} as never,
      });

      const result = await handler("export", "");
      const expectedPath = join(dir, "HW1.pdf");
      expect(result).toBe(`PDF exported to: ${expectedPath}`);
      expect(await Bun.file(expectedPath).exists()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("updates default export dir and persists when /export receives a path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-export-router-"));
    const previousCwd = process.cwd();
    process.chdir(dir);

    try {
      let exportDir = dir;
      let persistedDir: string | null = null;
      const handler = createSlashCommandHandler({
        canvas: {
          activeInfo: { name: "HW2", url: "http://example.test" },
          exportPages: async () => ({
            pages: [{ name: "Page 1", png: minimalPNG }],
            source: "live" as const,
          }),
        } as unknown as CanvasSessionManager,
        getExportDir: () => exportDir,
        setExportDir: (next) => {
          exportDir = next;
        },
        persistExportDir: async (next) => {
          persistedDir = next;
        },
        skills: [],
        conversation: {} as never,
        provider: {} as never,
      });

      const first = await handler("export", "exports");
      const expectedDirSuffix = `${join("exports")}`;
      const firstPath = first?.replace("PDF exported to: ", "") ?? "";

      expect(first).toContain("/exports/HW2.pdf");
      expect(exportDir).toContain(expectedDirSuffix);
      expect(exportDir.endsWith("/exports")).toBe(true);
      expect(persistedDir).toBe(exportDir);
      expect(await Bun.file(firstPath).exists()).toBe(true);

      const second = await handler("export", "");
      expect(second).toContain("/exports/HW2.pdf");
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns a descriptive error when no client is connected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-export-router-"));

    try {
      const handler = createSlashCommandHandler({
        canvas: {
          activeInfo: { name: "HW3", url: "http://example.test" },
          exportPages: async () => {
            throw new Error("No iPad client connected");
          },
        } as unknown as CanvasSessionManager,
        getExportDir: () => dir,
        setExportDir: () => {},
        skills: [],
        conversation: {} as never,
        provider: {} as never,
      });

      const result = await handler("export", "");
      expect(result).toContain("Export failed: no canvas client is currently connected.");
      expect(result).toContain("keep it connected while running /export");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("still exports when persisting the export directory fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-export-router-"));
    const previousCwd = process.cwd();
    process.chdir(dir);

    try {
      let exportDir = dir;
      const handler = createSlashCommandHandler({
        canvas: {
          activeInfo: { name: "HW4", url: "http://example.test" },
          exportPages: async () => ({
            pages: [{ name: "Page 1", png: minimalPNG }],
            source: "live" as const,
          }),
        } as unknown as CanvasSessionManager,
        getExportDir: () => exportDir,
        setExportDir: (next) => {
          exportDir = next;
        },
        persistExportDir: async () => {
          throw new Error("disk is read-only");
        },
        skills: [],
        conversation: {} as never,
        provider: {} as never,
      });

      const result = await handler("export", "exports");
      expect(result).toContain("PDF exported to:");
      expect(result).toContain("failed to persist config");
      expect(await Bun.file(join(exportDir, "HW4.pdf")).exists()).toBe(true);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
