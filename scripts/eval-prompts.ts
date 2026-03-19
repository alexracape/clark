/**
 * Prompt evaluation CLI runner.
 *
 * Runs eval cases against a real LLM provider and grades responses
 * using an LLM-as-judge. Produces a scorecard showing per-case results.
 *
 * Usage:
 *   bun scripts/eval-prompts.ts
 *   bun scripts/eval-prompts.ts --category basic-question
 *   bun scripts/eval-prompts.ts --case quadratic-formula
 *   bun scripts/eval-prompts.ts --provider anthropic --model claude-sonnet-4-6
 *   bun scripts/eval-prompts.ts --prompt-file core/prompts/system-v2.md
 *   bun scripts/eval-prompts.ts --json
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Side-effect imports to register all providers
import "../core/llm/anthropic.ts";
import "../core/llm/openai.ts";
import "../core/llm/gemini.ts";
import "../core/llm/ollama.ts";
import "../core/llm/mock.ts";

import { createProvider, setProviderOptions } from "../core/llm/provider.ts";
import { loadEffectiveSystemPrompt } from "../cli/bootstrap/system-prompt.ts";
import { runEvalCase } from "../eval/harness.ts";
import type { EvalCase, EvalResult } from "../eval/cases.ts";

// Import all case sets
import { basicQuestionCases } from "../eval/cases/basic-questions.ts";
import { ingestionCases } from "../eval/cases/ingestion.ts";
import { helpCases } from "../eval/cases/help.ts";
import { toolUseCases } from "../eval/cases/tool-use.ts";
import { socraticBoundaryCases } from "../eval/cases/socratic-boundary.ts";

const ALL_CASES: EvalCase[] = [
  ...basicQuestionCases,
  ...ingestionCases,
  ...helpCases,
  ...toolUseCases,
  ...socraticBoundaryCases,
];

// --- CLI ---

interface ParsedArgs {
  category?: string;
  case?: string;
  provider: string;
  model?: string;
  judgeProvider: string;
  judgeModel?: string;
  promptFile?: string;
  workspaceDir: string;
  json: boolean;
  verbose: boolean;
}

async function parseArgs(): Promise<ParsedArgs> {
  const parsed = await yargs(hideBin(process.argv))
    .scriptName("eval-prompts")
    .option("category", {
      alias: "c",
      type: "string",
      description: "Run only cases in this category",
      choices: ["basic-question", "ingestion", "help", "tool-use"],
    })
    .option("case", {
      type: "string",
      description: "Run only the case with this ID",
    })
    .option("provider", {
      alias: "p",
      type: "string",
      default: "anthropic",
      description: "Subject LLM provider",
    })
    .option("model", {
      alias: "m",
      type: "string",
      description: "Subject model name",
    })
    .option("judge-provider", {
      type: "string",
      default: "anthropic",
      description: "Judge LLM provider",
    })
    .option("judge-model", {
      type: "string",
      description: "Judge model name (defaults to subject model)",
    })
    .option("prompt-file", {
      type: "string",
      description: "Path to an alternative system prompt file (for A/B testing)",
    })
    .option("workspace-dir", {
      type: "string",
      default: ".",
      description: "Workspace directory for loading system prompt context",
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Show detailed progress and responses",
    })
    .help()
    .strict()
    .parse();

  return {
    category: parsed.category,
    case: parsed.case,
    provider: parsed.provider,
    model: parsed.model,
    judgeProvider: parsed.judgeProvider,
    judgeModel: parsed.judgeModel,
    promptFile: parsed.promptFile,
    workspaceDir: parsed.workspaceDir,
    json: parsed.json,
    verbose: parsed.verbose,
  };
}

// --- Main ---

/** Read the resolved model name from a provider instance (duck-typed). */
function resolveModelName(provider: { name: string; model?: string }): string {
  return (provider as { model?: string }).model ?? "(unknown)";
}

// Map of env var names to try for each provider (Bun loads .env automatically)
const PROVIDER_API_KEY_ENV: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_KEY", "ANTHROPIC_API_KEY"],
  openai: ["OPENAI_KEY", "OPENAI_API_KEY"],
  gemini: ["GEMINI_KEY", "GEMINI_API_KEY"],
};

/** Resolve the API key for a provider from env vars. */
function resolveApiKey(provider: string): string | undefined {
  const candidates = PROVIDER_API_KEY_ENV[provider];
  if (!candidates) return undefined;
  for (const key of candidates) {
    if (process.env[key]) return process.env[key];
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = await parseArgs();

  // Configure API keys from .env for subject and judge providers
  for (const providerName of new Set([args.provider, args.judgeProvider])) {
    const apiKey = resolveApiKey(providerName);
    if (apiKey) {
      setProviderOptions(providerName, { apiKey });
    }
  }

  // Filter cases
  let cases = ALL_CASES;
  if (args.category) {
    cases = cases.filter((c) => c.category === args.category);
  }
  if (args.case) {
    cases = cases.filter((c) => c.id === args.case);
  }
  if (cases.length === 0) {
    console.error("No matching eval cases found.");
    process.exit(1);
  }

  // Create providers
  const subjectProvider = createProvider(args.provider, args.model);
  const judgeProvider = createProvider(
    args.judgeProvider,
    args.judgeModel ?? args.model,
  );

  // Resolve the actual model name from the provider instance (may differ from arg if using default)
  const subjectModel = resolveModelName(subjectProvider);
  const judgeModel = resolveModelName(judgeProvider);

  // Load system prompt
  let systemPrompt: string;
  if (args.promptFile) {
    systemPrompt = await Bun.file(args.promptFile).text();
  } else {
    systemPrompt = await loadEffectiveSystemPrompt(args.workspaceDir);
  }

  if (!args.json) {
    console.log(`\nPrompt Eval`);
    console.log(`Subject: ${args.provider} / ${subjectModel}`);
    console.log(`Judge:   ${args.judgeProvider} / ${judgeModel}`);
    if (args.promptFile) {
      console.log(`Prompt:  ${args.promptFile}`);
    }
    console.log(`Cases:   ${cases.length}`);
    console.log(`${"─".repeat(80)}\n`);
  }

  // Run cases
  const results: EvalResult[] = [];
  for (const evalCase of cases) {
    if (!args.json) {
      process.stdout.write(`Running: ${evalCase.id}...`);
    }

    try {
      const result = await runEvalCase(evalCase, {
        subjectProvider,
        judgeProvider,
        systemPrompt,
        onProgress: args.verbose ? (msg) => console.log(msg) : undefined,
      });
      results.push(result);

      if (!args.json) {
        const pct = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0;
        const symbol = pct >= 80 ? "✓" : pct >= 50 ? "~" : "✗";
        console.log(` ${symbol} ${pct}% (${(result.durationMs / 1000).toFixed(1)}s)`);

        if (args.verbose) {
          for (const c of result.criteria) {
            const grade = ["✗", "△", "○", "★"][c.score] ?? "?";
            console.log(`    ${grade} ${c.criterionId} [${c.score}/3]: ${c.reason}`);
          }
          if (result.toolsCalled.length > 0) {
            console.log(`    Tools: ${result.toolsCalled.join(", ")}`);
          }
          console.log();
        }
      }
    } catch (err) {
      if (!args.json) {
        console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }
      results.push({
        caseId: evalCase.id,
        caseName: evalCase.name,
        category: evalCase.category,
        responseText: "",
        toolsCalled: [],
        criteria: evalCase.criteria.map((c) => ({
          criterionId: c.id,
          description: c.description,
          score: 0,
          pass: false,
          reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
          weight: c.weight,
        })),
        score: 0,
        maxScore: evalCase.criteria.reduce((sum, c) => sum + 3 * c.weight, 0),
        durationMs: 0,
      });
    }
  }

  // Output results
  if (args.json) {
    const totalScore = results.reduce((s, r) => s + r.score, 0);
    const totalMax = results.reduce((s, r) => s + r.maxScore, 0);
    console.log(JSON.stringify({
      subject: { provider: args.provider, model: subjectModel },
      judge: { provider: args.judgeProvider, model: judgeModel },
      results,
      totalScore,
      totalMax,
    }, null, 2));
  } else {
    printScorecard(results);
  }
}

function printScorecard(results: EvalResult[]): void {
  console.log(`\n${"─".repeat(80)}`);
  console.log(
    `${"Category".padEnd(16)}| ${"Case".padEnd(28)}| ${"Score".padEnd(8)}| Details`,
  );
  console.log(`${"─".repeat(80)}`);

  for (const r of results) {
    const details = r.criteria
      .map((c) => {
        const grade = ["✗", "△", "○", "★"][c.score] ?? "?";
        return `${c.criterionId}:${grade}${c.score}`;
      })
      .join(" ");
    const pct = r.maxScore > 0 ? Math.round((r.score / r.maxScore) * 100) : 0;
    console.log(
      `${r.category.padEnd(16)}| ${r.caseId.padEnd(28)}| ${`${pct}%`.padEnd(8)}| ${details}`,
    );
  }

  const totalScore = results.reduce((s, r) => s + r.score, 0);
  const totalMax = results.reduce((s, r) => s + r.maxScore, 0);
  const pct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  console.log(`${"─".repeat(80)}`);
  console.log(`TOTAL: ${totalScore.toFixed(1)}/${totalMax.toFixed(1)} (${pct}%)\n`);
}

await main();
