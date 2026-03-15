/**
 * SQLite-backed embedding index.
 *
 * Stores chunk embeddings as raw Float32Array blobs and performs
 * brute-force cosine similarity search in JS. This is sufficient
 * for vault sizes up to ~1000 chunks at 768 dims (~3MB).
 */

import { Database } from "bun:sqlite";

export interface SimilarityResult {
  path: string;
  chunkContent: string;
  chunkIdx: number;
  score: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT NOT NULL,
  chunk_idx  INTEGER NOT NULL,
  content    TEXT NOT NULL,
  hash       TEXT NOT NULL,
  model_id   TEXT NOT NULL,
  embedding  BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(path, chunk_idx, model_id)
);
CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
`;

export class EmbeddingIndex {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(SCHEMA);
  }

  /**
   * Search for the most similar chunks to a query vector.
   * Loads all embeddings for the given modelId and computes cosine similarity in JS.
   */
  searchSimilar(queryVec: number[], modelId: string, limit: number): SimilarityResult[] {
    const rows = this.db.query(
      "SELECT path, chunk_idx, content, embedding FROM chunks WHERE model_id = ?",
    ).all(modelId) as Array<{
      path: string;
      chunk_idx: number;
      content: string;
      embedding: Buffer;
    }>;

    if (rows.length === 0) return [];

    const queryF32 = new Float32Array(queryVec);
    const queryNorm = vecNorm(queryF32);
    if (queryNorm === 0) return [];

    const scored: SimilarityResult[] = [];

    for (const row of rows) {
      const embF32 = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      );
      const embNorm = vecNorm(embF32);
      if (embNorm === 0) continue;

      const dot = vecDot(queryF32, embF32);
      const score = dot / (queryNorm * embNorm);

      scored.push({
        path: row.path,
        chunkContent: row.content,
        chunkIdx: row.chunk_idx,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Insert or replace chunks for a file + model combination.
   */
  upsertChunks(
    path: string,
    chunks: Array<{ index: number; content: string; hash: string; embedding: number[] }>,
    modelId: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (path, chunk_idx, content, hash, model_id, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    const txn = this.db.transaction(() => {
      for (const chunk of chunks) {
        const blob = Buffer.from(new Float32Array(chunk.embedding).buffer);
        stmt.run(path, chunk.index, chunk.content, chunk.hash, modelId, blob, now);
      }
    });
    txn();
  }

  /**
   * Delete all chunks for a file path.
   */
  removeFile(path: string): void {
    this.db.run("DELETE FROM chunks WHERE path = ?", [path]);
  }

  /**
   * Get indexed content hashes grouped by path and chunk index for a model.
   * Used for staleness detection.
   */
  getIndexedHashes(modelId: string): Map<string, Map<number, string>> {
    const rows = this.db.query(
      "SELECT path, chunk_idx, hash FROM chunks WHERE model_id = ?",
    ).all(modelId) as Array<{ path: string; chunk_idx: number; hash: string }>;

    const result = new Map<string, Map<number, string>>();
    for (const row of rows) {
      let fileMap = result.get(row.path);
      if (!fileMap) {
        fileMap = new Map();
        result.set(row.path, fileMap);
      }
      fileMap.set(row.chunk_idx, row.hash);
    }
    return result;
  }

  /**
   * Check if the index has any chunks for a given model.
   */
  isEmpty(modelId: string): boolean {
    const row = this.db.query(
      "SELECT COUNT(*) as cnt FROM chunks WHERE model_id = ?",
    ).get(modelId) as { cnt: number } | null;
    return !row || row.cnt === 0;
  }

  close(): void {
    this.db.close();
  }
}

// --- Vector math helpers ---

function vecDot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

function vecNorm(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!;
  }
  return Math.sqrt(sum);
}
