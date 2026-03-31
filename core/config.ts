/**
 * Configuration persistence.
 *
 * Stores preferences in ~/.clark/config.json.
 * With Clark Cloud as the default, API keys are managed server-side.
 * Ollama is local and doesn't need keys.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const DEFAULT_CONFIG_DIR = join(homedir(), ".clark");
const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, "config.json");
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 8;
export const DEFAULT_CLOUD_URL = "https://clark-steel.vercel.app";
const LEGACY_CLOUD_URLS = new Set([
  "https://clark-cloud.vercel.app",
]);

export interface ClarkConfig {
  provider?: string;
  model?: string;
  ollamaBaseUrl?: string;
  /** User-selected workspace directory (persisted during onboarding). */
  workspaceDir?: string;
  /** Default directory for PDF exports from /export and export_pdf. */
  pdfExportDir?: string;
  /** Internal safety setting: max tool calls allowed per assistant turn loop. */
  maxToolCallsPerTurn?: number;
  /** Max tokens for LLM output. Provider-specific defaults apply if unset. */
  maxTokens?: number;

  /** Destination folders for file routing (relative to workspace). */
  fileRouting?: {
    pdf?: string;    // default: "Resources/PDFs"
    image?: string;  // default: "Resources/Images"
    other?: string;  // default: "Resources"
    notes?: string;  // default: "Notes"
  };

  /** Embedding configuration for semantic search. */
  embedding?: {
    provider?: "ollama" | "clark-cloud";
    model?: string;
  };

  /** Clark Cloud proxy configuration. */
  cloud?: {
    /** Cloud proxy URL (default: production Vercel URL). */
    url?: string;
    /** Anonymous client ID (generated UUID, persisted on first use). */
    clientId?: string;
    /** Whether this client has successfully redeemed a beta code. */
    betaRedeemed?: boolean;
  };

  /** Flag indicating user has completed initial onboarding. */
  hasCompletedOnboarding?: boolean;
  /** Whether the user has opted in to anonymous usage tracking (default: true). */
  usageTrackingEnabled?: boolean;
  /** Tutorial progress tracking. */
  tutorialProgress?: {
    completed: boolean;
    currentStep?: number;
    lastCompletedAt?: string;
  };
}

function resolveConfigPath(path?: string): string {
  return path ?? process.env.CLARK_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function loadConfig(path?: string): Promise<ClarkConfig> {
  const targetPath = resolveConfigPath(path);
  try {
    const file = Bun.file(targetPath);
    if (await file.exists()) {
      const config = await file.json() as ClarkConfig;
      const cloudUrl = normalizeCloudUrl(config.cloud?.url);
      if (config.cloud?.url === cloudUrl) return config;
      const { url: _legacyUrl, ...restCloud } = config.cloud ?? {};
      return {
        ...config,
        cloud: config.cloud
          ? {
              ...restCloud,
              ...(cloudUrl ? { url: cloudUrl } : {}),
            }
          : config.cloud,
      };
    }
  } catch {
    // Corrupt or missing config — start fresh
  }
  return {};
}

export async function hasConfig(path?: string): Promise<boolean> {
  const targetPath = resolveConfigPath(path);
  try {
    return await Bun.file(targetPath).exists();
  } catch {
    return false;
  }
}

export async function saveConfig(config: ClarkConfig, path?: string): Promise<void> {
  const targetPath = resolveConfigPath(path);
  await ensureDir(join(targetPath, ".."));
  await Bun.write(targetPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Resolve the API key for a provider.
 *
 * Cloud providers are managed server-side — no local API key needed.
 * Ollama is local and doesn't need one either.
 */
export async function resolveApiKey(provider: string, _config: ClarkConfig): Promise<string | undefined> {
  switch (provider) {
    case "clark-cloud":
      return "cloud-managed";
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

export function normalizeCloudUrl(url?: string): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  if (LEGACY_CLOUD_URLS.has(trimmed)) return DEFAULT_CLOUD_URL;
  return trimmed;
}

/**
 * Check if onboarding is needed.
 *
 * With Clark Cloud as the default, onboarding is only needed if the user
 * hasn't completed it yet and doesn't have a provider configured.
 */
export async function needsOnboarding(config: ClarkConfig): Promise<boolean> {
  if (config.hasCompletedOnboarding) return false;
  if (config.provider === "clark-cloud" || config.provider === "ollama") return false;
  return true;
}

/**
 * Resolve cloud proxy configuration.
 * Generates a clientId on first call if one doesn't exist.
 */
export function resolveCloudConfig(config: ClarkConfig): { url: string; clientId: string } {
  const url = normalizeCloudUrl(config.cloud?.url)
    ?? normalizeCloudUrl(process.env.CLARK_CLOUD_URL)
    ?? DEFAULT_CLOUD_URL;
  let clientId = config.cloud?.clientId;
  if (!clientId) {
    clientId = crypto.randomUUID();
    // Caller should persist this back to config
  }
  return { url, clientId };
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
