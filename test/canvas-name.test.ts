import { describe, test, expect } from "bun:test";
import { normalizeCanvasName, validateCanvasName } from "../src/canvas/name.ts";

describe("canvas name validation", () => {
  test("normalizes whitespace", () => {
    expect(normalizeCanvasName("  HW   1  ")).toBe("HW 1");
  });

  test("accepts safe names", () => {
    const result = validateCanvasName("Midterm Review 1.0");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe("Midterm Review 1.0");
  });

  test("rejects traversal names", () => {
    const result = validateCanvasName("../../etc/passwd");
    expect(result.ok).toBe(false);
  });

  test("rejects path separators", () => {
    const result = validateCanvasName("Unit/1");
    expect(result.ok).toBe(false);
  });
});
