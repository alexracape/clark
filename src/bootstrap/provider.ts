import { createProvider } from "../llm/index.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { ClarkConfig } from "../config.ts";
import type { CliArgs } from "./args.ts";

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
};

export interface ProviderResolution {
  providerName: string;
  modelName: string;
  provider: LLMProvider;
}

export async function resolveProvider(config: ClarkConfig, args: CliArgs): Promise<ProviderResolution> {
  const providerName = args.provider ?? config.provider ?? "anthropic";

  let modelName = args.model
    ?? process.env.CLARK_MODEL
    ?? config.model
    ?? DEFAULT_MODELS[providerName];

  if (providerName === "ollama") {
    const { listLocalModels, checkModelFits } = await import("../llm/ollama.ts");

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
      const { sizeBytes, totalRam, pct } = await checkModelFits(modelName);
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

  modelName ??= "claude-sonnet-4-5-20250929";

  return {
    providerName,
    modelName,
    provider: createProvider(providerName, modelName),
  };
}
