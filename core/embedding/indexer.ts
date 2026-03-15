/**
 * Embedding index orchestration.
 *
 * Reads files, chunks them, detects staleness via content hashes,
 * and embeds only changed chunks.
 */

import { readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "./provider.ts";
import type { EmbeddingIndex } from "./index.ts";
import { chunkMarkdown } from "./chunker.ts";

export class SearchIndexer {
  constructor(
    private index: EmbeddingIndex,
    private provider: EmbeddingProvider,
  ) {}

  /**
   * Index a single file. Chunks it, checks hashes, embeds stale chunks.
   */
  async indexFile(vaultDir: string, relativePath: string): Promise<void> {
    const fullPath = join(vaultDir, relativePath);
    let content: string;
    try {
      content = await Bun.file(fullPath).text();
    } catch {
      // File doesn't exist or isn't readable — remove from index
      this.index.removeFile(relativePath);
      return;
    }

    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) {
      this.index.removeFile(relativePath);
      return;
    }

    // Check which chunks are stale
    const existingHashes = this.index.getIndexedHashes(this.provider.modelId);
    const fileHashes = existingHashes.get(relativePath);

    const staleChunks: Array<{ index: number; text: string; hash: string }> = [];

    for (const chunk of chunks) {
      const hash = contentHash(chunk.text);
      const existingHash = fileHashes?.get(chunk.index);
      if (existingHash !== hash) {
        staleChunks.push({ index: chunk.index, text: chunk.text, hash });
      }
    }

    if (staleChunks.length === 0) return;

    // Embed stale chunks in batch
    const texts = staleChunks.map((c) => c.text);
    const embeddings = await this.provider.embed(texts);

    const upserts = staleChunks.map((chunk, i) => ({
      index: chunk.index,
      content: chunk.text,
      hash: chunk.hash,
      embedding: embeddings[i]!,
    }));

    this.index.upsertChunks(relativePath, upserts, this.provider.modelId);
  }

  /**
   * Scan the vault and index all stale .md/.txt files.
   * Returns counts of indexed and skipped files.
   */
  async indexStaleFiles(vaultDir: string): Promise<{ indexed: number; skipped: number }> {
    const entries = await readdir(vaultDir, { recursive: true });
    const candidates = entries.filter((e) => {
      const ext = extname(e).toLowerCase();
      return ext === ".md" || ext === ".txt";
    });

    let indexed = 0;
    let skipped = 0;

    for (const entry of candidates) {
      const fullPath = join(vaultDir, entry);
      let content: string;
      try {
        content = await Bun.file(fullPath).text();
      } catch {
        skipped++;
        continue;
      }

      const chunks = chunkMarkdown(content);
      if (chunks.length === 0) {
        skipped++;
        continue;
      }

      // Check staleness
      const existingHashes = this.index.getIndexedHashes(this.provider.modelId);
      const fileHashes = existingHashes.get(entry);

      const staleChunks: Array<{ index: number; text: string; hash: string }> = [];
      for (const chunk of chunks) {
        const hash = contentHash(chunk.text);
        const existingHash = fileHashes?.get(chunk.index);
        if (existingHash !== hash) {
          staleChunks.push({ index: chunk.index, text: chunk.text, hash });
        }
      }

      if (staleChunks.length === 0) {
        skipped++;
        continue;
      }

      const texts = staleChunks.map((c) => c.text);
      const embeddings = await this.provider.embed(texts);

      const upserts = staleChunks.map((chunk, i) => ({
        index: chunk.index,
        content: chunk.text,
        hash: chunk.hash,
        embedding: embeddings[i]!,
      }));

      this.index.upsertChunks(entry, upserts, this.provider.modelId);
      indexed++;
    }

    return { indexed, skipped };
  }
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
