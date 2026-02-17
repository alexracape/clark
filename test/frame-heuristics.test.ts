import { describe, expect, test } from "bun:test";
import {
  isFrameBlank,
  intermediateBlankFrameIds,
  trimTrailingBlankFrames,
} from "../src/canvas/frame-heuristics.ts";

describe("frame-heuristics", () => {
  test("marks frame blank only when no child and no overlapping page content", () => {
    expect(isFrameBlank(false, false)).toBe(true);
    expect(isFrameBlank(true, false)).toBe(false);
    expect(isFrameBlank(false, true)).toBe(false);
  });

  test("returns only intermediate blank frame ids", () => {
    const ids = intermediateBlankFrameIds([
      { id: "a", isBlank: false },
      { id: "b", isBlank: true },
      { id: "c", isBlank: false },
      { id: "d", isBlank: true },
    ]);

    expect(ids).toEqual(["b"]);
  });

  test("keeps at least one frame while trimming trailing blanks", () => {
    const frames = trimTrailingBlankFrames([
      { id: "1", isBlank: false },
      { id: "2", isBlank: true },
      { id: "3", isBlank: true },
    ]);
    expect(frames.map((f) => f.id)).toEqual(["1"]);

    const singleBlank = trimTrailingBlankFrames([{ id: "only", isBlank: true }]);
    expect(singleBlank.map((f) => f.id)).toEqual(["only"]);
  });
});
