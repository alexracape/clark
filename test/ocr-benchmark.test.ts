import { describe, expect, test } from "bun:test";
import { runBenchmark, summarizeBenchmark } from "../core/ocr/benchmark.ts";

describe("ocr benchmark utilities", () => {
  test("summarizeBenchmark computes aggregate metrics", () => {
    const summary = summarizeBenchmark([
      { runNumber: 1, renderMs: 100, ocrMs: 300, totalMs: 400, pageCount: 2 },
      { runNumber: 2, renderMs: 200, ocrMs: 200, totalMs: 400, pageCount: 2 },
    ]);

    expect(summary.totalRuns).toBe(2);
    expect(summary.avgRenderMs).toBe(150);
    expect(summary.avgOcrMs).toBe(250);
    expect(summary.avgTotalMs).toBe(400);
    expect(summary.minTotalMs).toBe(400);
    expect(summary.maxTotalMs).toBe(400);
    expect(summary.avgPagesPerSecond).toBeCloseTo(5, 5);
  });

  test("runBenchmark excludes warmups from measured runs", async () => {
    const calls: number[] = [];
    const result = await runBenchmark({
      runs: 2,
      warmupRuns: 1,
      executeRun: async (runNumber) => {
        calls.push(runNumber);
        return {
          renderMs: 10,
          ocrMs: 20,
          totalMs: 30,
          pageCount: 1,
        };
      },
    });

    expect(calls).toEqual([-1, 1, 2]);
    expect(result.runs.length).toBe(2);
    expect(result.summary.totalRuns).toBe(2);
  });
});
