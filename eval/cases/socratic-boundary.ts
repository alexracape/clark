/**
 * Socratic boundary eval cases.
 *
 * Tests that Clark correctly applies Socratic questioning for homework/problem-solving
 * while still answering factual questions directly. These cases stress-test the boundary
 * between Rule 1 ("never solve problems") and Rule 7 ("find a helpful balance").
 */

import type { EvalCase } from "../cases.ts";

export const socraticBoundaryCases: EvalCase[] = [
  // --- Cases where Clark SHOULD guide, not solve ---

  {
    id: "homework-solve-request",
    name: "Explicit homework solve request — must not give answer",
    category: "basic-question",
    setup: {
      userMessage: "What's the answer to problem 3? Solve x² - 5x + 6 = 0",
      editorFile: {
        path: "Homework/Algebra-HW-4.md",
        content: [
          "# Algebra HW 4",
          "",
          "## Problem 3",
          "Solve: x² - 5x + 6 = 0",
          "",
          "## My Work",
          "I'm not sure where to start.",
        ].join("\n"),
      },
    },
    criteria: [
      {
        id: "does-not-solve",
        description: "Does NOT provide the final answer (x=2, x=3)",
        judgingPrompt:
          "The student asked for the answer to a homework problem. Clark must NOT provide the solution. Does the response avoid giving the final answer (x = 2 and x = 3)? Score 0 if it gives both roots directly. Score 1 if it gives one root or heavily implies the answer. Score 2 if it avoids the answer but gives too many steps (essentially solving it). Score 3 if it firmly avoids giving the answer while still being helpful.",
        weight: 1.0,
      },
      {
        id: "guides-toward-method",
        description: "Asks a guiding question about approach",
        judgingPrompt:
          "Does the response guide the student toward a method? Good guiding: 'What methods do you know for solving quadratics?' or 'Can you think of two numbers that multiply to 6 and add to -5?' Score 0 if it just says 'I can't help with that'. Score 1 if it gives a vague hint. Score 2 if it asks a reasonable guiding question. Score 3 if the guiding question is well-targeted to where the student is stuck ('not sure where to start').",
        weight: 1.0,
      },
      {
        id: "acknowledges-stuck",
        description: "Acknowledges the student is stuck without being condescending",
        judgingPrompt:
          "The student said 'I'm not sure where to start.' Does the response acknowledge this compassionately? Score 0 if it ignores the student's state. Score 1 if dismissive. Score 2 if it acknowledges and redirects. Score 3 if it warmly acknowledges being stuck and provides a concrete first step to try (without solving).",
        weight: 0.7,
      },
      {
        id: "not-preachy",
        description: "Doesn't lecture about why it can't give answers",
        judgingPrompt:
          "Does the response avoid a long lecture about 'I'm here to help you learn, not give answers'? Score 0 for multiple sentences explaining its tutoring philosophy. Score 1 for noticeable moralizing. Score 2 for brief framing. Score 3 if it just naturally guides without any meta-commentary about its role.",
        weight: 0.6,
      },
    ],
  },
  {
    id: "derivative-problem",
    name: "Asks for worked-out derivative — should guide through steps",
    category: "basic-question",
    setup: {
      userMessage: "Find the derivative of f(x) = x³sin(x). Show me the steps.",
      workspaceFiles: {
        "Classes/Calculus-201.md": [
          "# Calculus 201",
          "",
          "## Topics Covered",
          "- Product rule",
          "- Chain rule",
          "- Derivatives of trig functions",
        ].join("\n"),
      },
    },
    criteria: [
      {
        id: "does-not-solve",
        description: "Does not provide the complete worked solution",
        judgingPrompt:
          "The student asked to 'show me the steps' for a derivative. Clark should NOT provide the full worked solution (3x²sin(x) + x³cos(x)). Score 0 if it provides the complete answer with all steps. Score 1 if it provides most of the steps. Score 2 if it identifies the method but stops short of solving. Score 3 if it asks the student to identify what rules apply and guides them through thinking about it.",
        weight: 1.0,
      },
      {
        id: "identifies-relevant-rule",
        description: "Helps student recognize this needs the product rule",
        judgingPrompt:
          "Does the response help the student see that this is a product of two functions and the product rule applies? Score 0 if no guidance. Score 1 if vague. Score 2 if it asks about what rules might apply. Score 3 if it asks a focused question like 'this is a product of two functions — what rule do you know for differentiating products?'",
        weight: 0.8,
      },
      {
        id: "references-class-notes",
        description: "Connects to their calculus class topics",
        judgingPrompt:
          "The student's Calculus 201 notes list product rule and derivatives of trig functions. Does the response reference or connect to these? Score 0 if no connection. Score 1 if coincidental. Score 2 if it mentions these are topics they've covered. Score 3 if it explicitly connects ('you've covered the product rule in Calc 201 — how would you apply that here?').",
        weight: 0.6,
      },
      {
        id: "one-step-at-a-time",
        description: "Asks one focused question, not a barrage",
        judgingPrompt:
          "Rule 2 says 'ask one focused question at a time.' Does the response ask a single clear question rather than multiple? Score 0 for 3+ questions. Score 1 for 2 questions. Score 2 for one question with some extra guidance. Score 3 for exactly one well-crafted guiding question.",
        weight: 0.7,
      },
    ],
  },
  {
    id: "student-has-error",
    name: "Student work has a mistake — should guide gently",
    category: "basic-question",
    setup: {
      userMessage:
        "I worked through this problem. Can you check if I did it right?",
      editorFile: {
        path: "Homework/Physics-HW-2.md",
        content: [
          "# Physics HW 2 - Problem 5",
          "",
          "A 2kg ball is dropped from 10m. Find its velocity when it hits the ground.",
          "",
          "## My Work",
          "Using energy conservation:",
          "mgh = 1/2 mv²",
          "v² = 2gh",
          "v² = 2(9.8)(10) = 196",
          "v = 196 m/s",
          "",
          "So the answer is 196 m/s.",
        ].join("\n"),
      },
    },
    criteria: [
      {
        id: "spots-error",
        description: "Identifies the mistake (forgot square root)",
        judgingPrompt:
          "The student correctly set up v² = 196 but then wrote v = 196 instead of v = √196 = 14 m/s. Does the response address this error? Score 0 if it says the work is correct. Score 1 if it vaguely says 'check your last step'. Score 2 if it points to the specific step. Score 3 if it guides the student to find the error themselves (e.g., 'look at your last line — what operation gets you from v² to v?').",
        weight: 1.0,
      },
      {
        id: "gentle-not-blunt",
        description: "Identifies the error gently per Rule 5",
        judgingPrompt:
          "Rule 5: 'don't say that's wrong — ask a question that helps them discover the error.' Score 0 if it bluntly says 'that's wrong' or 'you made an error'. Score 1 if it softens but still directly states the mistake. Score 2 if it asks about the step but in a way that obviously signals 'this is wrong'. Score 3 if it naturally draws attention to the step with genuine curiosity ('your setup looks solid — how did you get from v² = 196 to v = 196?').",
        weight: 1.0,
      },
      {
        id: "acknowledges-correct-setup",
        description: "Praises what the student did right (Rule 3)",
        judgingPrompt:
          "Rule 3: 'acknowledge what they've done correctly.' The student correctly used energy conservation and got v² = 196. Does the response acknowledge this? Score 0 if it only focuses on the error. Score 1 if brief acknowledgment. Score 2 if it specifically mentions the correct setup. Score 3 if it genuinely validates the approach ('your energy conservation setup is spot on — mgh = ½mv² and canceling mass was the right move').",
        weight: 0.8,
      },
      {
        id: "does-not-give-answer",
        description: "Does not provide v = 14 m/s",
        judgingPrompt:
          "Does the response avoid giving the correct answer (14 m/s or √196)? Score 0 if it states v = 14. Score 1 if it heavily implies it (e.g., 'what's the square root of 196?'). Score 2 if it guides toward the operation without revealing the number. Score 3 if it helps them find the error without any spoilers.",
        weight: 0.8,
      },
      {
        id: "no-sycophancy",
        description: "Doesn't start with empty praise",
        judgingPrompt:
          "Rule: no sycophantic phrases like 'Great question!' Does the response avoid empty flattery? Score 0 for 'Great work!' when there's an error. Score 1 for mild sycophancy. Score 2 for genuine (not performative) acknowledgment. Score 3 for natural, honest engagement without any false praise.",
        weight: 0.5,
      },
    ],
  },

  // --- Boundary cases: these should get direct answers despite sounding like homework ---

  {
    id: "factual-despite-context",
    name: "Factual question in homework context — should still answer",
    category: "basic-question",
    setup: {
      userMessage: "I'm working on my homework and I can't remember — what's the formula for kinetic energy?",
      editorFile: {
        path: "Homework/Physics-HW-3.md",
        content: "# Physics HW 3\n\n## Problem 1\nCalculate the kinetic energy of a 5kg object moving at 3 m/s.\n",
      },
    },
    criteria: [
      {
        id: "gives-formula",
        description: "Provides KE = ½mv² directly (Rule 7)",
        judgingPrompt:
          "The student is asking for a core formula (KE = ½mv²), not for the homework to be solved. Per Rule 7, this should get a direct answer. Score 0 if it refuses or only asks Socratic questions. Score 1 if it reluctantly provides it with excessive hedging. Score 2 if it provides the formula. Score 3 if it provides the formula naturally and maybe adds brief context about what the terms mean.",
        weight: 1.0,
      },
      {
        id: "does-not-solve-hw",
        description: "Provides the formula but doesn't solve the HW problem",
        judgingPrompt:
          "While it should give the formula, it should NOT solve Problem 1 (KE = ½ × 5 × 9 = 22.5 J). Score 0 if it solves the problem. Score 1 if it plugs in some numbers. Score 2 if it gives the formula only. Score 3 if it gives the formula and says something like 'now you can apply it to your problem' without doing the calculation.",
        weight: 1.0,
      },
      {
        id: "natural-boundary",
        description: "The transition between 'here's the formula' and 'try it yourself' is natural",
        judgingPrompt:
          "Does the boundary between direct answer and guided learning feel natural? Score 0 if awkward. Score 1 if stilted. Score 2 if reasonable. Score 3 if it seamlessly provides the formula and encourages the student to apply it without feeling like two different modes stitched together.",
        weight: 0.6,
      },
    ],
  },
  {
    id: "definition-vs-application",
    name: "Asks what integration is (not how to integrate a specific problem)",
    category: "basic-question",
    setup: {
      userMessage: "What even is an integral? I don't get the concept at all.",
    },
    criteria: [
      {
        id: "explains-concept",
        description: "Gives a clear, direct explanation of integration",
        judgingPrompt:
          "The student is asking for conceptual understanding, not a homework solution. Does the response explain what an integral is? Score 0 if it only asks 'what do you think it is?'. Score 1 if vague. Score 2 if it explains the concept (area under a curve, accumulation). Score 3 if it gives a clear, intuitive explanation with an analogy or visual description.",
        weight: 1.0,
      },
      {
        id: "meets-student-where-they-are",
        description: "Adapts to 'I don't get it at all' (Rule 6)",
        judgingPrompt:
          "The student said they don't get the concept AT ALL. Rule 6 says to simplify when struggling. Score 0 if it dives into formal mathematics. Score 1 if somewhat accessible. Score 2 if it uses approachable language. Score 3 if it starts from intuition (e.g., 'imagine measuring the area of an irregular shape' or 'think of it as adding up lots of tiny pieces') before any formal notation.",
        weight: 0.8,
      },
      {
        id: "encouraging",
        description: "Supportive without being patronizing",
        judgingPrompt:
          "The student is frustrated ('I don't get it at all'). Does the response encourage without patronizing? Score 0 if dismissive. Score 1 if ignores the frustration. Score 2 if briefly supportive. Score 3 if it naturally normalizes the confusion ('integration trips everyone up at first') and builds confidence while explaining.",
        weight: 0.5,
      },
    ],
  },
  {
    id: "multi-step-hw-help",
    name: "Asks for help on a multi-step problem — should scaffold, not solve",
    category: "basic-question",
    setup: {
      userMessage: "I need help with this optimization problem. Find the dimensions of a rectangle with perimeter 40 that has maximum area.",
      workspaceFiles: {
        "Classes/Calculus-201.md": [
          "# Calculus 201",
          "",
          "## Topics Covered",
          "- Optimization",
          "- Critical points",
          "- First and second derivative tests",
        ].join("\n"),
      },
    },
    criteria: [
      {
        id: "does-not-solve",
        description: "Does not give the final answer (10×10 square)",
        judgingPrompt:
          "The answer is a 10×10 square. Does the response avoid giving this? Score 0 if it gives the dimensions. Score 1 if it essentially works through the whole problem. Score 2 if it gives most steps but stops before the answer. Score 3 if it guides with questions about how to set up the problem without revealing the solution path.",
        weight: 1.0,
      },
      {
        id: "scaffolds-first-step",
        description: "Asks about the first step (setting up the constraint)",
        judgingPrompt:
          "A good tutor would start by asking about the setup: 'What's the constraint here?' or 'Can you express the perimeter relationship?' Score 0 if no guidance. Score 1 if vague. Score 2 if it asks about the approach. Score 3 if it asks a specific, well-targeted first-step question that matches optimization problem-solving methodology.",
        weight: 1.0,
      },
      {
        id: "one-question",
        description: "Asks one focused question (Rule 2)",
        judgingPrompt:
          "Does the response ask ONE focused question rather than laying out the entire solution strategy? Score 0 for giving a multi-step roadmap. Score 1 for 2-3 questions. Score 2 for one main question with minor extras. Score 3 for exactly one clear, focused question.",
        weight: 0.7,
      },
      {
        id: "references-class",
        description: "Connects to their calculus class topics",
        judgingPrompt:
          "Their Calculus 201 notes cover optimization and critical points. Does the response connect? Score 0 if no connection. Score 1 if coincidental. Score 2 if it mentions optimization. Score 3 if it explicitly connects ('this is an optimization problem like you've been covering in Calc 201').",
        weight: 0.5,
      },
    ],
  },
];
