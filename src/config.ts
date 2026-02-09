/**
 * Configuration persistence.
 *
 * Stores API keys and preferences in ~/.clark/config.json.
 * Keys are also loaded from environment variables (env takes precedence).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const CONFIG_DIR = join(homedir(), ".clark");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface ClarkConfig {
  provider?: string;
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  ollamaBaseUrl?: string;
  /** Directory for raw resources (PDFs, images, slides) */
  resourcePath?: string;
  /** Directory for canvas exports and handwritten work */
  canvasPath?: string;
}

async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadConfig(): Promise<ClarkConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      return await file.json();
    }
  } catch {
    // Corrupt or missing config — start fresh
  }
  return {};
}

export async function saveConfig(config: ClarkConfig): Promise<void> {
  await ensureConfigDir();
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Resolve the API key for a provider.
 * Priority: env var > saved config.
 */
export function resolveApiKey(provider: string, config: ClarkConfig): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ?? config.anthropicApiKey;
    case "openai":
      return process.env.OPENAI_API_KEY ?? config.openaiApiKey;
    case "gemini":
      return process.env.GOOGLE_API_KEY ?? config.geminiApiKey;
    case "ollama":
      return "not-required";
    default:
      return undefined;
  }
}

/**
 * Apply saved API keys to environment so SDKs pick them up.
 */
export function applyConfigToEnv(config: ClarkConfig) {
  if (config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }
  if (config.openaiApiKey && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = config.openaiApiKey;
  }
  if (config.geminiApiKey && !process.env.GOOGLE_API_KEY) {
    process.env.GOOGLE_API_KEY = config.geminiApiKey;
  }
  if (config.ollamaBaseUrl && !process.env.OLLAMA_HOST) {
    process.env.OLLAMA_HOST = config.ollamaBaseUrl;
  }
}

/**
 * Check if onboarding is needed (no API key available for any provider).
 */
export function needsOnboarding(config: ClarkConfig): boolean {
  const hasAnthropic = !!(process.env.ANTHROPIC_API_KEY ?? config.anthropicApiKey);
  const hasOpenai = !!(process.env.OPENAI_API_KEY ?? config.openaiApiKey);
  const hasGemini = !!(process.env.GOOGLE_API_KEY ?? config.geminiApiKey);
  const hasOllama = !!(config.provider === "ollama" || config.ollamaBaseUrl);
  return !hasAnthropic && !hasOpenai && !hasGemini && !hasOllama;
}
