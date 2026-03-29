/**
 * LLM model catalog — combines dynamic models from the cloud proxy
 * with a static fallback for offline/error scenarios.
 *
 * Cloud models use the AI Gateway "provider/model" ID format
 * (e.g. "anthropic/claude-sonnet-4.6"). The catalog is the single
 * source of truth for what models the UI displays.
 */

export type ProviderName = "clark-cloud" | "ollama";

/** Model entry returned by the cloud /api/models endpoint. */
export interface CloudModelEntry {
  id: string;           // Gateway format: "anthropic/claude-sonnet-4.6"
  name: string;         // Human-readable: "Claude Sonnet 4.6"
  provider: string;     // "anthropic"
  contextWindow: number;
  maxTokens: number;
  tags: string[];
}

/** Flat entry used by the sidecar → ModelPicker pipeline. */
export interface ModelPickerEntry {
  provider: ProviderName;
  providerLabel: string;
  model: string;         // Gateway ID for cloud, raw name for ollama
  label: string;
  contextWindow?: number;
}

/**
 * Minimal fallback models used when the cloud catalog is unreachable.
 * These use the Gateway "provider/model" format so the rest of the
 * pipeline handles them identically to dynamic models.
 */
export const FALLBACK_CLOUD_MODELS: readonly CloudModelEntry[] = [
  { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", contextWindow: 200_000, maxTokens: 128_000, tags: ["tool-use", "vision"] },
  { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", contextWindow: 200_000, maxTokens: 8_192, tags: ["tool-use", "vision"] },
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai", contextWindow: 1_047_576, maxTokens: 32_768, tags: ["tool-use", "vision"] },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", contextWindow: 1_048_576, maxTokens: 65_536, tags: ["tool-use", "vision"] },
];

/** Default model when nothing is configured. */
export const DEFAULT_CLOUD_MODEL = "anthropic/claude-sonnet-4-6";

/** All provider names supported by the system. */
export function listProviderNames(): ProviderName[] {
  return ["clark-cloud", "ollama"];
}

/** Pretty label for the provider group in the model picker. */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
};

export function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Convert CloudModelEntry[] to the flat list the ModelPicker expects.
 */
export function cloudModelsToPickerEntries(models: readonly CloudModelEntry[]): ModelPickerEntry[] {
  return models.map((m) => ({
    provider: "clark-cloud" as ProviderName,
    providerLabel: getProviderLabel(m.provider),
    model: m.id,
    label: m.name,
    contextWindow: m.contextWindow,
  }));
}

/**
 * Get fallback picker entries (used when cloud proxy is unreachable).
 */
export function getFallbackCloudEntries(): ModelPickerEntry[] {
  return cloudModelsToPickerEntries(FALLBACK_CLOUD_MODELS);
}

/**
 * Extract the bare provider name from a Gateway model ID.
 * e.g. "anthropic/claude-sonnet-4.6" → "anthropic"
 */
export function extractProvider(gatewayId: string): string {
  const slash = gatewayId.indexOf("/");
  return slash > 0 ? gatewayId.slice(0, slash) : gatewayId;
}

/**
 * Get the default model ID for a provider.
 */
export function getDefaultModelForProvider(provider: string): string | undefined {
  if (provider === "clark-cloud") return DEFAULT_CLOUD_MODEL;
  // Ollama has no static default
  return undefined;
}

/**
 * Look up the context window for a model from either a dynamic catalog
 * or the fallback list.
 */
export function getModelContextWindow(model: string, dynamicModels?: readonly CloudModelEntry[]): number | undefined {
  if (dynamicModels) {
    const entry = dynamicModels.find((m) => m.id === model);
    if (entry) return entry.contextWindow;
  }
  const fallback = FALLBACK_CLOUD_MODELS.find((m) => m.id === model);
  return fallback?.contextWindow;
}
