import { describe, expect, test } from "bun:test";
import { collectWikilinkTargets } from "../gui/src/note-paths.ts";

describe("collectWikilinkTargets", () => {
  test("trims common workspace paths from markdown and asset suggestions", () => {
    const targets = collectWikilinkTargets([
      { name: "Notes", path: "Notes", type: "directory" },
      { name: "Reinforcement Learning.md", path: "Notes/Reinforcement Learning.md", type: "file" },
      { name: "Algorithms Class.md", path: "Classes/Algorithms Class.md", type: "file" },
      { name: "example.pdf", path: "Resources/PDFs/example.pdf", type: "file" },
      { name: "diagram.png", path: "Resources/Images/diagram.png", type: "file" },
    ]);

    expect(targets).toEqual([
      { path: "Classes/Algorithms Class.md", linkText: "Algorithms Class", subtitle: "Classes/Algorithms Class.md" },
      { path: "Resources/Images/diagram.png", linkText: "diagram.png", subtitle: "Resources/Images/diagram.png" },
      { path: "Resources/PDFs/example.pdf", linkText: "example.pdf", subtitle: "Resources/PDFs/example.pdf" },
      { path: "Notes/Reinforcement Learning.md", linkText: "Reinforcement Learning", subtitle: "Notes/Reinforcement Learning.md" },
    ]);
  });

  test("falls back to workspace-relative paths when basenames are ambiguous", () => {
    const targets = collectWikilinkTargets([
      { name: "RLHF.md", path: "Notes/RLHF.md", type: "file" },
      { name: "RLHF.md", path: "Classes/RLHF.md", type: "file" },
    ]);

    expect(targets).toEqual([
      { path: "Classes/RLHF.md", linkText: "Classes/RLHF", subtitle: null },
      { path: "Notes/RLHF.md", linkText: "Notes/RLHF", subtitle: null },
    ]);
  });
});
