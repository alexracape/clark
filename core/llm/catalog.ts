/**
 * Central catalog of built-in LLM providers and curated cloud models.
 *
 * Update this file when adding/removing providers or changing default models.
 */

export type ApiKeyProviderName = "anthropic" | "openai" | "gemini";
export type ProviderName = ApiKeyProviderName | "ollama";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  contextWindow: number;
}

export interface ProviderCatalogEntry {
  id: ProviderName;
  label: string;
  envVar?: string;
  site?: string;
  requiresApiKey: boolean;
  models: readonly ModelCatalogEntry[];
}

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    site: "console.anthropic.com",
    requiresApiKey: true,
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextWindow: 200_000 },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6", contextWindow: 200_000 },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000 },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    site: "platform.openai.com",
    requiresApiKey: true,
    models: [
      { id: "gpt-4.1", label: "GPT-4.1", contextWindow: 1_047_576 },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", contextWindow: 1_047_576 },
      { id: "gpt-4o", label: "GPT-4o", contextWindow: 128_000 },
    ],
  },
  {
    id: "gemini",
    label: "Google (Gemini)",
    envVar: "GOOGLE_API_KEY",
    site: "aistudio.google.com",
    requiresApiKey: true,
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextWindow: 1_048_576 },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", contextWindow: 1_048_576 },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", contextWindow: 1_048_576 },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    requiresApiKey: false,
    models: [],
  },
] as const;

const PROVIDER_BY_ID = new Map<ProviderName, ProviderCatalogEntry>(
  PROVIDER_CATALOG.map((entry) => [entry.id, entry]),
);
const API_KEY_PROVIDERS = new Set<ApiKeyProviderName>(["anthropic", "openai", "gemini"]);
const MODEL_CONTEXT_WINDOWS = new Map<string, number>(
  PROVIDER_CATALOG.flatMap((provider) => provider.models.map((model) => [model.id, model.contextWindow] as const)),
);

export function listProviderNames(): ProviderName[] {
  return PROVIDER_CATALOG.map((provider) => provider.id);
}

export function listApiKeyProviderNames(): ApiKeyProviderName[] {
  return PROVIDER_CATALOG
    .filter((provider): provider is ProviderCatalogEntry & { id: ApiKeyProviderName } => provider.requiresApiKey)
    .map((provider) => provider.id);
}

export function isApiKeyProvider(provider: string): provider is ApiKeyProviderName {
  return API_KEY_PROVIDERS.has(provider as ApiKeyProviderName);
}

export function getProviderCatalogEntry(provider: string): ProviderCatalogEntry | undefined {
  return PROVIDER_BY_ID.get(provider as ProviderName);
}

export function getDefaultModelForProvider(provider: string): string | undefined {
  return getProviderCatalogEntry(provider)?.models[0]?.id;
}

export function getCloudModelEntries(): Array<{
  provider: ApiKeyProviderName;
  providerLabel: string;
  model: string;
  label: string;
}> {
  return PROVIDER_CATALOG
    .filter((provider): provider is ProviderCatalogEntry & { id: ApiKeyProviderName } => provider.requiresApiKey)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        provider: provider.id,
        providerLabel: provider.label,
        model: model.id,
        label: model.label,
      })),
    );
}

export function getModelContextWindow(model: string): number | undefined {
  return MODEL_CONTEXT_WINDOWS.get(model);
}
