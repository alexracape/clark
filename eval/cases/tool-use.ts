/**
 * Tool use eval cases.
 *
 * Tests whether Clark proactively calls tools when it should, uses the
 * right tools with good parameters, and meaningfully incorporates results.
 */

import type { EvalCase } from "../cases.ts";

export const toolUseCases: EvalCase[] = [
  {
    id: "first-message-search",
    name: "First message — should search before answering",
    category: "tool-use",
    setup: {
      userMessage: "What topics have I been studying?",
      workspaceFiles: {
        "Classes/Physics-201.md":
          "# Physics 201\n\n## Topics\n- Mechanics\n- Thermodynamics\n",
        "Classes/Algebra-101.md":
          "# Algebra 101\n\n## Topics\n- Linear equations\n- Quadratic equations\n",
        "Notes/Essay-Ideas.md":
          "# Essay Ideas\n\nSome thoughts on modern literature.\n",
      },
    },
    criteria: [
      {
        id: "calls-tool",
        description: "Calls a file exploration tool",
        judgingPrompt:
          "Did the assistant call list_files or search_notes to explore the workspace? Check the tools_called list. Score 0 if no tools called. Score 1 if an unrelated tool was called. Score 2 if it called list_files or search_notes. Score 3 if it called list_files AND then read specific files to get details.",
        weight: 1.0,
      },
      {
        id: "tool-params",
        description: "Tool calls use sensible parameters",
        judgingPrompt:
          "Were the tool calls well-targeted? Score 0 if no tools. Score 1 if tools were called with useless params. Score 2 if reasonable params. Score 3 if the params show good judgment (e.g., listing the root or Classes/ directory rather than searching for a random keyword).",
        weight: 0.6,
      },
      {
        id: "uses-results",
        description: "Response reflects actual workspace contents",
        judgingPrompt:
          "Does the response mention specific content from the workspace (Physics 201, Algebra 101, Mechanics, Thermodynamics, Essay Ideas, etc.)? Score 0 for generic answer ignoring the workspace. Score 1 if it mentions files exist. Score 2 if it lists the topics found. Score 3 if it synthesizes findings naturally (e.g., 'looks like you're taking Physics and Algebra, plus working on some essay ideas').",
        weight: 1.0,
      },
      {
        id: "no-fabrication",
        description: "Doesn't fabricate content not in the workspace",
        judgingPrompt:
          "Does the response stick to what's actually in the workspace? Score 0 if it invents subjects/topics not present. Score 1 if it speculates significantly. Score 2 if mostly accurate with minor assumptions. Score 3 if it precisely reflects what the workspace contains, nothing more.",
        weight: 0.7,
      },
    ],
  },
  {
    id: "physics-notes-query",
    name: "Question about specific notes — should search first",
    category: "tool-use",
    setup: {
      userMessage: "What did my physics notes say about thermodynamics?",
      workspaceFiles: {
        "Classes/Physics-201.md":
          "# Physics 201\n\n## Topics\n- Mechanics\n- Thermodynamics\n- Electromagnetism\n",
        "Notes/Thermo-Lecture-3.md": [
          "# Thermodynamics Lecture 3",
          "",
          "## Laws of Thermodynamics",
          "1. Energy cannot be created or destroyed",
          "2. Entropy of an isolated system always increases",
          "3. Entropy approaches zero as temperature approaches absolute zero",
          "",
          "## Key Equations",
          "- ΔU = Q - W (First Law)",
          "- dS ≥ δQ/T (Second Law)",
        ].join("\n"),
      },
    },
    criteria: [
      {
        id: "search-strategy",
        description: "Searches effectively for thermodynamics content",
        judgingPrompt:
          "Did the assistant search for thermodynamics-related content effectively? Score 0 if no search. Score 1 if it searched with a poor query. Score 2 if it searched with a reasonable query. Score 3 if it searched, found the thermo lecture file, and read it to get the details.",
        weight: 1.0,
      },
      {
        id: "cites-specifics",
        description: "Cites specific content from the notes",
        judgingPrompt:
          "Does the response include specific content from the thermodynamics notes (laws, equations like ΔU = Q - W, entropy)? Score 0 if it gives generic thermodynamics info from training data. Score 1 if it vaguely references the notes. Score 2 if it mentions some specific content. Score 3 if it accurately summarizes the key content from the actual notes (laws + equations).",
        weight: 1.0,
      },
      {
        id: "distinguishes-sources",
        description: "Makes clear what came from notes vs general knowledge",
        judgingPrompt:
          "Does the response make it clear that it's reporting what the student's notes contain, rather than giving a general lecture? Score 0 if it just explains thermodynamics generically. Score 1 if unclear source. Score 2 if it frames it as 'your notes say...'. Score 3 if it clearly attributes content to the specific file and offers to help the student go deeper.",
        weight: 0.6,
      },
    ],
  },
  {
    id: "canvas-open-question",
    name: "Canvas open — should read canvas",
    category: "tool-use",
    setup: {
      userMessage: "Can you help me with what I'm working on?",
      canvasOpen: true,
      workspaceFiles: {
        "Notes/scratch.md": "# Scratch\n\nSome rough ideas.\n",
      },
    },
    criteria: [
      {
        id: "reads-canvas",
        description: "Calls read_canvas to see what's on screen",
        judgingPrompt:
          "Did the assistant call read_canvas? The canvas is open and the student said 'what I'm working on' — that's a clear signal. Score 0 if it didn't call read_canvas. Score 1 if it called other tools but not read_canvas. Score 2 if it called read_canvas. Score 3 if it called read_canvas and based its response on the canvas content.",
        weight: 1.0,
      },
      {
        id: "contextual-response",
        description: "Response is based on canvas content, not generic",
        judgingPrompt:
          "Does the response engage with what was found on the canvas rather than giving a generic 'how can I help?' Score 0 for completely generic. Score 1 if it acknowledges the canvas but doesn't engage. Score 2 if it references the canvas content. Score 3 if it actively starts helping with what it found on the canvas.",
        weight: 0.8,
      },
    ],
  },
  {
    id: "question-with-notes-available",
    name: "Conceptual question — should check notes before answering from memory",
    category: "tool-use",
    setup: {
      userMessage: "Can you explain what entropy means?",
      workspaceFiles: {
        "Notes/Thermo-Lecture-3.md": [
          "# Thermodynamics Lecture 3",
          "",
          "## Laws of Thermodynamics",
          "2. Entropy of an isolated system always increases",
          "",
          "## Prof's Definition",
          "Entropy is a measure of the number of microscopic configurations (microstates)",
          "that correspond to a given macroscopic state. More disorder = more microstates = higher entropy.",
        ].join("\n"),
        "Classes/Physics-201.md":
          "# Physics 201\n\n## Topics\n- Thermodynamics\n",
      },
    },
    criteria: [
      {
        id: "checks-notes-first",
        description: "Searches workspace before giving generic explanation",
        judgingPrompt:
          "Did the assistant search for entropy in the student's notes before answering? Score 0 if it just answered from training data with no tool use. Score 1 if it used tools but not for entropy. Score 2 if it searched for entropy-related content. Score 3 if it found and read the Thermo-Lecture-3 notes.",
        weight: 1.0,
      },
      {
        id: "uses-student-definition",
        description: "Uses the professor's definition from notes",
        judgingPrompt:
          "The student's notes contain their professor's specific definition of entropy (microstates, disorder). Does the response use or reference this definition? Score 0 if pure textbook/generic. Score 1 if it gives a generic definition ignoring notes. Score 2 if it incorporates some note content. Score 3 if it leads with or prominently features the professor's definition, then builds on it.",
        weight: 1.0,
      },
      {
        id: "adds-value-beyond-notes",
        description: "Adds helpful context beyond what's in the notes",
        judgingPrompt:
          "Does the response add value beyond just reading the notes back? Score 0 if it only parrots the notes. Score 1 if minimal addition. Score 2 if it adds a helpful example or analogy. Score 3 if it bridges the professor's definition with broader understanding (e.g., a concrete example of microstates).",
        weight: 0.6,
      },
    ],
  },
];
