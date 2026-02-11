/**
 * Tests for Structure-based skills: loading, slugification, and prompt building.
 */

import { test, expect, describe } from "bun:test";
import { resolve } from "node:path";
import {
  slugify,
  extractPurpose,
  loadSkills,
  buildSkillPrompt,
  type Skill,
} from "../src/skills.ts";

const TEST_VAULT = resolve(import.meta.dir, "test_vault");

describe("slugify", () => {
  test("simple filename", () => {
    expect(slugify("Class.md")).toBe("class");
  });

  test("filename with spaces", () => {
    expect(slugify("Problem Set.md")).toBe("problem_set");
  });

  test("already lowercase", () => {
    expect(slugify("idea.md")).toBe("idea");
  });

  test("mixed case with spaces", () => {
    expect(slugify("My Custom Structure.md")).toBe("my_custom_structure");
  });

  test("multiple spaces collapsed", () => {
    expect(slugify("Some  Long  Name.md")).toBe("some_long_name");
  });
});

describe("extractPurpose", () => {
  test("extracts first sentence from Purpose section", () => {
    const content = `## Purpose
This file tracks key info. More details here.
## Generation
Some instructions.`;
    expect(extractPurpose(content)).toBe("This file tracks key info");
  });

  test("returns full text if no period", () => {
    const content = `## Purpose
A short description without period
## Generation
Instructions.`;
    expect(extractPurpose(content)).toBe(
      "A short description without period",
    );
  });

  test("returns fallback for missing Purpose section", () => {
    const content = `## Generation
Some instructions.`;
    expect(extractPurpose(content)).toBe("Generate this structure");
  });

  test("truncates long descriptions", () => {
    const longText = "A".repeat(100);
    const content = `## Purpose
${longText}
## Generation
Instructions.`;
    const result = extractPurpose(content);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).toEndWith("...");
  });
});

describe("loadSkills", () => {
  test("loads skills from test vault", async () => {
    const skills = await loadSkills(TEST_VAULT);
    expect(skills.length).toBeGreaterThan(0);

    const slugs = skills.map((s) => s.slug);
    expect(slugs).toContain("class");
    expect(slugs).toContain("problem_set");
    expect(slugs).toContain("idea");
    expect(slugs).toContain("paper");
    expect(slugs).toContain("quote");
    expect(slugs).toContain("resource");
  });

  test("each skill has content and description", async () => {
    const skills = await loadSkills(TEST_VAULT);
    for (const skill of skills) {
      expect(skill.content.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.displayName.length).toBeGreaterThan(0);
      expect(skill.slug.length).toBeGreaterThan(0);
    }
  });

  test("displayName preserves original casing", async () => {
    const skills = await loadSkills(TEST_VAULT);
    const classSkill = skills.find((s) => s.slug === "class");
    expect(classSkill?.displayName).toBe("Class");

    const psSkill = skills.find((s) => s.slug === "problem_set");
    expect(psSkill?.displayName).toBe("Problem Set");
  });

  test("returns empty array for nonexistent directory", async () => {
    const skills = await loadSkills("/nonexistent/path");
    expect(skills).toEqual([]);
  });

  test("returns empty array for directory without Structures", async () => {
    const skills = await loadSkills("/tmp");
    expect(skills).toEqual([]);
  });
});

describe("buildSkillPrompt", () => {
  const testSkill: Skill = {
    slug: "class",
    displayName: "Class",
    content: "## Purpose\nTrack courses.\n## Generation\nCreate with #class tag.",
    description: "Track courses",
  };

  test("includes skill display name", () => {
    const prompt = buildSkillPrompt(testSkill, "");
    expect(prompt).toContain("Class");
  });

  test("includes full skill content", () => {
    const prompt = buildSkillPrompt(testSkill, "");
    expect(prompt).toContain("## Purpose");
    expect(prompt).toContain("#class tag");
  });

  test("includes args when provided", () => {
    const prompt = buildSkillPrompt(testSkill, "CS101");
    expect(prompt).toContain("CS101");
    expect(prompt).toContain("user provided this context");
  });

  test("prompts for info when no args", () => {
    const prompt = buildSkillPrompt(testSkill, "");
    expect(prompt).toContain("didn't provide additional context");
  });

  test("mentions file tools", () => {
    const prompt = buildSkillPrompt(testSkill, "");
    expect(prompt).toContain("create_file");
  });

  test("includes Socratic guidance", () => {
    const prompt = buildSkillPrompt(testSkill, "");
    expect(prompt).toContain("Guide the student");
  });
});
