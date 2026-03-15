import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EmbeddingIndex } from "../core/embedding/index.ts";

let tempDir: string;
let index: EmbeddingIndex;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "clark-embed-test-"));
  index = new EmbeddingIndex(join(tempDir, "search.db"));
});

afterEach(async () => {
  index.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("EmbeddingIndex", () => {
  const MODEL = "test-model";

  function makeVec(dims: number, seed: number): number[] {
    const vec: number[] = [];
    for (let i = 0; i < dims; i++) {
      vec.push(Math.sin(seed * (i + 1)));
    }
    return vec;
  }

  test("upsert and searchSimilar with known vectors", () => {
    // Insert two chunks with known vectors
    const vec1 = [1, 0, 0];
    const vec2 = [0, 1, 0];

    index.upsertChunks("notes/a.md", [
      { index: 0, content: "About cats", hash: "hash1", embedding: vec1 },
    ], MODEL);

    index.upsertChunks("notes/b.md", [
      { index: 0, content: "About dogs", hash: "hash2", embedding: vec2 },
    ], MODEL);

    // Query with vec close to vec1
    const queryVec = [0.9, 0.1, 0];
    const results = index.searchSimilar(queryVec, MODEL, 10);

    expect(results).toHaveLength(2);
    // "About cats" should rank higher (closer to [1,0,0])
    expect(results[0]!.chunkContent).toBe("About cats");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  test("cosine similarity ordering is correct", () => {
    const vec1 = [1, 0, 0, 0];
    const vec2 = [0.7, 0.7, 0, 0];
    const vec3 = [0, 0, 1, 0];

    index.upsertChunks("a.md", [
      { index: 0, content: "exact match", hash: "h1", embedding: vec1 },
    ], MODEL);
    index.upsertChunks("b.md", [
      { index: 0, content: "partial match", hash: "h2", embedding: vec2 },
    ], MODEL);
    index.upsertChunks("c.md", [
      { index: 0, content: "orthogonal", hash: "h3", embedding: vec3 },
    ], MODEL);

    const results = index.searchSimilar([1, 0, 0, 0], MODEL, 10);
    expect(results[0]!.chunkContent).toBe("exact match");
    expect(results[0]!.score).toBeCloseTo(1.0);
    expect(results[1]!.chunkContent).toBe("partial match");
    expect(results[2]!.chunkContent).toBe("orthogonal");
    expect(results[2]!.score).toBeCloseTo(0);
  });

  test("removeFile deletes all chunks", () => {
    index.upsertChunks("file.md", [
      { index: 0, content: "chunk 0", hash: "h0", embedding: [1, 0] },
      { index: 1, content: "chunk 1", hash: "h1", embedding: [0, 1] },
    ], MODEL);

    expect(index.isEmpty(MODEL)).toBe(false);
    index.removeFile("file.md");
    expect(index.isEmpty(MODEL)).toBe(true);
  });

  test("model ID filtering — old model embeddings ignored", () => {
    index.upsertChunks("note.md", [
      { index: 0, content: "old model chunk", hash: "h1", embedding: [1, 0] },
    ], "old-model");

    index.upsertChunks("note.md", [
      { index: 0, content: "new model chunk", hash: "h1", embedding: [0, 1] },
    ], "new-model");

    const oldResults = index.searchSimilar([1, 0], "old-model", 10);
    expect(oldResults).toHaveLength(1);
    expect(oldResults[0]!.chunkContent).toBe("old model chunk");

    const newResults = index.searchSimilar([0, 1], "new-model", 10);
    expect(newResults).toHaveLength(1);
    expect(newResults[0]!.chunkContent).toBe("new model chunk");
  });

  test("content hash staleness detection", () => {
    index.upsertChunks("doc.md", [
      { index: 0, content: "original", hash: "abc123", embedding: [1, 0] },
      { index: 1, content: "second chunk", hash: "def456", embedding: [0, 1] },
    ], MODEL);

    const hashes = index.getIndexedHashes(MODEL);
    expect(hashes.has("doc.md")).toBe(true);

    const fileHashes = hashes.get("doc.md")!;
    expect(fileHashes.get(0)).toBe("abc123");
    expect(fileHashes.get(1)).toBe("def456");
  });

  test("isEmpty returns true for empty index", () => {
    expect(index.isEmpty(MODEL)).toBe(true);
  });

  test("isEmpty returns false after inserting chunks", () => {
    index.upsertChunks("x.md", [
      { index: 0, content: "data", hash: "h", embedding: [1] },
    ], MODEL);
    expect(index.isEmpty(MODEL)).toBe(false);
  });

  test("upsert replaces existing chunks (same path + chunk_idx + model)", () => {
    index.upsertChunks("note.md", [
      { index: 0, content: "version 1", hash: "v1", embedding: [1, 0] },
    ], MODEL);

    index.upsertChunks("note.md", [
      { index: 0, content: "version 2", hash: "v2", embedding: [0, 1] },
    ], MODEL);

    const results = index.searchSimilar([0, 1], MODEL, 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.chunkContent).toBe("version 2");
  });

  test("limit parameter restricts result count", () => {
    for (let i = 0; i < 20; i++) {
      const vec = Array(4).fill(0);
      vec[i % 4] = 1;
      index.upsertChunks(`note-${i}.md`, [
        { index: 0, content: `chunk ${i}`, hash: `h${i}`, embedding: vec },
      ], MODEL);
    }

    const results = index.searchSimilar([1, 0, 0, 0], MODEL, 5);
    expect(results).toHaveLength(5);
  });
});
