/**
 * Central catalog of built-in LLM providers and curated cloud models.
 *
 * Cloud providers (Anthropic, OpenAI, Gemini) are accessed via the Clark Cloud
 * proxy. Only Ollama runs locally. The old per-provider API key setup is
 * replaced by the cloud proxy which manages API keys server-side.
 */

export type ProviderName = "clark-cloud" | "ollama";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  contextWindow: number;
}

export interface ProviderCatalogEntry {
  id: ProviderName;
  label: string;
  requiresApiKey: boolean;
  models: readonly ModelCatalogEntry[];
}

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: "clark-cloud",
    label: "Clark Cloud (Beta)",
    requiresApiKey: false,
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextWindow: 200_000 },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000 },
      { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", contextWindow: 1_047_576 },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", contextWindow: 1_048_576 },
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

const MODEL_CONTEXT_WINDOWS = new Map<string, number>(
  PROVIDER_CATALOG.flatMap((provider) => provider.models.map((model) => [model.id, model.contextWindow] as const)),
);

export function listProviderNames(): ProviderName[] {
  return PROVIDER_CATALOG.map((provider) => provider.id);
}

export function getProviderCatalogEntry(provider: string): ProviderCatalogEntry | undefined {
  return PROVIDER_BY_ID.get(provider as ProviderName);
}

export function getDefaultModelForProvider(provider: string): string | undefined {
  return getProviderCatalogEntry(provider)?.models[0]?.id;
}

/**
 * Get all cloud model entries for display in the model picker.
 */
export function getCloudModelEntries(): Array<{
  provider: ProviderName;
  providerLabel: string;
  model: string;
  label: string;
}> {
  const entry = PROVIDER_BY_ID.get("clark-cloud");
  if (!entry) return [];
  return entry.models.map((model) => ({
    provider: "clark-cloud" as ProviderName,
    providerLabel: entry.label,
    model: model.id,
    label: model.label,
  }));
}

export function getModelContextWindow(model: string): number | undefined {
  return MODEL_CONTEXT_WINDOWS.get(model);
}
