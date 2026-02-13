import { describe, expect, test } from "bun:test";
import { shouldCheckTrailingEmptyFrameAfterCreate } from "../src/canvas/page-autocreate.ts";

describe("shouldCheckTrailingEmptyFrameAfterCreate", () => {
  test("returns true for local user-created non-frame shapes", () => {
    expect(
      shouldCheckTrailingEmptyFrameAfterCreate(
        { type: "draw" } as { type: "draw" },
        "user",
      ),
    ).toBe(true);
  });

  test("returns false for frame creation by user", () => {
    expect(
      shouldCheckTrailingEmptyFrameAfterCreate(
        { type: "frame" } as { type: "frame" },
        "user",
      ),
    ).toBe(false);
  });

  test("returns false for remote non-frame creation (multi-client sync replay)", () => {
    expect(
      shouldCheckTrailingEmptyFrameAfterCreate(
        { type: "draw" } as { type: "draw" },
        "remote",
      ),
    ).toBe(false);
  });
});
