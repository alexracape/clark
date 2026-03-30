import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeVersion,
  readVersionFile,
  resolveVersion,
} from "../core/version.ts";
import {
  assertReleaseTagMatchesVersion,
  syncVersionFiles,
} from "../scripts/sync-version.ts";

describe("core/version", () => {
  test("compile-time version wins over env and file", async () => {
    const resolved = await resolveVersion({
      compileTimeVersion: "v9.9.9",
      envVersion: "8.8.8",
      versionFilePath: join(process.cwd(), "missing-version-file"),
    });

    expect(resolved).toBe("9.9.9");
  });

  test("env version wins over file", async () => {
    const versionPath = join(process.cwd(), "VERSION");
    const resolved = await resolveVersion({
      envVersion: "v2.3.4",
      versionFilePath: versionPath,
    });

    expect(resolved).toBe("2.3.4");
  });

  test("version file is used in local development", async () => {
    const versionPath = join(process.cwd(), "VERSION");
    const fileContents = await Bun.file(versionPath).text();
    expect(await readVersionFile(versionPath)).toBe(fileContents.trim());
  });

  test("normalizeVersion trims whitespace and leading v", () => {
    expect(normalizeVersion(" v1.2.3 \n")).toBe("1.2.3");
  });
});

describe("scripts/sync-version", () => {
  test("syncVersionFiles updates all versioned manifests", async () => {
    const version = "3.4.5";
    const rootPackagePath = join(process.cwd(), "package.json");
    const guiPackagePath = join(process.cwd(), "gui", "package.json");
    const tauriConfigPath = join(process.cwd(), "tauri", "tauri.conf.json");
    const cargoTomlPath = join(process.cwd(), "tauri", "Cargo.toml");

    const originalVersion = await readVersionFile();

    try {
      await syncVersionFiles(version);

      const rootPackage = await Bun.file(rootPackagePath).json() as { version: string };
      const guiPackage = await Bun.file(guiPackagePath).json() as { version: string };
      const tauriConfig = await Bun.file(tauriConfigPath).json() as { version: string };
      const cargoToml = await readFile(cargoTomlPath, "utf8");

      expect(rootPackage.version).toBe(version);
      expect(guiPackage.version).toBe(version);
      expect(tauriConfig.version).toBe(version);
      expect(cargoToml).toContain(`version = "${version}"`);
    } finally {
      await syncVersionFiles(originalVersion);
    }
  });

  test("assertReleaseTagMatchesVersion rejects mismatched tags", () => {
    expect(() => assertReleaseTagMatchesVersion("v1.2.4", "1.2.3")).toThrow(
      "Release tag mismatch",
    );
  });
});
