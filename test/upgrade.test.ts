import { describe, expect, test } from "bun:test";
import { compareVersions } from "../cli/bootstrap/upgrade.ts";

describe("compareVersions", () => {
  test("equal versions return 0", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  test("handles v prefix", () => {
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "v0.1.0")).toBe(0);
  });

  test("older version returns -1", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
    expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
  });

  test("newer version returns 1", () => {
    expect(compareVersions("0.2.0", "0.1.0")).toBe(1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.1.1", "0.1.0")).toBe(1);
  });

  test("handles different length versions", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.1")).toBe(-1);
  });
});
