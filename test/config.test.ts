/**
 * Tests for config persistence and onboarding detection.
 */

import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_TOOL_CALLS_PER_TURN,
  needsOnboarding,
  resolveApiKey,
  resolveMaxToolCallsPerTurn,
  applyConfigToEnv,
  loadConfig,
  saveConfig,
  type ClarkConfig,
} from "../core/config.ts";

describe("needsOnboarding", () => {
  test("returns true when no provider configured and onboarding not completed", async () => {
    expect(await needsOnboarding({})).toBe(true);
  });

  test("returns false when hasCompletedOnboarding is true", async () => {
    expect(await needsOnboarding({ hasCompletedOnboarding: true })).toBe(false);
  });

  test("returns false with clark-cloud provider", async () => {
    expect(await needsOnboarding({ provider: "clark-cloud" })).toBe(false);
  });

  test("returns false with ollama provider in config", async () => {
    expect(await needsOnboarding({ provider: "ollama" })).toBe(false);
  });
});

describe("resolveApiKey", () => {
  test("returns cloud-managed for clark-cloud", async () => {
    expect(await resolveApiKey("clark-cloud", {})).toBe("cloud-managed");
  });

  test("returns not-required for ollama", async () => {
    expect(await resolveApiKey("ollama", {})).toBe("not-required");
  });

  test("returns undefined for unknown provider", async () => {
    expect(await resolveApiKey("unknown", {})).toBeUndefined();
  });
});

describe("applyConfigToEnv", () => {
  const savedOllamaHost = process.env.OLLAMA_HOST;

  afterEach(() => {
    process.env.OLLAMA_HOST = savedOllamaHost;
  });

  test("sets ollama host when not in env", () => {
    delete process.env.OLLAMA_HOST;
    applyConfigToEnv({ ollamaBaseUrl: "http://custom:11434" });
    expect(process.env.OLLAMA_HOST).toBe("http://custom:11434");
  });
});

describe("resolveMaxToolCallsPerTurn", () => {
  test("uses default when unset", () => {
    expect(resolveMaxToolCallsPerTurn({})).toBe(DEFAULT_MAX_TOOL_CALLS_PER_TURN);
  });

  test("uses provided value when valid", () => {
    expect(resolveMaxToolCallsPerTurn({ maxToolCallsPerTurn: 12 })).toBe(12);
  });

  test("clamps minimum to 1", () => {
    expect(resolveMaxToolCallsPerTurn({ maxToolCallsPerTurn: 0 })).toBe(1);
  });

  test("clamps maximum to 50", () => {
    expect(resolveMaxToolCallsPerTurn({ maxToolCallsPerTurn: 999 })).toBe(50);
  });
});

describe("saveConfig / loadConfig (file I/O)", () => {
  let tmpDir: string;
  let tmpConfigPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "clark-config-test-"));
    tmpConfigPath = join(tmpDir, "config.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("empty config serializes correctly", () => {
    const config: ClarkConfig = {};
    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as ClarkConfig;

    expect(Object.keys(parsed)).toHaveLength(0);
  });

  test("loadConfig returns empty object for missing file", async () => {
    const config = await loadConfig(join(tmpDir, "nonexistent.json"));
    expect(config).toEqual({});
  });

  test("saveConfig and loadConfig round-trip", async () => {
    const testConfig: ClarkConfig = {
      provider: "clark-cloud",
      model: "claude-sonnet-4-6",
      pdfExportDir: "/exports",
    };

    await saveConfig(testConfig, tmpConfigPath);

    const loaded = await loadConfig(tmpConfigPath);
    expect(loaded).toEqual(testConfig);
  });
});
