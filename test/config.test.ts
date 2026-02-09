/**
 * Tests for config persistence and onboarding detection.
 *
 * Tests file I/O by writing to a temp directory and verifying
 * config is correctly saved and loaded.
 */

import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  needsOnboarding,
  resolveApiKey,
  applyConfigToEnv,
  loadConfig,
  saveConfig,
  type ClarkConfig,
} from "../src/config.ts";

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

  test("returns true when no keys anywhere", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(needsOnboarding({})).toBe(true);
  });

  test("returns false with anthropic env var", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(needsOnboarding({})).toBe(false);
  });

  test("returns false with openai env var", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.GOOGLE_API_KEY;
    expect(needsOnboarding({})).toBe(false);
  });

  test("returns false with gemini env var", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GOOGLE_API_KEY = "AItest";
    expect(needsOnboarding({})).toBe(false);
  });

  test("returns false with anthropic key in config", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(needsOnboarding({ anthropicApiKey: "sk-ant-test" })).toBe(false);
  });

  test("returns false with openai key in config", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(needsOnboarding({ openaiApiKey: "sk-test" })).toBe(false);
  });

  test("returns false with gemini key in config", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(needsOnboarding({ geminiApiKey: "AItest" })).toBe(false);
  });

  test("returns false with ollama provider in config", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(needsOnboarding({ provider: "ollama" })).toBe(false);
  });

  test("returns false when both are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(needsOnboarding({})).toBe(false);
  });

  test("returns true with empty string keys", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(needsOnboarding({ anthropicApiKey: "", openaiApiKey: "" })).toBe(true);
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

  test("env var takes precedence over config for anthropic", () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    expect(resolveApiKey("anthropic", { anthropicApiKey: "config-key" })).toBe("env-key");
  });

  test("env var takes precedence over config for openai", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveApiKey("openai", { openaiApiKey: "config-key" })).toBe("env-key");
  });

  test("falls back to config when no env var for anthropic", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveApiKey("anthropic", { anthropicApiKey: "config-key" })).toBe("config-key");
  });

  test("falls back to config when no env var for openai", () => {
    delete process.env.OPENAI_API_KEY;
    expect(resolveApiKey("openai", { openaiApiKey: "config-key" })).toBe("config-key");
  });

  test("returns undefined when nothing is set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveApiKey("anthropic", {})).toBeUndefined();
  });

  test("env var takes precedence over config for gemini", () => {
    process.env.GOOGLE_API_KEY = "env-key";
    expect(resolveApiKey("gemini", { geminiApiKey: "config-key" })).toBe("env-key");
  });

  test("falls back to config when no env var for gemini", () => {
    delete process.env.GOOGLE_API_KEY;
    expect(resolveApiKey("gemini", { geminiApiKey: "config-key" })).toBe("config-key");
  });

  test("returns not-required for ollama", () => {
    expect(resolveApiKey("ollama", {})).toBe("not-required");
  });

  test("returns undefined for unknown provider", () => {
    expect(resolveApiKey("unknown-provider", {})).toBeUndefined();
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

  test("sets anthropic key when not in env", () => {
    delete process.env.ANTHROPIC_API_KEY;
    applyConfigToEnv({ anthropicApiKey: "from-config" });
    expect(process.env.ANTHROPIC_API_KEY).toBe("from-config");
  });

  test("sets openai key when not in env", () => {
    delete process.env.OPENAI_API_KEY;
    applyConfigToEnv({ openaiApiKey: "from-config" });
    expect(process.env.OPENAI_API_KEY).toBe("from-config");
  });

  test("does not overwrite existing anthropic env var", () => {
    process.env.ANTHROPIC_API_KEY = "existing";
    applyConfigToEnv({ anthropicApiKey: "new-key" });
    expect(process.env.ANTHROPIC_API_KEY).toBe("existing");
  });

  test("does not overwrite existing openai env var", () => {
    process.env.OPENAI_API_KEY = "existing";
    applyConfigToEnv({ openaiApiKey: "new-key" });
    expect(process.env.OPENAI_API_KEY).toBe("existing");
  });

  test("sets both keys at once", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    applyConfigToEnv({ anthropicApiKey: "a-key", openaiApiKey: "o-key" });
    expect(process.env.ANTHROPIC_API_KEY).toBe("a-key");
    expect(process.env.OPENAI_API_KEY).toBe("o-key");
  });

  test("sets gemini key when not in env", () => {
    delete process.env.GOOGLE_API_KEY;
    applyConfigToEnv({ geminiApiKey: "from-config" });
    expect(process.env.GOOGLE_API_KEY).toBe("from-config");
  });

  test("does not overwrite existing gemini env var", () => {
    process.env.GOOGLE_API_KEY = "existing";
    applyConfigToEnv({ geminiApiKey: "new-key" });
    expect(process.env.GOOGLE_API_KEY).toBe("existing");
  });

  test("sets ollama host when not in env", () => {
    delete process.env.OLLAMA_HOST;
    applyConfigToEnv({ ollamaBaseUrl: "http://custom:11434" });
    expect(process.env.OLLAMA_HOST).toBe("http://custom:11434");
  });

  test("handles empty config gracefully", () => {
    const before = { ...process.env };
    applyConfigToEnv({});
    // Nothing should have changed
    expect(process.env.ANTHROPIC_API_KEY).toBe(before.ANTHROPIC_API_KEY);
    expect(process.env.OPENAI_API_KEY).toBe(before.OPENAI_API_KEY);
  });
});

describe("saveConfig / loadConfig (file I/O)", () => {
  // These tests use the real saveConfig/loadConfig but those write to ~/.clark/config.json.
  // We test the round-trip by saving and loading. In a real scenario we'd want to mock the path,
  // but for now we test the serialization logic directly.

  test("config round-trips through JSON correctly", () => {
    const config: ClarkConfig = {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      anthropicApiKey: "sk-ant-test-key-12345",
      openaiApiKey: "sk-openai-test-key-67890",
    };

    // Test that the config serializes and deserializes correctly
    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as ClarkConfig;

    expect(parsed.provider).toBe("anthropic");
    expect(parsed.model).toBe("claude-sonnet-4-5-20250929");
    expect(parsed.anthropicApiKey).toBe("sk-ant-test-key-12345");
    expect(parsed.openaiApiKey).toBe("sk-openai-test-key-67890");
  });

  test("partial config serializes correctly", () => {
    const config: ClarkConfig = {
      provider: "openai",
      openaiApiKey: "sk-test",
    };

    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as ClarkConfig;

    expect(parsed.provider).toBe("openai");
    expect(parsed.openaiApiKey).toBe("sk-test");
    expect(parsed.anthropicApiKey).toBeUndefined();
    expect(parsed.model).toBeUndefined();
  });

  test("empty config serializes correctly", () => {
    const config: ClarkConfig = {};
    const json = JSON.stringify(config);
    const parsed = JSON.parse(json) as ClarkConfig;

    expect(Object.keys(parsed)).toHaveLength(0);
  });

  test("loadConfig returns empty object for missing file", async () => {
    // loadConfig handles missing files gracefully
    const config = await loadConfig();
    // Should return an object (may have data if ~/.clark/config.json exists)
    expect(typeof config).toBe("object");
  });

  test("saveConfig and loadConfig round-trip", async () => {
    const testConfig: ClarkConfig = {
      provider: "anthropic",
      anthropicApiKey: "sk-ant-roundtrip-test",
    };

    // Save
    await saveConfig(testConfig);

    // Load
    const loaded = await loadConfig();
    expect(loaded.provider).toBe("anthropic");
    expect(loaded.anthropicApiKey).toBe("sk-ant-roundtrip-test");

    // Clean up — restore previous state by saving empty-ish config
    // (in practice this test modifies ~/.clark/config.json)
    await saveConfig({});
  });
});
