/**
 * Cloud embedding provider — routes embedding requests through the Clark Cloud proxy.
 *
 * Uses OpenAI text-embedding-3-small (1536 dimensions) server-side.
 * The embedding index (SQLite) stays local — only vector computation is remote.
 */

import type { EmbeddingProvider } from "./provider.ts";

export class CloudEmbeddingProvider implements EmbeddingProvider {
  readonly name = "clark-cloud";
  readonly modelId = "text-embedding-3-small";
  readonly dimensions = 1536;

  constructor(
    private cloudUrl: string,
    private cloudSecret: string,
    private clientId: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const res = await fetch(`${this.cloudUrl}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.cloudSecret}`,
        "X-Clark-Client-Id": this.clientId,
      },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloud embedding error (${res.status}): ${text}`);
    }

    const result = await res.json() as { embeddings: number[][]; dimensions: number; model: string };
    return result.embeddings;
  }
}
