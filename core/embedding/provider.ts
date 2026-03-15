/**
 * Embedding provider abstraction.
 *
 * Follows the OCRProvider pattern — pluggable interface with an Ollama
 * implementation and a no-op fallback for when embeddings aren't configured.
 */

import { Ollama } from "ollama";

export interface EmbeddingProvider {
  readonly name: string;
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Ollama-backed embedding provider.
 *
 * Uses the existing `ollama` npm package and reuses OLLAMA_HOST from config.
 * Discovers vector dimensions from the first embed call and caches them.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama";
  readonly modelId: string;

  private client: Ollama;
  private _dimensions = 0;

  constructor(model: string) {
    const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.client = new Ollama({ host });
    this.modelId = model;
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      const response = await this.client.embed({ model: this.modelId, input: texts });
      const embeddings = response.embeddings;

      if (embeddings.length > 0 && embeddings[0]!.length > 0 && this._dimensions === 0) {
        this._dimensions = embeddings[0]!.length;
      }

      return embeddings;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as any)?.code;
      if (
        code === "ConnectionRefused" ||
        message.includes("ECONNREFUSED") ||
        message.includes("fetch failed") ||
        message.includes("Unable to connect")
      ) {
        throw new Error(
          `Cannot connect to Ollama for embeddings.\n` +
            `  Start it with:  ollama serve\n` +
            `  Install:        brew install ollama`,
        );
      }
      throw new Error(
        `Embedding failed for model "${this.modelId}": ${message}\n` +
          `  Ensure the model is pulled: ollama pull ${this.modelId}`,
      );
    }
  }
}

/**
 * No-op provider — returns empty arrays. Used when embeddings aren't configured.
 */
export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly name = "noop";
  readonly modelId = "none";
  readonly dimensions = 0;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}
