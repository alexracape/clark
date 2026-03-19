/**
 * Core eval harness.
 *
 * Creates real workspace files, wires up the ConversationEngine with
 * real tools, runs a turn against the subject LLM, then judges each
 * criterion with the judge LLM.
 */

import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { LLMProvider } from "../core/llm/provider.ts";
import type { ToolDefinition } from "../core/mcp/tools.ts";
import { Conversation } from "../core/llm/messages.ts";
import { ConversationEngine, type TurnCallbacks } from "../core/engine.ts";
import { createTools, type ToolsConfig } from "../core/mcp/tools.ts";
import { judgeCriterion } from "./judge.ts";
import type { EvalCase, EvalResult, CriterionResult } from "./cases.ts";

export interface HarnessOptions {
  /** Provider used as the test subject */
  subjectProvider: LLMProvider;
  /** Provider used to judge responses */
  judgeProvider: LLMProvider;
  /** System prompt to use (pass different prompts for A/B testing) */
  systemPrompt: string;
  /** Optional extra tools to include beyond the defaults */
  extraTools?: ToolDefinition[];
  /** Callback for progress reporting */
  onProgress?: (message: string) => void;
}

/**
 * Run a single eval case end-to-end:
 * 1. Create temp workspace with scaffolded files
 * 2. Build tools pointing at that workspace
 * 3. Run a conversation turn with the subject provider
 * 4. Judge each criterion with the judge provider
 * 5. Return scored results
 */
export async function runEvalCase(
  evalCase: EvalCase,
  options: HarnessOptions,
): Promise<EvalResult> {
  const start = Date.now();
  const workspaceDir = await mkdtemp(join(tmpdir(), "clark-eval-"));

  try {
    // 1. Scaffold workspace files
    await scaffoldWorkspace(workspaceDir, evalCase.setup.workspaceFiles ?? {});

    // 2. Build tools pointing at the workspace
    const tools = createEvalTools(workspaceDir, evalCase.setup.canvasOpen ?? false);

    // 3. Build user message with editor context (matching planSendInput logic)
    const userMessage = buildUserMessage(evalCase);

    // 4. Run conversation turn
    const conversation = new Conversation();
    conversation.addUserMessage(userMessage);

    const engine = new ConversationEngine({
      conversation,
      tools,
      systemPrompt: options.systemPrompt,
      maxToolCallsPerTurn: 10,
    });

    const toolsCalled: string[] = [];
    let responseText = "";

    const callbacks: TurnCallbacks = {
      onAssistantMessage: (text) => {
        responseText = text;
      },
      onToolStart: (name) => {
        toolsCalled.push(name);
        options.onProgress?.(`  Tool: ${name}`);
      },
    };

    await engine.runTurn(options.subjectProvider, callbacks);

    // If no onAssistantMessage fired, extract text from conversation
    if (!responseText) {
      const msgs = conversation.getMessages();
      for (const msg of msgs) {
        if (msg.role === "assistant") {
          for (const c of msg.content) {
            if (c.type === "text") responseText += c.text;
          }
        }
      }
    }

    options.onProgress?.(`  Response: ${responseText.slice(0, 100)}...`);

    // 5. Judge each criterion
    const criteriaResults: CriterionResult[] = [];
    for (const criterion of evalCase.criteria) {
      const verdict = await judgeCriterion(options.judgeProvider, {
        userMessage: evalCase.setup.userMessage,
        responseText,
        toolsCalled,
        criterionDescription: criterion.description,
        judgingPrompt: criterion.judgingPrompt,
      });
      criteriaResults.push({
        criterionId: criterion.id,
        description: criterion.description,
        score: verdict.score,
        pass: verdict.pass,
        reason: verdict.reason,
        weight: criterion.weight,
      });
    }

    const score = criteriaResults.reduce((sum, c) => sum + c.score * c.weight, 0);
    const maxScore = evalCase.criteria.reduce((sum, c) => sum + 3 * c.weight, 0);

    return {
      caseId: evalCase.id,
      caseName: evalCase.name,
      category: evalCase.category,
      responseText,
      toolsCalled,
      criteria: criteriaResults,
      score,
      maxScore,
      durationMs: Date.now() - start,
    };
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

/**
 * Create workspace files in the temp directory.
 */
async function scaffoldWorkspace(
  workspaceDir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(workspaceDir, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await Bun.write(fullPath, content);
  }
}

/**
 * Build the user message with editor context appended,
 * matching the planSendInput logic from gui/src/app-controller.ts.
 */
function buildUserMessage(evalCase: EvalCase): string {
  const { userMessage, editorFile } = evalCase.setup;
  if (!editorFile) return userMessage;

  return `${userMessage}\n\n---\nOpen file: ${editorFile.path}\n\`\`\`markdown\n${editorFile.content}\n\`\`\``;
}

/**
 * Create tools scoped to the eval workspace.
 * Canvas tools return a stub if canvasOpen is false.
 */
function createEvalTools(
  workspaceDir: string,
  canvasOpen: boolean,
): ToolDefinition[] {
  const config: ToolsConfig = {
    getBroker: () => null,
    getVaultDir: () => workspaceDir,
    getExportDir: () => workspaceDir,
    getSaveCanvas: () => null,
    onProgress: () => {},
    getOCRProvider: () => null,
    getEmbeddingProvider: () => null,
    getSearchIndex: () => null,
  };

  const tools = createTools(config);

  if (canvasOpen) {
    // Override read_canvas to return a placeholder indicating canvas is open
    const readCanvasIdx = tools.findIndex((t) => t.name === "read_canvas");
    if (readCanvasIdx !== -1) {
      tools[readCanvasIdx] = {
        ...tools[readCanvasIdx],
        handler: async () => ({
          content: [
            {
              type: "text" as const,
              text: "[Canvas snapshot: whiteboard with handwritten notes about quadratic equations]",
            },
          ],
        }),
      };
    }
  }

  return tools;
}
