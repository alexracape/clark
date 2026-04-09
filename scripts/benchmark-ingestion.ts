/**
 * Benchmark the full file ingestion pipeline using mock LLM and OCR providers.
 *
 * Usage:
 *   bun scripts/benchmark-ingestion.ts --input path/to/sample.pdf
 *   bun scripts/benchmark-ingestion.ts --input path/to/sample.pdf --runs 5 --warmup-runs 1
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolve, join } from "node:path";
import { rm } from "node:fs/promises";
import { runBenchmark } from "../core/ocr/benchmark.ts";
import { runIngestionPipeline } from "../core/app/ingest.ts";
import type { OCRProvider } from "../core/ocr/provider.ts";
import type {
  LLMProvider,
  Message,
  Tool,
  StreamChunk,
} from "../core/llm/provider.ts";
import type { ToolDefinition } from "../core/mcp/tools.ts";

// --- CLI argument parsing ---

interface ParsedArgs {
  input: string;
  runs: number;
  warmupRuns: number;
  quiet: boolean;
}

async function parseArgs(): Promise<ParsedArgs> {
  const parsed = await yargs(hideBin(process.argv))
    .scriptName("benchmark-ingestion")
    .option("input", {
      alias: "i",
      type: "string",
      demandOption: true,
      description: "Path to a PDF file to benchmark with",
    })
    .option("runs", {
      type: "number",
      default: 3,
      description: "Number of measured benchmark runs",
    })
    .option("warmup-runs", {
      type: "number",
      default: 0,
      description: "Warmup runs excluded from summary",
    })
    .option("quiet", {
      type: "boolean",
      default: false,
      description: "Suppress per-run progress logs",
    })
    .help()
    .strict()
    .parse();

  return {
    input: parsed.input,
    runs: parsed.runs,
    warmupRuns: parsed.warmupRuns,
    quiet: parsed.quiet,
  };
}

// --- Mock providers ---

class MockOCRProvider implements OCRProvider {
  readonly name = "mock-ocr";

  async transcribeImage(imageBuffer: ArrayBuffer, mimeType: string): Promise<string> {
    return `# Mock Transcription\n\nThis is a deterministic mock transcription of an image (${mimeType}, ${imageBuffer.byteLength} bytes).\n\n## Section 1\n\nLorem ipsum dolor sit amet.\n`;
  }

  async consolidateTranscript(rawTranscript: string): Promise<string> {
    return rawTranscript;
  }
}

class MockLLMProvider implements LLMProvider {
  readonly name = "mock-llm";
  readonly supportsVision = false;

  async *chat(
    _messages: Message[],
    _tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk> {
    // Determine what kind of call this is from the system prompt and produce
    // a minimal valid response.
    let responseText: string;

    if (systemPrompt.includes("suggest") || systemPrompt.includes("filename")) {
      // File rename request — return a simple name
      responseText = "Mock Document Title";
    } else if (systemPrompt.includes("formatting") || systemPrompt.includes("Reformat")) {
      // Transcript cleanup — return the content as-is with a header
      responseText = "# Cleaned Transcript\n\nMock cleaned content.";
    } else {
      // Linking agent or other — return a simple text summary with no tool calls
      responseText = "No related notes found. File has been ingested.";
    }

    // Yield text deltas in small chunks to simulate streaming
    const chunkSize = 20;
    yield { type: "text-start" as const, id: "text-0" };
    for (let i = 0; i < responseText.length; i += chunkSize) {
      yield {
        type: "text-delta" as const,
        id: "text-0" as const,
        text: responseText.slice(i, i + chunkSize),
      };
    }
    yield { type: "text-end" as const, id: "text-0" };

    yield {
      type: "finish" as const,
      finishReason: "end_turn" as const,
    };
  }
}

// --- Workspace scaffolding ---

/** Create a temporary workspace directory with sample note files. */
async function createTempWorkspace(runTag: string): Promise<string> {
  const tmpBase = join(
    import.meta.dir,
    "..",
    ".benchmark-tmp",
    `ingestion-${runTag}-${Date.now()}`,
  );
  const wsDir = resolve(tmpBase);

  // Create directory structure with sample notes
  await Bun.write(
    join(wsDir, "Notes", "physics.md"),
    "# Physics\n\n## Resources\n\n- [[Textbook.pdf]]\n",
  );
  await Bun.write(
    join(wsDir, "Notes", "math.md"),
    "# Math 101\n\n## Homework\n\n- Problem set 1\n",
  );
  await Bun.write(
    join(wsDir, "Notes", "index.md"),
    "# Class Index\n\n- [[Notes/physics]]\n- [[Notes/math]]\n",
  );
  await Bun.write(
    join(wsDir, "Clark", "Transcripts", ".gitkeep"),
    "",
  );
  await Bun.write(
    join(wsDir, "Resources", "PDFs", ".gitkeep"),
    "",
  );

  return wsDir;
}

/** Remove a temporary workspace. */
async function removeTempWorkspace(wsDir: string): Promise<void> {
  try {
    await rm(wsDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// --- Minimal tool definitions (the mock LLM won't call them) ---

function createMinimalTools(_workspaceDir: string): ToolDefinition[] {
  const noopHandler = async (_input: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: "ok" }],
  });

  return [
    {
      name: "search_notes",
      description: "Search notes in the vault",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      handler: noopHandler,
    },
    {
      name: "list_files",
      description: "List files in a directory",
      inputSchema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Directory path" },
        },
      },
      handler: noopHandler,
    },
    {
      name: "edit_file",
      description: "Edit a file in the vault",
      inputSchema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "New content" },
        },
        required: ["path", "content"],
      },
      handler: noopHandler,
    },
  ];
}

// --- Main ---

await main();

async function main(): Promise<void> {
  try {
    const args = await parseArgs();

    const inputPath = resolve(process.cwd(), args.input);
    if (!(await Bun.file(inputPath).exists())) {
      throw new Error(`Input PDF not found: ${args.input}`);
    }

    const fileName = inputPath.split("/").pop()!;
    const mockLLM = new MockLLMProvider();
    const mockOCR = new MockOCRProvider();

    console.log(`Benchmarking ingestion pipeline`);
    console.log(`  input: ${inputPath}`);
    console.log(`  runs: ${args.runs}, warmup: ${args.warmupRuns}`);
    console.log(`  providers: mock LLM + mock OCR (no API calls)\n`);

    const workspaces: string[] = [];

    const benchmark = await runBenchmark({
      runs: args.runs,
      warmupRuns: args.warmupRuns,
      executeRun: async (runNumber) => {
        const tag = runNumber >= 1 ? `run${runNumber}` : `warmup${-runNumber}`;
        const wsDir = await createTempWorkspace(tag);
        workspaces.push(wsDir);

        // Copy the input PDF into the workspace Resources/PDFs/
        const destRelPath = `Resources/PDFs/${fileName}`;
        const destAbsPath = join(wsDir, destRelPath);
        await Bun.write(destAbsPath, Bun.file(inputPath));

        const tools = createMinimalTools(wsDir);

        const start = performance.now();

        const result = await runIngestionPipeline({
          filePath: destAbsPath,
          destPath: destRelPath,
          fileName,
          workspaceDir: wsDir,
          provider: mockLLM,
          tools,
          systemPrompt: "You are a helpful assistant that links files into a knowledge base.",
          conversationContext: "No active conversation.",
          ocrProvider: mockOCR,
          onProgress: (stage, message) => {
            if (!args.quiet && runNumber >= 1) {
              console.log(`  [run ${runNumber}] ${stage}: ${message}`);
            }
          },
        });

        const totalMs = performance.now() - start;

        if (!args.quiet && runNumber >= 1) {
          console.log(
            `  run ${runNumber}/${args.runs}: ${formatMs(totalMs)} — ${result.finalFileName}`,
          );
        }

        return {
          renderMs: 0,
          ocrMs: 0,
          totalMs,
          pageCount: 1,
        };
      },
    });

    // Cleanup all temporary workspaces
    for (const ws of workspaces) {
      await removeTempWorkspace(ws);
    }
    // Also clean up the parent .benchmark-tmp if empty
    await removeTempWorkspace(
      resolve(import.meta.dir, "..", ".benchmark-tmp"),
    );

    // Print summary
    console.log("\n--- Benchmark Summary ---");
    console.log(`runs:         ${benchmark.summary.totalRuns}`);
    console.log(`avg total:    ${formatMs(benchmark.summary.avgTotalMs)}`);
    console.log(`min total:    ${formatMs(benchmark.summary.minTotalMs)}`);
    console.log(`max total:    ${formatMs(benchmark.summary.maxTotalMs)}`);
    console.log(
      `throughput:   ${benchmark.summary.avgPagesPerSecond.toFixed(2)} files/sec`,
    );
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}
