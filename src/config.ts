/**
 * Configuration persistence.
 *
 * Stores preferences in ~/.clark/config.json.
 * API keys are resolved from env vars first, then the configured secret store.
 */

import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_CONFIG_DIR = join(homedir(), ".clark");
const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, "config.json");
const KEYCHAIN_SERVICE = "com.clark.api-keys";
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 8;

type ProviderName = "anthropic" | "openai" | "gemini";

const PROVIDER_ENV: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

export interface ClarkConfig {
  provider?: string;
  model?: string;
  ollamaBaseUrl?: string;
  /** Default directory for PDF exports from /export and export_pdf. */
  pdfExportDir?: string;
  /** Internal safety setting: max tool calls allowed per assistant turn loop. */
  maxToolCallsPerTurn?: number;
  /** Max tokens for LLM output. Provider-specific defaults apply if unset. */
  maxTokens?: number;
  /** Secret backend used for API keys. */
  secretStoreBackend?: "macos-keychain" | "fallback";

  // Legacy plaintext key fields (auto-migrated when possible).
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
}

interface SecretStore {
  readonly backend: "macos-keychain" | "fallback";
  isSupported(): boolean;
  get(provider: ProviderName): Promise<string | undefined>;
  set(provider: ProviderName, value: string): Promise<void>;
}

class MacOSKeychainSecretStore implements SecretStore {
  readonly backend = "macos-keychain" as const;

  isSupported(): boolean {
    return platform() === "darwin";
  }

  async get(provider: ProviderName): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        provider,
        "-w",
      ]);
      const value = stdout.trim();
      return value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async set(provider: ProviderName, value: string): Promise<void> {
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      provider,
      "-w",
      value,
    ]);
  }
}

class FallbackSecretStore implements SecretStore {
  readonly backend = "fallback" as const;

  isSupported(): boolean {
    return true;
  }

  async get(_provider: ProviderName): Promise<string | undefined> {
    return undefined;
  }

  async set(_provider: ProviderName, _value: string): Promise<void> {
    throw new Error("Secret storage backend unavailable on this platform. Set provider API keys via environment variables for now.");
  }
}

function getSecretStore(config?: ClarkConfig): SecretStore {
  const preferred = config?.secretStoreBackend;
  const macos = new MacOSKeychainSecretStore();
  if ((preferred === undefined || preferred === "macos-keychain") && macos.isSupported()) {
    return macos;
  }
  return new FallbackSecretStore();
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function loadConfig(path = DEFAULT_CONFIG_PATH): Promise<ClarkConfig> {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.json();
    }
  } catch {
    // Corrupt or missing config — start fresh
  }
  return {};
}

export async function saveConfig(config: ClarkConfig, path = DEFAULT_CONFIG_PATH): Promise<void> {
  await ensureDir(join(path, ".."));
  await Bun.write(path, JSON.stringify(config, null, 2) + "\n");
}

async function resolveSecretStoreKey(provider: ProviderName, config: ClarkConfig): Promise<string | undefined> {
  const store = getSecretStore(config);
  if (!store.isSupported()) return undefined;
  return store.get(provider);
}

export async function setProviderApiKey(provider: ProviderName, apiKey: string, config: ClarkConfig): Promise<ClarkConfig> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("API key cannot be empty.");
  }

  const store = getSecretStore(config);
  await store.set(provider, trimmed);

  return {
    ...config,
    secretStoreBackend: store.backend,
    anthropicApiKey: undefined,
    openaiApiKey: undefined,
    geminiApiKey: undefined,
  };
}

/**
 * Resolve the API key for a provider.
 * Priority: env var > secret store > legacy config field.
 */
export async function resolveApiKey(provider: string, config: ClarkConfig): Promise<string | undefined> {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY
        ?? await resolveSecretStoreKey("anthropic", config)
        ?? config.anthropicApiKey;
    case "openai":
      return process.env.OPENAI_API_KEY
        ?? await resolveSecretStoreKey("openai", config)
        ?? config.openaiApiKey;
    case "gemini":
      return process.env.GOOGLE_API_KEY
        ?? await resolveSecretStoreKey("gemini", config)
        ?? config.geminiApiKey;
    case "ollama":
      return "not-required";
    default:
      return undefined;
  }
}

/**
 * Apply non-secret config values to environment.
 */
export function applyConfigToEnv(config: ClarkConfig) {
  if (config.ollamaBaseUrl && !process.env.OLLAMA_HOST) {
    process.env.OLLAMA_HOST = config.ollamaBaseUrl;
  }
}

/**
 * Check if onboarding is needed (no API key available for any provider).
 */
export async function needsOnboarding(config: ClarkConfig): Promise<boolean> {
  const hasAnthropic = !!(await resolveApiKey("anthropic", config));
  const hasOpenai = !!(await resolveApiKey("openai", config));
  const hasGemini = !!(await resolveApiKey("gemini", config));
  const hasOllama = !!(config.provider === "ollama" || config.ollamaBaseUrl);
  return !hasAnthropic && !hasOpenai && !hasGemini && !hasOllama;
}

/**
 * Migrate legacy plaintext keys in config.json to the configured secret store.
 * Returns the updated config and whether it changed.
 */
export async function migrateLegacyApiKeys(config: ClarkConfig): Promise<{ config: ClarkConfig; changed: boolean }> {
  const legacy: Array<{ provider: ProviderName; value?: string }> = [
    { provider: "anthropic", value: config.anthropicApiKey },
    { provider: "openai", value: config.openaiApiKey },
    { provider: "gemini", value: config.geminiApiKey },
  ];

  const hasLegacy = legacy.some((item) => !!item.value?.trim());
  if (!hasLegacy) {
    return { config, changed: false };
  }

  let next = { ...config };
  let migratedAny = false;

  for (const item of legacy) {
    const value = item.value?.trim();
    if (!value) continue;
    try {
      next = await setProviderApiKey(item.provider, value, next);
      migratedAny = true;
    } catch {
      // Keep legacy value in place if migration fails.
      return { config, changed: false };
    }
  }

  if (!migratedAny) {
    return { config, changed: false };
  }

  return {
    config: {
      ...next,
      anthropicApiKey: undefined,
      openaiApiKey: undefined,
      geminiApiKey: undefined,
    },
    changed: true,
  };
}

export function providerEnvVar(provider: ProviderName): string {
  return PROVIDER_ENV[provider];
}

export function resolveMaxToolCallsPerTurn(config: ClarkConfig): number {
  const raw = config.maxToolCallsPerTurn;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_MAX_TOOL_CALLS_PER_TURN;
  }
  const normalized = Math.floor(raw);
  if (normalized < 1) return 1;
  if (normalized > 50) return 50;
  return normalized;
}
