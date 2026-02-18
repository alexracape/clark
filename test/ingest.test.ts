/**
 * Tests for file ingestion: path detection and file copying.
 */

import { test, expect, describe } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFilePath, copyFileToResources } from "../src/app/ingest.ts";

describe("detectFilePath", () => {
  test("returns null for regular text", async () => {
    expect(await detectFilePath("hello world")).toBeNull();
    expect(await detectFilePath("I need help with math")).toBeNull();
    expect(await detectFilePath("")).toBeNull();
    expect(await detectFilePath("  ")).toBeNull();
  });

  test("returns null for slash commands", async () => {
    expect(await detectFilePath("/help")).toBeNull();
    expect(await detectFilePath("/canvas")).toBeNull();
    expect(await detectFilePath("/export some/path")).toBeNull();
  });

  test("detects an existing file path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-ingest-"));
    try {
      const filePath = join(dir, "test.txt");
      await writeFile(filePath, "content");

      const result = await detectFilePath(filePath);
      expect(result).toBe(filePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns null for nonexistent file", async () => {
    expect(await detectFilePath("/nonexistent/file.txt")).toBeNull();
  });

  test("handles escaped spaces in paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-ingest-"));
    try {
      const subDir = join(dir, "my folder");
      await mkdir(subDir);
      const filePath = join(subDir, "test.pdf");
      await writeFile(filePath, "content");

      // Terminal escapes spaces as backslash-space
      const escapedPath = filePath.replace(/ /g, "\\ ");
      const result = await detectFilePath(escapedPath);
      expect(result).toBe(filePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("handles quoted paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-ingest-"));
    try {
      const filePath = join(dir, "test.txt");
      await writeFile(filePath, "content");

      expect(await detectFilePath(`"${filePath}"`)).toBe(filePath);
      expect(await detectFilePath(`'${filePath}'`)).toBe(filePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("handles paths starting with dot-slash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clark-ingest-"));
    try {
      const filePath = join(dir, "test.pdf");
      await writeFile(filePath, "content");

      const result = await detectFilePath(filePath);
      expect(result).toBe(filePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("copyFileToResources", () => {
  test("copies a text file to Resources/", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "clark-ingest-src-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "clark-ingest-ws-"));

    try {
      const sourceFile = join(sourceDir, "notes.txt");
      await writeFile(sourceFile, "Some notes");

      const result = await copyFileToResources(sourceFile, workspaceDir);
      expect(result.fileName).toBe("notes.txt");
      expect(result.destPath).toBe("Resources/notes.txt");
      expect(result.fileSize).toBeTruthy();

      const copied = await Bun.file(join(workspaceDir, "Resources", "notes.txt")).text();
      expect(copied).toBe("Some notes");
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test("copies an image to Resources/Images/", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "clark-ingest-src-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "clark-ingest-ws-"));

    try {
      const sourceFile = join(sourceDir, "diagram.png");
      await writeFile(sourceFile, "fake-png-data");

      const result = await copyFileToResources(sourceFile, workspaceDir);
      expect(result.fileName).toBe("diagram.png");
      expect(result.destPath).toBe("Resources/Images/diagram.png");
      expect(await Bun.file(join(workspaceDir, "Resources", "Images", "diagram.png")).exists()).toBe(true);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test("creates destination directories if needed", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "clark-ingest-src-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "clark-ingest-ws-"));

    try {
      const sourceFile = join(sourceDir, "photo.jpg");
      await writeFile(sourceFile, "fake-jpg-data");

      const result = await copyFileToResources(sourceFile, workspaceDir);
      expect(result.destPath).toBe("Resources/Images/photo.jpg");
      expect(await Bun.file(join(workspaceDir, "Resources", "Images", "photo.jpg")).exists()).toBe(true);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test("includes file size in result", async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), "clark-ingest-src-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "clark-ingest-ws-"));

    try {
      const sourceFile = join(sourceDir, "doc.pdf");
      await writeFile(sourceFile, "x".repeat(2048));

      const result = await copyFileToResources(sourceFile, workspaceDir);
      expect(result.fileSize).toBe("2.0 KB");
      expect(result.destPath).toBe("Resources/PDFs/doc.pdf");
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
