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
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    savedEnv.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = savedEnv.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = savedEnv.OPENAI_API_KEY;
    process.env.GOOGLE_API_KEY = savedEnv.GOOGLE_API_KEY;
  });

  test("returns true when no keys anywhere", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(await needsOnboarding({})).toBe(true);
  });

  test("returns false with anthropic env var", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(await needsOnboarding({})).toBe(false);
  });

  test("returns false with ollama provider in config", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(await needsOnboarding({ provider: "ollama" })).toBe(false);
  });
});

describe("resolveApiKey", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    savedEnv.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = savedEnv.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = savedEnv.OPENAI_API_KEY;
    process.env.GOOGLE_API_KEY = savedEnv.GOOGLE_API_KEY;
  });

  test("env var takes precedence over secret store for anthropic", async () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    expect(await resolveApiKey("anthropic", {})).toBe("env-key");
  });

  test("returns undefined when nothing is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await resolveApiKey("anthropic", {})).toBeUndefined();
  });

  test("returns not-required for ollama", async () => {
    expect(await resolveApiKey("ollama", {})).toBe("not-required");
  });
});

describe("applyConfigToEnv", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    savedEnv.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    savedEnv.OLLAMA_HOST = process.env.OLLAMA_HOST;
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = savedEnv.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = savedEnv.OPENAI_API_KEY;
    process.env.GOOGLE_API_KEY = savedEnv.GOOGLE_API_KEY;
    process.env.OLLAMA_HOST = savedEnv.OLLAMA_HOST;
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
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      pdfExportDir: "/exports",
    };

    await saveConfig(testConfig, tmpConfigPath);

    const loaded = await loadConfig(tmpConfigPath);
    expect(loaded).toEqual(testConfig);
  });
});
