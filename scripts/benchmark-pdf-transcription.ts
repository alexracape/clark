import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { applyConfigToEnv, loadConfig, resolveApiKey } from "../core/config.ts";
import { getDefaultModelForProvider, listProviderNames, type ProviderName } from "../core/llm/catalog.ts";
import { createProvider } from "../core/llm/index.ts";
import { setProviderOptions } from "../core/llm/provider.ts";
import { checkPopplerAvailable, getPopplerInstallInstructions } from "../core/ocr/pdf-renderer.ts";
import type { OCRProvider } from "../core/ocr/provider.ts";
import { VisionOCRProvider } from "../core/ocr/provider.ts";
import { runBenchmark } from "../core/ocr/benchmark.ts";
import { transcribePDFToMarkdown } from "../core/ocr/transcribe.ts";

interface ParsedArgs {
  input: string;
  output?: string;
  pageRange?: string;
  provider?: string;
  model?: string;
  ocrMode: "vision" | "mock";
  runs: number;
  warmupRuns: number;
  dpi: number;
  renderConcurrency?: number;
  quiet: boolean;
}

class MockOCRProvider implements OCRProvider {
  readonly name = "mock-ocr";

  async transcribeImage(imageBuffer: ArrayBuffer, mimeType: string): Promise<string> {
    return `<!-- mock transcription (${mimeType}, ${imageBuffer.byteLength} bytes) -->`;
  }
}

await main();

async function main(): Promise<void> {
  try {
    const args = await parseArgs();

    const hasPoppler = await checkPopplerAvailable();
    if (!hasPoppler) {
      throw new Error(`pdftoppm (poppler) is not installed.\n${getPopplerInstallInstructions()}`);
    }

    const inputPath = resolve(process.cwd(), args.input);
    if (!(await Bun.file(inputPath).exists())) {
      throw new Error(`Input PDF not found: ${args.input}`);
    }

    const pageRange = parsePageRange(args.pageRange);
    const ocrProvider = await buildOCRProvider(args);
    let latestMarkdown = "";

    const benchmark = await runBenchmark({
      runs: args.runs,
      warmupRuns: args.warmupRuns,
      executeRun: async (runNumber) => {
        const result = await transcribePDFToMarkdown(inputPath, ocrProvider, {
          sourcePath: args.input,
          pageRange,
          dpi: args.dpi,
          renderConcurrency: args.renderConcurrency,
          onProgress: args.quiet
            ? undefined
            : (event) => {
              if (runNumber < 1) return;
              if (event.phase === "render") {
                console.log(`[run ${runNumber}] render page ${event.pageNumber} (${event.completed}/${event.total})`);
                return;
              }
              console.log(`[run ${runNumber}] ocr page ${event.pageNumber} (${event.completed}/${event.total})`);
            },
        });

        if (runNumber >= 1) {
          latestMarkdown = result.markdown;
          console.log(
            `run ${runNumber}/${args.runs}: pages=${result.pageCount}, ` +
            `render=${formatMs(result.metrics.renderMs)}, ` +
            `ocr=${formatMs(result.metrics.ocrMs)}, ` +
            `total=${formatMs(result.metrics.totalMs)}`,
          );
        }

        return {
          renderMs: result.metrics.renderMs,
          ocrMs: result.metrics.ocrMs,
          totalMs: result.metrics.totalMs,
          pageCount: result.pageCount,
        };
      },
    });

    if (args.output) {
      const outputPath = resolve(process.cwd(), args.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await Bun.write(outputPath, latestMarkdown);
      console.log(`\nWrote transcription to ${args.output}`);
    }

    console.log("\nBenchmark summary");
    console.log(`runs: ${benchmark.summary.totalRuns}`);
    console.log(`avg render: ${formatMs(benchmark.summary.avgRenderMs)}`);
    console.log(`avg ocr: ${formatMs(benchmark.summary.avgOcrMs)}`);
    console.log(`avg total: ${formatMs(benchmark.summary.avgTotalMs)}`);
    console.log(`min total: ${formatMs(benchmark.summary.minTotalMs)}`);
    console.log(`max total: ${formatMs(benchmark.summary.maxTotalMs)}`);
    console.log(`avg pages/sec: ${benchmark.summary.avgPagesPerSecond.toFixed(2)}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function parseArgs(): Promise<ParsedArgs> {
  const parsed = await yargs(hideBin(process.argv))
    .scriptName("benchmark-pdf-transcription")
    .option("input", {
      alias: "i",
      type: "string",
      demandOption: true,
      description: "Path to input PDF",
    })
    .option("output", {
      alias: "o",
      type: "string",
      description: "Optional output markdown path for final run",
    })
    .option("page-range", {
      type: "string",
      description: "Optional page range (e.g. 1-5 or 3)",
    })
    .option("provider", {
      type: "string",
      description: `Vision provider (${listProviderNames().join(", ")})`,
    })
    .option("model", {
      type: "string",
      description: "Model ID for vision provider",
    })
    .option("ocr-mode", {
      type: "string",
      choices: ["vision", "mock"] as const,
      default: "vision" as const,
      description: "Use a real vision provider or deterministic mock OCR",
    })
    .option("runs", {
      type: "number",
      default: 3,
      description: "Measured benchmark runs",
    })
    .option("warmup-runs", {
      type: "number",
      default: 1,
      description: "Warmup runs excluded from summary",
    })
    .option("dpi", {
      type: "number",
      default: 150,
      description: "pdftoppm render DPI",
    })
    .option("render-concurrency", {
      type: "number",
      description: "Override render worker count (default: cpus().length - 1)",
    })
    .option("quiet", {
      type: "boolean",
      default: false,
      description: "Hide per-page progress logs",
    })
    .help()
    .strict()
    .parse();

  return {
    input: parsed.input,
    output: parsed.output,
    pageRange: parsed.pageRange,
    provider: parsed.provider,
    model: parsed.model,
    ocrMode: parsed.ocrMode,
    runs: parsed.runs,
    warmupRuns: parsed.warmupRuns,
    dpi: parsed.dpi,
    renderConcurrency: parsed.renderConcurrency,
    quiet: parsed.quiet,
  };
}

function parsePageRange(raw?: string): { start: number; end: number } | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid page range "${raw}". Use "N" or "N-M".`);
  }
  const start = parseInt(match[1]!, 10);
  const end = match[2] ? parseInt(match[2], 10) : start;
  if (start < 1 || end < start) {
    throw new Error(`Invalid page range "${raw}".`);
  }
  return { start, end };
}

async function buildOCRProvider(args: ParsedArgs): Promise<OCRProvider> {
  if (args.ocrMode === "mock") return new MockOCRProvider();

  const config = await loadConfig();
  applyConfigToEnv(config);

  const providerName = resolveProviderName(args.provider ?? config.provider ?? "anthropic");
  const modelName = args.model
    ?? process.env.CLARK_MODEL
    ?? config.model
    ?? getDefaultModelForProvider(providerName);

  if (!modelName) {
    throw new Error(`No default model configured for provider "${providerName}".`);
  }

  const apiKey = await resolveApiKey(providerName, config);
  if (providerName !== "ollama" && !apiKey) {
    throw new Error(`Missing API key for provider "${providerName}". Set it in env or Clark config.`);
  }

  setProviderOptions(providerName, {
    ...(apiKey && apiKey !== "not-required" ? { apiKey } : {}),
    ...(config.maxTokens ? { maxTokens: config.maxTokens } : {}),
  });

  const provider = createProvider(providerName, modelName);
  return new VisionOCRProvider(provider);
}

function resolveProviderName(raw: string): ProviderName {
  const valid = new Set<ProviderName>(["anthropic", "openai", "gemini", "ollama"]);
  if (!valid.has(raw as ProviderName)) {
    throw new Error(`Unsupported provider "${raw}". Expected one of: ${[...valid].join(", ")}`);
  }
  return raw as ProviderName;
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}
