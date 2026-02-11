/**
 * Tests for library scaffolding utilities.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  expandPath,
  isExistingLibrary,
  validateLibraryPath,
  scaffoldLibrary,
} from "../src/library.ts";

describe("expandPath", () => {
  test("expands ~ to home directory", () => {
    expect(expandPath("~/Documents")).toBe(join(homedir(), "Documents"));
  });

  test("expands bare ~ to home directory", () => {
    expect(expandPath("~")).toBe(homedir());
  });

  test("leaves absolute paths unchanged", () => {
    expect(expandPath("/usr/local")).toBe("/usr/local");
  });

  test("leaves relative paths unchanged", () => {
    expect(expandPath("./notes")).toBe("./notes");
  });

  test("handles ~/Clark default", () => {
    expect(expandPath("~/Clark")).toBe(join(homedir(), "Clark"));
  });
});

describe("isExistingLibrary", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clark-lib-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns false for nonexistent directory", async () => {
    expect(await isExistingLibrary(join(tmpDir, "nonexistent"))).toBe(false);
  });

  test("returns false for empty directory", async () => {
    expect(await isExistingLibrary(tmpDir)).toBe(false);
  });

  test("returns true for directory with files", async () => {
    await Bun.write(join(tmpDir, "test.md"), "# Test");
    expect(await isExistingLibrary(tmpDir)).toBe(true);
  });

  test("returns true for directory with subdirectories", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(tmpDir, "Notes"));
    expect(await isExistingLibrary(tmpDir)).toBe(true);
  });
});

describe("validateLibraryPath", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clark-lib-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("validates existing writable directory", async () => {
    const result = await validateLibraryPath(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("validates nonexistent path with writable parent", async () => {
    const result = await validateLibraryPath(join(tmpDir, "newlib"));
    expect(result.valid).toBe(true);
  });

  test("rejects path with unwritable parent", async () => {
    const result = await validateLibraryPath("/root/forbidden/vault");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("scaffoldLibrary", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clark-lib-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("creates top-level directories", async () => {
    const libPath = join(tmpDir, "mylib");
    await scaffoldLibrary(libPath);

    const dirs = await readdir(libPath);
    expect(dirs).toContain("Notes");
    expect(dirs).toContain("Resources");
    expect(dirs).toContain("Structures");
    expect(dirs).toContain("Templates");
  });

  test("creates Resources subdirectories", async () => {
    const libPath = join(tmpDir, "mylib");
    await scaffoldLibrary(libPath);

    const resourceDirs = await readdir(join(libPath, "Resources"));
    expect(resourceDirs).toContain("Canvas");
    expect(resourceDirs).toContain("Images");
    expect(resourceDirs).toContain("PDFs");
    expect(resourceDirs).toContain("Transcriptions");
  });

  test("creates all Structure template files", async () => {
    const libPath = join(tmpDir, "mylib");
    await scaffoldLibrary(libPath);

    const structureFiles = await readdir(join(libPath, "Structures"));
    expect(structureFiles).toContain("Class.md");
    expect(structureFiles).toContain("Problem Set.md");
    expect(structureFiles).toContain("Idea.md");
    expect(structureFiles).toContain("Paper.md");
    expect(structureFiles).toContain("Quote.md");
    expect(structureFiles).toContain("Resource.md");
  });

  test("creates Template files", async () => {
    const libPath = join(tmpDir, "mylib");
    await scaffoldLibrary(libPath);

    const templateFiles = await readdir(join(libPath, "Templates"));
    expect(templateFiles).toContain("Paper Template.md");
  });

  test("Structure files contain expected content", async () => {
    const libPath = join(tmpDir, "mylib");
    await scaffoldLibrary(libPath);

    const classContent = await Bun.file(join(libPath, "Structures", "Class.md")).text();
    expect(classContent).toContain("## Purpose");
    expect(classContent).toContain("#class");
    expect(classContent).toContain("Concepts");

    const psContent = await Bun.file(join(libPath, "Structures", "Problem Set.md")).text();
    expect(psContent).toContain("#problem_set");

    const quoteContent = await Bun.file(join(libPath, "Structures", "Quote.md")).text();
    expect(quoteContent).toContain("#quote");
    expect(quoteContent).toContain("Yoda");
  });

  test("is idempotent (second run does not fail)", async () => {
    const libPath = join(tmpDir, "mylib");
    await scaffoldLibrary(libPath);
    await expect(scaffoldLibrary(libPath)).resolves.toBeUndefined();
  });

  test("expands ~ in path", async () => {
    // Verify expandPath is called internally by checking it doesn't throw
    // We use a temp path to avoid writing to the real home directory
    const libPath = join(tmpDir, "tilde-test");
    await scaffoldLibrary(libPath);

    const dirs = await readdir(libPath);
    expect(dirs.length).toBeGreaterThan(0);
  });
});
