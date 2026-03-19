/**
 * Basic question eval cases.
 *
 * Tests whether Clark answers factual questions directly while adding
 * pedagogical value, maintaining the right tone, and avoiding hedging.
 */

import type { EvalCase } from "../cases.ts";

export const basicQuestionCases: EvalCase[] = [
  {
    id: "quadratic-formula",
    name: "Quadratic formula — direct factual query",
    category: "basic-question",
    setup: {
      userMessage: "What is the quadratic formula?",
    },
    criteria: [
      {
        id: "direct-answer",
        description: "Provides the quadratic formula directly",
        judgingPrompt:
          "Does the response contain the quadratic formula (x = (-b ± √(b²-4ac)) / 2a or equivalent)? Score 0 if it only asks questions without providing the formula. Score 1 if it eventually gives it but buries it. Score 2 if it states it clearly. Score 3 if it states it clearly and up-front.",
        weight: 1.0,
      },
      {
        id: "adds-value",
        description: "Adds pedagogical context beyond bare formula",
        judgingPrompt:
          "Beyond stating the formula, does the response add value — e.g., intuition for what it means, when to use it, what the discriminant tells you, or a connection to the student's work? Score 0 if bare formula only. Score 1 if minimal context. Score 2 if helpful context included. Score 3 if the added context genuinely deepens understanding.",
        weight: 0.7,
      },
      {
        id: "no-socratic-deflection",
        description: "Does not deflect with only Socratic questions",
        judgingPrompt:
          "Does the response avoid deflecting with ONLY questions? A response that gives the formula and then asks a follow-up is fine (score 3). A response that asks 'What do you already know?' before eventually answering is weak (score 1). A response that only asks questions and never provides the formula is a fail (score 0).",
        weight: 1.0,
      },
      {
        id: "concise",
        description: "Response is concise — every sentence adds value",
        judgingPrompt:
          "Is the response appropriately concise? Score 0 if it's a wall of text with lots of filler. Score 1 if it has noticeable padding or unnecessary preamble. Score 2 if it's reasonably focused. Score 3 if every sentence adds value with no filler at all.",
        weight: 0.6,
      },
      {
        id: "no-hedging",
        description: "No unnecessary hedging or AI disclaimers",
        judgingPrompt:
          "Does the response avoid unnecessary hedging? Score 0 if it says 'As an AI...' or heavily qualifies a simple fact. Score 1 if it has noticeable over-qualifying ('I believe...', 'If I'm not mistaken...'). Score 2 if mostly confident. Score 3 if it states the formula confidently like a knowledgeable friend would.",
        weight: 0.5,
      },
      {
        id: "tone",
        description: "Sounds like a knowledgeable friend, not a chatbot",
        judgingPrompt:
          "Does the response sound like a smart study partner? Score 0 if it sounds robotic or overly formal ('One should note that...'). Score 1 if generic AI-assistant tone. Score 2 if friendly and natural. Score 3 if it genuinely feels like talking to a knowledgeable friend — casual, direct, warm without being performative.",
        weight: 0.5,
      },
    ],
  },
  {
    id: "chain-rule",
    name: "Chain rule explanation",
    category: "basic-question",
    setup: {
      userMessage: "Explain the chain rule in calculus.",
    },
    criteria: [
      {
        id: "direct-answer",
        description: "Provides a clear explanation",
        judgingPrompt:
          "Does the response explain the chain rule (d/dx[f(g(x))] = f'(g(x)) · g'(x))? Score 0 if it only asks questions. Score 1 if vague or incomplete. Score 2 if clear and correct. Score 3 if clear, correct, and includes an illustrative example.",
        weight: 1.0,
      },
      {
        id: "adds-value",
        description: "Builds intuition beyond the formula",
        judgingPrompt:
          "Does the response help build intuition? E.g., 'think of it as peeling layers' or a concrete example like d/dx[sin(x²)]. Score 0 if formula only. Score 1 if minimal. Score 2 if helpful. Score 3 if the intuition genuinely aids understanding.",
        weight: 0.7,
      },
      {
        id: "concise",
        description: "Focused explanation without padding",
        judgingPrompt:
          "Is the explanation well-structured and focused? Score 0 for excessive length. Score 1 for noticeable bloat. Score 2 for reasonably focused. Score 3 for tight, well-organized explanation where every part earns its place.",
        weight: 0.6,
      },
      {
        id: "tone",
        description: "Knowledgeable friend tone",
        judgingPrompt:
          "Does it sound like a knowledgeable friend explaining this at a whiteboard? Score 0 if robotic/textbook. Score 1 if generic. Score 2 if friendly. Score 3 if genuinely conversational and engaging.",
        weight: 0.5,
      },
    ],
  },
  {
    id: "newtons-second-law",
    name: "Newton's second law — direct factual",
    category: "basic-question",
    setup: {
      userMessage: "What is Newton's second law?",
    },
    criteria: [
      {
        id: "direct-answer",
        description: "States F=ma directly",
        judgingPrompt:
          "Does the response state Newton's second law (F = ma)? Score 0 if it only asks questions. Score 1 if vague. Score 2 if clearly stated. Score 3 if clearly stated with brief context about what it means physically.",
        weight: 1.0,
      },
      {
        id: "no-socratic-deflection",
        description: "Does not deflect with only questions",
        judgingPrompt:
          "Score 0 if it only asks questions without stating the law. Score 1 if it asks questions first and buries the answer. Score 2 if it answers then asks a follow-up. Score 3 if it answers directly and any follow-up feels natural, not formulaic.",
        weight: 1.0,
      },
      {
        id: "no-hedging",
        description: "Confident delivery of a basic fact",
        judgingPrompt:
          "Newton's second law is a basic fact — it should be stated with confidence. Score 0 for 'As an AI...' or major hedging. Score 1 for unnecessary qualifiers. Score 2 for mostly confident. Score 3 for fully confident, natural delivery.",
        weight: 0.5,
      },
      {
        id: "concise",
        description: "Appropriately brief for a simple question",
        judgingPrompt:
          "This is a simple factual question. The response should be proportionally concise. Score 0 for a 300+ word essay. Score 1 for noticeable over-explanation. Score 2 for reasonable length. Score 3 for perfectly calibrated length — complete but not padded.",
        weight: 0.6,
      },
    ],
  },
  {
    id: "quadratic-with-editor",
    name: "Quadratic formula with class notes open",
    category: "basic-question",
    setup: {
      userMessage: "What is the quadratic formula?",
      editorFile: {
        path: "Classes/Algebra-101.md",
        content: [
          "# Algebra 101",
          "",
          "## Topics",
          "- Linear equations",
          "- Quadratic equations",
          "- Polynomials",
          "",
          "## Notes",
          "We covered factoring quadratics in week 3.",
          "The discriminant determines the number of real roots.",
        ].join("\n"),
      },
      workspaceFiles: {
        "Classes/Algebra-101.md": [
          "# Algebra 101",
          "",
          "## Topics",
          "- Linear equations",
          "- Quadratic equations",
          "- Polynomials",
          "",
          "## Notes",
          "We covered factoring quadratics in week 3.",
          "The discriminant determines the number of real roots.",
        ].join("\n"),
      },
    },
    criteria: [
      {
        id: "direct-answer",
        description: "Provides the quadratic formula",
        judgingPrompt:
          "Does the response contain the quadratic formula? Score 0-3 as before (0=missing, 2=clear, 3=clear and up-front).",
        weight: 1.0,
      },
      {
        id: "references-notes",
        description: "References the open class notes",
        judgingPrompt:
          "The student has Algebra 101 notes open that mention factoring quadratics and the discriminant. Does the response connect to this context? Score 0 if the notes are completely ignored. Score 1 if there's a generic mention. Score 2 if it references specific content from the notes (e.g., the discriminant, factoring). Score 3 if it naturally weaves the notes into the explanation (e.g., 'your notes mention the discriminant — that's the b²-4ac part').",
        weight: 0.8,
      },
      {
        id: "tone",
        description: "Knowledgeable friend tone",
        judgingPrompt:
          "Score 0-3 on whether it sounds like a smart study partner who noticed the student's notes, vs. a generic AI that happens to dump the formula.",
        weight: 0.5,
      },
    ],
  },
  {
    id: "ambiguous-concept",
    name: "Ambiguous question — should answer then check understanding",
    category: "basic-question",
    setup: {
      userMessage: "What's the difference between velocity and speed?",
    },
    criteria: [
      {
        id: "direct-answer",
        description: "Explains the difference clearly",
        judgingPrompt:
          "Does the response explain that speed is scalar (magnitude only) and velocity is a vector (magnitude + direction)? Score 0 if it only asks questions. Score 1 if vague. Score 2 if clear. Score 3 if clear with a concrete example.",
        weight: 1.0,
      },
      {
        id: "appropriate-follow-up",
        description: "Follow-up question is natural, not formulaic",
        judgingPrompt:
          "If the response includes a follow-up question, is it natural and useful? Score 0 if the follow-up is the only content (pure Socratic deflection). Score 1 if the follow-up feels tacked on ('Does that make sense?'). Score 2 if it's a reasonable follow-up. Score 3 if no follow-up (not needed for this) or the follow-up genuinely extends the conversation (e.g., 'are you working on a specific problem where this comes up?').",
        weight: 0.5,
      },
      {
        id: "no-hedging",
        description: "States a well-known distinction confidently",
        judgingPrompt:
          "This is a well-established physics distinction. Score 0-3 on confidence level, where 3 = states it like a fact (which it is), 0 = hedges unnecessarily.",
        weight: 0.4,
      },
    ],
  },
];
