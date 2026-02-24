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

type ExecFileAsyncResult = { stdout: string; stderr: string };
type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options?: { input?: string },
) => Promise<ExecFileAsyncResult>;

const execFileAsync = promisify(execFile) as unknown as ExecFileAsyncFn;

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
  secretStoreBackend?: "macos-keychain" | "linux-libsecret" | "windows-credential" | "fallback";

  /** Flag indicating user has completed initial onboarding. */
  hasCompletedOnboarding?: boolean;
  /** Tutorial progress tracking. */
  tutorialProgress?: {
    completed: boolean;
    currentStep?: number;
    lastCompletedAt?: string;
  };
}

export interface SecretStore {
  readonly backend: "macos-keychain" | "linux-libsecret" | "windows-credential" | "fallback";
  isSupported(): boolean;
  get(provider: ProviderName): Promise<string | undefined>;
  set(provider: ProviderName, value: string): Promise<void>;
  delete(provider: ProviderName): Promise<void>;
}

export class MacOSKeychainSecretStore implements SecretStore {
  readonly backend = "macos-keychain" as const;
  constructor(private readonly exec: ExecFileAsyncFn = execFileAsync) {}

  isSupported(): boolean {
    return platform() === "darwin";
  }

  async get(provider: ProviderName): Promise<string | undefined> {
    try {
      const { stdout } = await this.exec("security", [
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
    await this.exec("security", [
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

  async delete(provider: ProviderName): Promise<void> {
    try {
      await this.exec("security", [
        "delete-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        provider,
      ]);
    } catch {
      // Ignore errors (item might not exist)
    }
  }
}

export class LinuxLibsecretStore implements SecretStore {
  readonly backend = "linux-libsecret" as const;
  constructor(private readonly exec: ExecFileAsyncFn = execFileAsync) {}

  isSupported(): boolean {
    return platform() === "linux";
  }

  async get(provider: ProviderName): Promise<string | undefined> {
    try {
      const { stdout } = await this.exec("secret-tool", [
        "lookup",
        "service",
        KEYCHAIN_SERVICE,
        "account",
        provider,
      ]);
      const value = stdout.trim();
      return value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async set(provider: ProviderName, value: string): Promise<void> {
    await this.exec("secret-tool", [
      "store",
      "--label",
      `Clark API key for ${provider}`,
      "service",
      KEYCHAIN_SERVICE,
      "account",
      provider,
    ], {
      input: value,
    });
  }

  async delete(provider: ProviderName): Promise<void> {
    try {
      await this.exec("secret-tool", [
        "clear",
        "service",
        KEYCHAIN_SERVICE,
        "account",
        provider,
      ]);
    } catch {
      // Ignore errors (item might not exist)
    }
  }
}

export class WindowsCredentialStore implements SecretStore {
  readonly backend = "windows-credential" as const;
  constructor(private readonly exec: ExecFileAsyncFn = execFileAsync) {}

  isSupported(): boolean {
    return platform() === "win32";
  }

  private getTargetName(provider: ProviderName): string {
    return `${KEYCHAIN_SERVICE}:${provider}`;
  }

  async get(provider: ProviderName): Promise<string | undefined> {
    try {
      const target = this.getTargetName(provider);
      // cmdkey /list doesn't show passwords, need to use PowerShell
      const { stdout } = await this.exec("powershell", [
        "-NoProfile",
        "-Command",
        `$cred = (cmdkey /list | Select-String '${target}'); if ($cred) { (New-Object System.Net.NetworkCredential('', (Get-StoredCredential -Target '${target}').Password)).Password }`,
      ]);
      const value = stdout.trim();
      return value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async set(provider: ProviderName, value: string): Promise<void> {
    const target = this.getTargetName(provider);
    // cmdkey /generic requires username, using provider name as username
    await this.exec("cmdkey", [
      "/generic:" + target,
      "/user:" + provider,
      "/pass:" + value,
    ]);
  }

  async delete(provider: ProviderName): Promise<void> {
    try {
      const target = this.getTargetName(provider);
      await this.exec("cmdkey", [
        "/delete:" + target,
      ]);
    } catch {
      // Ignore errors (item might not exist)
    }
  }
}

export class FallbackSecretStore implements SecretStore {
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

  async delete(_provider: ProviderName): Promise<void> {
    // No-op for fallback
  }
}

export function createSecretStore(
  config?: ClarkConfig,
  currentPlatform: NodeJS.Platform = platform(),
): SecretStore {
  const preferred = config?.secretStoreBackend;

  // Try platform-specific backend first based on OS
  if (currentPlatform === "darwin") {
    const macos = new MacOSKeychainSecretStore();
    if (preferred === undefined || preferred === "macos-keychain") {
      return macos;
    }
  } else if (currentPlatform === "linux") {
    const linux = new LinuxLibsecretStore();
    if (preferred === undefined || preferred === "linux-libsecret") {
      return linux;
    }
  } else if (currentPlatform === "win32") {
    const windows = new WindowsCredentialStore();
    if (preferred === undefined || preferred === "windows-credential") {
      return windows;
    }
  }

  // Fall back if preferred backend doesn't match platform or is explicitly "fallback"
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

export async function hasConfig(path = DEFAULT_CONFIG_PATH): Promise<boolean> {
  try {
    return await Bun.file(path).exists();
  } catch {
    return false;
  }
}

export async function saveConfig(config: ClarkConfig, path = DEFAULT_CONFIG_PATH): Promise<void> {
  await ensureDir(join(path, ".."));
  await Bun.write(path, JSON.stringify(config, null, 2) + "\n");
}

async function resolveSecretStoreKey(provider: ProviderName, config: ClarkConfig): Promise<string | undefined> {
  if (!config.secretStoreBackend) return undefined;
  const store = createSecretStore(config);
  if (!store.isSupported()) return undefined;
  return store.get(provider);
}

export async function setProviderApiKey(provider: ProviderName, apiKey: string, config: ClarkConfig): Promise<ClarkConfig> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("API key cannot be empty.");
  }

  const store = createSecretStore(config);
  await store.set(provider, trimmed);

  return {
    ...config,
    secretStoreBackend: store.backend,
  };
}

/**
 * Resolve the API key for a provider.
 * Priority: env var > secret store.
 */
export async function resolveApiKey(provider: string, config: ClarkConfig): Promise<string | undefined> {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY
        ?? await resolveSecretStoreKey("anthropic", config);
    case "openai":
      return process.env.OPENAI_API_KEY
        ?? await resolveSecretStoreKey("openai", config);
    case "gemini":
      return process.env.GOOGLE_API_KEY
        ?? await resolveSecretStoreKey("gemini", config);
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
