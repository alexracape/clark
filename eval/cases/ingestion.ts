/**
 * File ingestion eval cases.
 *
 * Tests whether Clark properly handles file drops, follows naming/linking
 * conventions, and integrates deeply with the student's workspace.
 */

import type { EvalCase } from "../cases.ts";

export const ingestionCases: EvalCase[] = [
  {
    id: "file-drop-with-class",
    name: "File dropped with existing class notes",
    category: "ingestion",
    setup: {
      userMessage:
        "I just dropped in my physics lecture notes from today. Can you help me file them?",
      workspaceFiles: {
        "Classes/Physics-201.md": [
          "# Physics 201",
          "",
          "## Topics",
          "- Mechanics",
          "- Thermodynamics",
          "- Electromagnetism",
          "",
          "## Resources",
          "- [[Lecture-1-Kinematics]]",
        ].join("\n"),
        "Resources/new-lecture-notes.md": [
          "# Lecture 8: Conservation of Energy",
          "",
          "- Kinetic energy: KE = 1/2 mv²",
          "- Potential energy: PE = mgh",
          "- Conservation: total energy is constant in isolated system",
          "- Work-energy theorem: net work = ΔKE",
        ].join("\n"),
      },
    },
    criteria: [
      {
        id: "tool-exploration",
        description: "Uses tools to explore workspace before acting",
        judgingPrompt:
          "Did the assistant call file tools (list_files, search_notes, read_file) to understand the workspace? Score 0 if no tools called. Score 1 if only one cursory call. Score 2 if reasonable exploration. Score 3 if it systematically explored (e.g., listed files, then read the class page to understand the structure).",
        weight: 1.0,
      },
      {
        id: "links-to-class",
        description: "Suggests linking to existing Physics 201 class",
        judgingPrompt:
          "Does the response suggest linking the lecture notes to the Physics 201 class file? Score 0 if no mention. Score 1 if vague suggestion. Score 2 if specific suggestion to add a wikilink. Score 3 if it actually proposes or makes the edit to add [[new-lecture-notes]] to the Resources section of Physics-201.md.",
        weight: 1.0,
      },
      {
        id: "integration-depth",
        description: "Demonstrates understanding of workspace conventions",
        judgingPrompt:
          "Does the response show understanding of how the workspace is organized? Score 0 if generic filing advice. Score 1 if it notices the existing files. Score 2 if it references the existing link pattern ([[Lecture-1-Kinematics]]) and follows it. Score 3 if it also identifies the topical match (energy/mechanics) and explains why it belongs with Physics 201.",
        weight: 0.8,
      },
      {
        id: "concise",
        description: "Brief, actionable response",
        judgingPrompt:
          "Is the response focused on the task? Score 0 for verbose explanation of what filing means. Score 1 for some padding. Score 2 for focused. Score 3 for crisp — tells the student what it did/recommends and why, nothing more.",
        weight: 0.5,
      },
    ],
  },
  {
    id: "pdf-ingested",
    name: "PDF ingested — naming conventions",
    category: "ingestion",
    setup: {
      userMessage:
        "I just added a PDF of a research paper about transformer architectures. Where should it go?",
      workspaceFiles: {
        "Clark/Structures/Paper.md": [
          "# Paper",
          "",
          "## Purpose",
          "This file corresponds to an academic paper that I read.",
          "",
          "## Template",
          "```",
          "# {Title}",
          "",
          "## Metadata",
          "- Authors:",
          "- Year:",
          "- Link:",
          "",
          "## Summary",
          "",
          "## Key Takeaways",
          "```",
        ].join("\n"),
        "Papers/Attention-Is-All-You-Need.md": [
          "# Attention Is All You Need",
          "",
          "## Metadata",
          "- Authors: Vaswani et al.",
          "- Year: 2017",
          "",
          "## Summary",
          "Introduced the transformer architecture.",
        ].join("\n"),
      },
    },
    criteria: [
      {
        id: "follows-convention",
        description: "Suggests placing in Papers/ directory",
        judgingPrompt:
          "Does the response suggest placing the paper in Papers/? Score 0 if no suggestion. Score 1 if generic. Score 2 if it says Papers/. Score 3 if it says Papers/ AND explains it's consistent with the existing structure (noting Attention-Is-All-You-Need is already there).",
        weight: 1.0,
      },
      {
        id: "uses-structure-template",
        description: "References or uses the Paper structure template",
        judgingPrompt:
          "Does the response reference the Paper structure? Score 0 if no mention. Score 1 if it vaguely suggests organizing it. Score 2 if it mentions the Paper template. Score 3 if it reads the structure file and suggests using the specific template fields (Metadata, Summary, Key Takeaways).",
        weight: 0.8,
      },
      {
        id: "tool-quality",
        description: "Uses the right tools with appropriate params",
        judgingPrompt:
          "Did the assistant use tools effectively? Score 0 if no tools. Score 1 if tools were called but not useful. Score 2 if it listed/searched files. Score 3 if it read the Paper structure definition to understand the template before making recommendations.",
        weight: 0.7,
      },
      {
        id: "connects-to-existing",
        description: "Notes relationship to existing transformer paper",
        judgingPrompt:
          "The workspace has 'Attention Is All You Need' — a foundational transformer paper. Does the response notice this connection? Score 0 if ignored. Score 1 if coincidental. Score 2 if it mentions the existing paper. Score 3 if it suggests linking the two or noting the relationship.",
        weight: 0.6,
      },
    ],
  },
];
