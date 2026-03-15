import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTools, type ToolDefinition } from "../core/mcp/tools.ts";
import type { EmbeddingProvider } from "../core/embedding/provider.ts";
import { EmbeddingIndex } from "../core/embedding/index.ts";
import { SearchIndexer } from "../core/embedding/indexer.ts";

let tempDir: string;
let vaultDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "clark-search-test-"));
  vaultDir = tempDir;
  await mkdir(join(vaultDir, "Clark"), { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Mock embedding provider that returns deterministic vectors based on content. */
class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock";
  readonly modelId = "mock-embed";
  readonly dimensions = 4;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      // Simple deterministic vector: based on text content
      const lower = text.toLowerCase();
      return [
        lower.includes("plant") || lower.includes("photosynthesis") ? 0.9 : 0.1,
        lower.includes("math") || lower.includes("calculus") ? 0.9 : 0.1,
        lower.includes("history") || lower.includes("war") ? 0.9 : 0.1,
        lower.includes("code") || lower.includes("programming") ? 0.9 : 0.1,
      ];
    });
  }
}

function findTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

function makeTools(opts: {
  embeddingProvider?: EmbeddingProvider | null;
  searchIndex?: EmbeddingIndex | null;
}) {
  return createTools({
    getBroker: () => null,
    vaultDir,
    getSaveCanvas: () => null,
    getEmbeddingProvider: () => opts.embeddingProvider ?? null,
    getSearchIndex: () => opts.searchIndex ?? null,
  });
}

describe("Semantic Search Integration", () => {
  test("semantic search returns results sorted by similarity", async () => {
    const provider = new MockEmbeddingProvider();
    const index = new EmbeddingIndex(join(tempDir, "search.db"));

    try {
      // Pre-populate index with chunks
      index.upsertChunks("biology/plants.md", [
        {
          index: 0,
          content: "Photosynthesis is the process by which plants convert sunlight into energy.",
          hash: "h1",
          embedding: [0.9, 0.1, 0.1, 0.1],
        },
      ], "mock-embed");

      index.upsertChunks("math/calculus.md", [
        {
          index: 0,
          content: "Calculus deals with rates of change and accumulation of quantities in math.",
          hash: "h2",
          embedding: [0.1, 0.9, 0.1, 0.1],
        },
      ], "mock-embed");

      const tools = makeTools({ embeddingProvider: provider, searchIndex: index });
      const searchTool = findTool(tools, "search_notes");
      const result = await searchTool.handler({ query: "plant biology" });

      const text = result.content[0]!;
      expect(text.type).toBe("text");
      if (text.type === "text") {
        // Should be a numbered list of file paths with scores
        expect(text.text).toMatch(/^1\. biology\/plants\.md \(score: [\d.]+, 1 chunk\)/);
        expect(text.text).toContain("2. math/calculus.md");
        // Plant result should come first (higher similarity)
        const plantIdx = text.text.indexOf("plants.md");
        const mathIdx = text.text.indexOf("calculus.md");
        expect(plantIdx).toBeGreaterThan(-1);
        expect(plantIdx).toBeLessThan(mathIdx);
        // Should NOT contain snippet content
        expect(text.text).not.toContain("Photosynthesis is the process");
      }
    } finally {
      index.close();
    }
  });

  test("falls back to keyword search when provider is null", async () => {
    // Create a file in the vault for keyword search
    await Bun.write(
      join(vaultDir, "notes.md"),
      "The quick brown fox jumps over the lazy dog. This sentence has enough characters to match.",
    );

    const tools = makeTools({ embeddingProvider: null, searchIndex: null });
    const searchTool = findTool(tools, "search_notes");
    const result = await searchTool.handler({ query: "quick brown fox" });

    const text = result.content[0]!;
    expect(text.type).toBe("text");
    if (text.type === "text") {
      // Should be a numbered list with match counts, no snippets
      expect(text.text).toMatch(/^1\. notes\.md \(\d+ matches\)$/);
      expect(text.text).not.toContain("quick brown fox");
    }
  });

  test("falls back to keyword search when index is empty", async () => {
    const provider = new MockEmbeddingProvider();
    const index = new EmbeddingIndex(join(tempDir, "search.db"));

    try {
      // Index is empty — should fall through to keyword search
      await Bun.write(
        join(vaultDir, "lecture.md"),
        "Introduction to photosynthesis and plant biology covering the basics of how plants work.",
      );

      const tools = makeTools({ embeddingProvider: provider, searchIndex: index });
      const searchTool = findTool(tools, "search_notes");
      const result = await searchTool.handler({ query: "photosynthesis" });

      const text = result.content[0]!;
      expect(text.type).toBe("text");
      if (text.type === "text") {
        // Should find via keyword fallback
        expect(text.text).toContain("lecture.md");
      }
    } finally {
      index.close();
    }
  });

  test("background indexing triggered on stale index", async () => {
    const provider = new MockEmbeddingProvider();
    const index = new EmbeddingIndex(join(tempDir, "search.db"));

    try {
      // Write a file that will need indexing
      await Bun.write(
        join(vaultDir, "new-note.md"),
        "A brand new note about programming and code that should be indexed eventually after search runs.",
      );

      const tools = makeTools({ embeddingProvider: provider, searchIndex: index });
      const searchTool = findTool(tools, "search_notes");

      // First search triggers background indexing (index is empty → keyword fallback)
      await searchTool.handler({ query: "programming" });

      // Give background indexing a moment to complete
      await new Promise((r) => setTimeout(r, 200));

      // Now index should have content
      expect(index.isEmpty("mock-embed")).toBe(false);
    } finally {
      index.close();
    }
  });
});

describe("SearchIndexer", () => {
  test("indexes files and detects staleness", async () => {
    const provider = new MockEmbeddingProvider();
    const index = new EmbeddingIndex(join(tempDir, "search.db"));

    try {
      await Bun.write(
        join(vaultDir, "test.md"),
        "# Plants\n\nPhotosynthesis is the process by which plants convert light into chemical energy for growth.",
      );

      const indexer = new SearchIndexer(index, provider);
      await indexer.indexFile(vaultDir, "test.md");

      expect(index.isEmpty("mock-embed")).toBe(false);

      // Re-indexing same file should be a no-op (hashes match)
      const hashes = index.getIndexedHashes("mock-embed");
      expect(hashes.has("test.md")).toBe(true);
    } finally {
      index.close();
    }
  });

  test("indexStaleFiles scans and indexes vault", async () => {
    const provider = new MockEmbeddingProvider();
    const index = new EmbeddingIndex(join(tempDir, "search.db"));

    try {
      await mkdir(join(vaultDir, "Notes"), { recursive: true });
      await Bun.write(
        join(vaultDir, "Notes", "bio.md"),
        "Biology notes about plant cells and photosynthesis covering the process in detail for the exam.",
      );
      await Bun.write(
        join(vaultDir, "Notes", "math.md"),
        "Calculus notes about derivatives and integrals covering the fundamental theorem thoroughly.",
      );

      const indexer = new SearchIndexer(index, provider);
      const result = await indexer.indexStaleFiles(vaultDir);

      expect(result.indexed).toBe(2);
      expect(index.isEmpty("mock-embed")).toBe(false);
    } finally {
      index.close();
    }
  });
});
