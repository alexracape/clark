import { createProvider } from "../../core/llm/index.ts";
import { setProviderOptions } from "../../core/llm/provider.ts";
import type { LLMProvider } from "../../core/llm/provider.ts";
import type { ClarkConfig } from "../../core/config.ts";
import { resolveApiKey, resolveCloudConfig, saveConfig } from "../../core/config.ts";
import { getDefaultModelForProvider } from "../../core/llm/catalog.ts";
import type { CliArgs } from "./args.ts";

export interface ProviderResolution {
  providerName: string;
  modelName: string;
  provider: LLMProvider;
}

export async function resolveProvider(config: ClarkConfig, args: CliArgs): Promise<ProviderResolution> {
  const providerName = args.provider ?? config.provider ?? "clark-cloud";

  let modelName = args.model
    ?? process.env.CLARK_MODEL
    ?? config.model
    ?? getDefaultModelForProvider(providerName);

  let ollamaVision = false;

  if (providerName === "ollama") {
    const { listLocalModels, checkModelFits } = await import("../../core/llm/ollama.ts");

    if (!modelName) {
      try {
        const models = await listLocalModels();
        if (models.length === 0) {
          console.error(
            "No Ollama models found.\n" +
            "  Download one with:  ollama pull llama3.2\n" +
            "  Browse models:      https://ollama.com/library",
          );
          process.exit(1);
        }
        modelName = models[0]!.name;
      } catch {
        console.error(
          "Cannot connect to Ollama.\n" +
          "  Start it with:  ollama serve\n" +
          "  Install:        brew install ollama",
        );
        process.exit(1);
      }
    }

    try {
      const { sizeBytes, totalRam, pct, supportsVision } = await checkModelFits(modelName);
      ollamaVision = supportsVision;
      if (pct > 0.8) {
        const sizeGB = (sizeBytes / 1e9).toFixed(1);
        const ramGB = (totalRam / 1e9).toFixed(1);
        console.warn(
          `Warning: Model "${modelName}" (${sizeGB} GB) uses ${Math.round(pct * 100)}% of system RAM (${ramGB} GB). Performance may be degraded.`,
        );
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (providerName === "clark-cloud") {
    // Resolve cloud config and ensure clientId is persisted
    const { url, secret, clientId } = resolveCloudConfig(config);
    if (!config.cloud?.clientId) {
      config.cloud = { ...config.cloud, url, clientId };
      await saveConfig(config);
    }

    const resolvedModel = modelName ?? "claude-sonnet-4-6";

    // Pass cloud config through provider options
    // clientId is passed via the apiKey slot for convenience
    setProviderOptions("clark-cloud", {
      apiKey: clientId,
      ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
    });

    // Set cloud URL and secret in env for the provider to pick up
    process.env.CLARK_CLOUD_URL = url;
    process.env.CLARK_CLOUD_SECRET = secret;

    return {
      providerName,
      modelName: resolvedModel,
      provider: createProvider("clark-cloud", resolvedModel),
    };
  }

  // Legacy/Ollama path
  const resolvedModelName = modelName ?? getDefaultModelForProvider("clark-cloud") ?? "claude-sonnet-4-6";
  const apiKey = await resolveApiKey(providerName, config);
  if (providerName !== "ollama" && !apiKey) {
    throw new Error(`Missing API key for provider "${providerName}". Configure one in onboarding or /model.`);
  }
  setProviderOptions(providerName, {
    ...(apiKey ? { apiKey } : {}),
    ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
    ...(providerName === "ollama" ? { supportsVision: ollamaVision } : {}),
  });

  return {
    providerName,
    modelName: resolvedModelName,
    provider: createProvider(providerName, resolvedModelName),
  };
}
