/**
 * Type definitions for prompt evaluation test cases.
 */

export interface EvalCase {
  id: string;
  name: string;
  category: "basic-question" | "ingestion" | "help" | "tool-use";
  /** Simulated app state for the test */
  setup: {
    userMessage: string;
    editorFile?: { path: string; content: string };
    canvasOpen?: boolean;
    /** Files to scaffold in the temp workspace */
    workspaceFiles?: Record<string, string>;
  };
  /** What to check in the response */
  criteria: EvalCriterion[];
}

export interface EvalCriterion {
  id: string;
  /** Human-readable description */
  description: string;
  /** Sent to LLM judge — should describe what 0-3 looks like for this criterion */
  judgingPrompt: string;
  /** 0-1 weight for weighted scoring */
  weight: number;
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  category: EvalCase["category"];
  /** Full assistant response text */
  responseText: string;
  /** Tool names called during the turn */
  toolsCalled: string[];
  /** Per-criterion results */
  criteria: CriterionResult[];
  /** Weighted score (sum of criterion scores * weights) */
  score: number;
  /** Maximum possible weighted score (sum of 3 * weight for each criterion) */
  maxScore: number;
  /** Wall-clock time in ms */
  durationMs: number;
}

export interface CriterionResult {
  criterionId: string;
  description: string;
  /** 0-3 graded score */
  score: number;
  /** Backwards compat: score >= 2 */
  pass: boolean;
  reason: string;
  weight: number;
}
