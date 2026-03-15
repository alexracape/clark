import { test, expect, describe } from "bun:test";
import { chunkMarkdown } from "../core/embedding/chunker.ts";

describe("chunkMarkdown", () => {
  test("returns empty array for empty content", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   ")).toEqual([]);
  });

  test("skips trivially short chunks (< 50 chars)", () => {
    const result = chunkMarkdown("Short.");
    expect(result).toEqual([]);
  });

  test("creates a single chunk for a small paragraph", () => {
    const content = "This is a paragraph with enough content to exceed the minimum chunk size threshold for embedding.";
    const result = chunkMarkdown(content);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe(content);
    expect(result[0]!.index).toBe(0);
  });

  test("respects heading boundaries", () => {
    const content = [
      "# Section One",
      "",
      "Content for section one that is long enough to be a valid chunk on its own right here.",
      "",
      "# Section Two",
      "",
      "Content for section two that is also long enough to be a valid chunk on its own right here.",
    ].join("\n");

    const result = chunkMarkdown(content);
    // Each heading starts a new chunk boundary
    expect(result.length).toBeGreaterThanOrEqual(2);
    // No chunk should contain both "Section One" and "Section Two" content
    for (const chunk of result) {
      const hasOne = chunk.text.includes("Content for section one");
      const hasTwo = chunk.text.includes("Content for section two");
      expect(hasOne && hasTwo).toBe(false);
    }
  });

  test("merges adjacent paragraphs up to max size", () => {
    const para = "A".repeat(60);
    const content = `${para}\n\n${para}\n\n${para}`;
    // With default 2000 max, all three should merge into one chunk
    const result = chunkMarkdown(content);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toContain(para);
  });

  test("splits when merged content exceeds max size", () => {
    const para = "B".repeat(80);
    const content = `${para}\n\n${para}\n\n${para}`;
    // With max of 100, each paragraph should be its own chunk
    const result = chunkMarkdown(content, 100);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test("prepends heading context to chunks", () => {
    const content = [
      "# Photosynthesis",
      "",
      "The process by which plants convert light energy into chemical energy, storing it in glucose molecules for later use.",
      "",
      "This occurs primarily in the chloroplasts of plant cells, specifically within the thylakoid membranes.",
    ].join("\n");

    const result = chunkMarkdown(content);
    // At least one chunk should have the heading prepended
    const hasHeading = result.some((c) => c.text.includes("# Photosynthesis"));
    expect(hasHeading).toBe(true);
  });

  test("handles multiple heading levels", () => {
    const content = [
      "# Chapter 1",
      "",
      "Introductory text that is definitely long enough to exceed the fifty character minimum for chunks.",
      "",
      "## Section 1.1",
      "",
      "Detail text for section one point one that is definitely long enough to exceed the minimum for chunks.",
      "",
      "### Subsection 1.1.1",
      "",
      "Deep detail text for the subsection that is definitely long enough to exceed the minimum for chunking.",
    ].join("\n");

    const result = chunkMarkdown(content);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  test("assigns sequential indices", () => {
    const content = [
      "# A",
      "",
      "First paragraph content that is long enough to be a valid chunk on its own right here in this test.",
      "",
      "# B",
      "",
      "Second paragraph content that is long enough to be a valid chunk on its own right here in this test.",
    ].join("\n");

    const result = chunkMarkdown(content);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]!.index).toBe(i);
    }
  });
});
