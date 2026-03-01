export interface BenchmarkRunMetrics {
  renderMs: number;
  ocrMs: number;
  totalMs: number;
  pageCount: number;
}

export interface BenchmarkRunResult extends BenchmarkRunMetrics {
  runNumber: number;
}

export interface BenchmarkSummary {
  totalRuns: number;
  avgRenderMs: number;
  avgOcrMs: number;
  avgTotalMs: number;
  minTotalMs: number;
  maxTotalMs: number;
  avgPagesPerSecond: number;
}

export interface BenchmarkOptions {
  runs: number;
  warmupRuns?: number;
  executeRun: (runNumber: number) => Promise<BenchmarkRunMetrics>;
}

export interface BenchmarkResult {
  runs: BenchmarkRunResult[];
  summary: BenchmarkSummary;
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const runs = Math.max(1, Math.floor(options.runs));
  const warmups = Math.max(0, Math.floor(options.warmupRuns ?? 0));

  for (let i = 0; i < warmups; i++) {
    await options.executeRun(-(i + 1));
  }

  const results: BenchmarkRunResult[] = [];
  for (let runNumber = 1; runNumber <= runs; runNumber++) {
    const metrics = await options.executeRun(runNumber);
    results.push({
      runNumber,
      ...metrics,
    });
  }

  return {
    runs: results,
    summary: summarizeBenchmark(results),
  };
}

export function summarizeBenchmark(results: BenchmarkRunResult[]): BenchmarkSummary {
  if (results.length === 0) {
    throw new Error("Cannot summarize benchmark with zero runs.");
  }

  const totalRuns = results.length;
  const totalRenderMs = sum(results.map((run) => run.renderMs));
  const totalOcrMs = sum(results.map((run) => run.ocrMs));
  const totalMs = sum(results.map((run) => run.totalMs));
  const minTotalMs = Math.min(...results.map((run) => run.totalMs));
  const maxTotalMs = Math.max(...results.map((run) => run.totalMs));
  const totalPages = sum(results.map((run) => run.pageCount));
  const totalSeconds = totalMs / 1000;
  const avgPagesPerSecond = totalSeconds > 0 ? totalPages / totalSeconds : 0;

  return {
    totalRuns,
    avgRenderMs: totalRenderMs / totalRuns,
    avgOcrMs: totalOcrMs / totalRuns,
    avgTotalMs: totalMs / totalRuns,
    minTotalMs,
    maxTotalMs,
    avgPagesPerSecond,
  };
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}
