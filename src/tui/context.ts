/**
 * Context window visualization.
 *
 * Renders a color-coded grid showing how much of the model's context
 * window is consumed by each category (system prompt, tools, messages, etc.).
 */

import chalk from "chalk";
import type { Conversation } from "../llm/messages.ts";
import type { ToolDefinition } from "../mcp/tools.ts";

/** Map model names to max context window tokens */
function getMaxContext(model: string): number {
  if (model.includes("claude")) return 200_000;
  if (model.includes("gpt-4o")) return 128_000;
  if (model.includes("gemini")) return 1_048_576;
  return 128_000;
}

/** Format token count with k/M suffixes */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface Category {
  label: string;
  tokens: number;
  color: (s: string) => string;
  sym: string;
}

export function formatContextGrid(
  model: string,
  conversation: Conversation,
  systemPrompt: string,
  tools: ToolDefinition[],
): string {
  const ctx = conversation.estimateContext();
  const systemTokens = Math.ceil(systemPrompt.length / 4);
  const toolDefTokens = Math.ceil(JSON.stringify(tools).length / 4);
  const used = ctx.totalTokens + systemTokens + toolDefTokens;
  const maxCtx = getMaxContext(model);
  const free = Math.max(0, maxCtx - used);
  const usedPct = Math.round((used / maxCtx) * 100);

  const COLS = 10;
  const ROWS = 10;
  const TOTAL = COLS * ROWS;

  const categories: Category[] = [
    { label: "System prompt", tokens: systemTokens, color: chalk.magenta, sym: "⛁" },
    { label: "Tool definitions", tokens: toolDefTokens, color: chalk.cyan, sym: "⛁" },
    { label: "User", tokens: ctx.userTokens, color: chalk.green, sym: "⛁" },
    { label: "Assistant", tokens: ctx.assistantTokens, color: chalk.blue, sym: "⛁" },
    { label: "Tool results", tokens: ctx.toolTokens, color: chalk.yellow, sym: "⛁" },
    { label: "Skills", tokens: 0, color: chalk.white, sym: "⛁" },
    { label: "Free space", tokens: free, color: chalk.gray, sym: "⛶" },
  ];

  // Allocate grid cells proportionally (min 1 for any non-zero category)
  const cellCounts = categories.map((c) =>
    c.tokens === 0 ? 0 : Math.max(1, Math.round((c.tokens / maxCtx) * TOTAL)),
  );
  // Adjust free space (last entry) so total is exactly TOTAL
  const allocated = cellCounts.reduce((a, b) => a + b, 0);
  cellCounts[cellCounts.length - 1] = Math.max(
    0,
    cellCounts[cellCounts.length - 1] + (TOTAL - allocated),
  );

  // Build flat cell list — fills left-to-right, wraps to next row
  const grid: string[] = [];
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    for (let j = 0; j < cellCounts[i]; j++) {
      grid.push(cat.color(cat.sym));
    }
  }

  // Legend lines placed beside grid rows
  const legend: (string | null)[] = [
    chalk.bold(model) + chalk.gray(` · ${fmtTokens(used)}/${fmtTokens(maxCtx)} tokens (${usedPct}%)`),
    null,
    chalk.gray.italic("Estimated usage by category"),
    ...categories.map((cat) => {
      const pct = ((cat.tokens / maxCtx) * 100).toFixed(1);
      return `${cat.color(cat.sym)} ${cat.label}: ${chalk.gray(`${fmtTokens(cat.tokens)} tokens (${pct}%)`)}`;
    }),
  ];

  // Assemble rows: grid cells + legend on the right
  const lines: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    const rowStr = grid.slice(row * COLS, (row + 1) * COLS).join(" ");
    const legendLine = row < legend.length ? legend[row] : null;
    lines.push(legendLine != null ? `${rowStr}   ${legendLine}` : rowStr);
  }

  lines.push("");
  lines.push(chalk.gray(`${ctx.messageCount} messages in conversation`));

  return lines.join("\n");
}
