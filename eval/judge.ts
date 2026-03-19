/**
 * LLM-as-judge logic for grading eval responses.
 *
 * Uses a separate LLM call to evaluate whether an assistant's response
 * meets a given criterion. Returns a graded score (0-3) for nuance
 * beyond binary pass/fail.
 */

import type { LLMProvider } from "../core/llm/provider.ts";
import { Conversation } from "../core/llm/messages.ts";

export interface JudgeVerdict {
  /** 0 = fail, 1 = partial, 2 = good, 3 = excellent */
  score: number;
  /** For backwards compat and scorecard display */
  pass: boolean;
  reason: string;
}

const JUDGE_SYSTEM_PROMPT = `You are evaluating an AI study assistant called Clark. Clark is designed to be like a knowledgeable friend — casual but competent, like a smart study partner who has the student's notes open.

Clark's core values (use these to calibrate your grading):
- **Direct + pedagogical**: Answer questions directly, then add value (intuition, connections to notes, a follow-up). Never deflect a factual question with only Socratic questions.
- **Uses student materials**: Reference their notes, open files, and workspace content rather than answering generically from training data.
- **Proactive tool use**: Search notes, read files, or check the canvas before answering when relevant content likely exists.
- **Concise and focused**: Every sentence should add value. No padding, filler, or unnecessary preamble.
- **Confident and natural**: No "As an AI...", no excessive hedging or disclaimers for straightforward facts. Clark should sound like a person, not a chatbot.
- **Warm but not performative**: Friendly tone without being sycophantic or over-the-top enthusiastic.

You will be given a user message, the assistant's response, tools called, and a criterion to evaluate.

Score on a 0-3 scale:
- **0 (fail)**: Criterion clearly not met. Major issue.
- **1 (weak)**: Partially met but with significant problems.
- **2 (good)**: Criterion met adequately. Minor issues at most.
- **3 (excellent)**: Criterion met exceptionally well.

Respond with ONLY a JSON object, no markdown fences:
{"score": 2, "reason": "brief explanation"}`;

/**
 * Ask the judge LLM to evaluate a single criterion.
 * Retries once if the response is malformed JSON.
 */
export async function judgeCriterion(
  judgeProvider: LLMProvider,
  opts: {
    userMessage: string;
    responseText: string;
    toolsCalled: string[];
    criterionDescription: string;
    judgingPrompt: string;
  },
): Promise<JudgeVerdict> {
  const userPrompt = [
    `## User message`,
    opts.userMessage,
    ``,
    `## Assistant response`,
    opts.responseText || "(empty response)",
    ``,
    `## Tools called`,
    opts.toolsCalled.length > 0 ? opts.toolsCalled.join(", ") : "(none)",
    ``,
    `## Criterion: ${opts.criterionDescription}`,
    opts.judgingPrompt,
  ].join("\n");

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await singleTurnChat(judgeProvider, JUDGE_SYSTEM_PROMPT, userPrompt);
    const verdict = parseVerdict(text);
    if (verdict) return verdict;
  }

  return { score: 0, pass: false, reason: "Judge returned malformed JSON after 2 attempts" };
}

/**
 * Run a single-turn chat with no tools. Returns the full response text.
 */
async function singleTurnChat(
  provider: LLMProvider,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const conversation = new Conversation();
  conversation.addUserMessage(userMessage);

  let text = "";
  for await (const chunk of provider.chat(
    conversation.getMessages(),
    [],
    systemPrompt,
  )) {
    if (chunk.type === "text_delta") {
      text += chunk.text;
    }
  }
  return text;
}

/**
 * Parse judge verdict from response text.
 * Handles both raw JSON and JSON wrapped in markdown code fences.
 * Supports both graded (score 0-3) and legacy binary (pass/fail) formats.
 */
function parseVerdict(text: string): JudgeVerdict | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.reason !== "string") return null;

    // Graded format: {"score": 0-3, "reason": "..."}
    if (typeof parsed.score === "number" && parsed.score >= 0 && parsed.score <= 3) {
      return {
        score: parsed.score,
        pass: parsed.score >= 2,
        reason: parsed.reason,
      };
    }

    // Legacy binary format: {"pass": bool, "reason": "..."}
    if (typeof parsed.pass === "boolean") {
      return {
        score: parsed.pass ? 2 : 0,
        pass: parsed.pass,
        reason: parsed.reason,
      };
    }

    return null;
  } catch {
    return null;
  }
}
