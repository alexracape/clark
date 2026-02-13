/**
 * Structure-based skills for dynamic slash commands.
 *
 * Scans the Structures directory in the user's vault, parses each
 * markdown file into a Skill definition, and provides utilities for
 * building system prompt overlays when a skill is activated.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { clarkStructuresDirPath } from "./library.ts";

export interface Skill {
  /** Slash command slug: "Problem Set.md" → "problem_set" */
  slug: string;
  /** Original filename without extension, used for display */
  displayName: string;
  /** Full content of the Structure markdown file */
  content: string;
  /** Short description from the ## Purpose section */
  description: string;
}

/**
 * Convert a Structure filename to a slash command slug.
 * "Problem Set.md" → "problem_set", "Class.md" → "class"
 */
export function slugify(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/**
 * Extract the first sentence of the ## Purpose section for use as
 * a command description in tab completion hints.
 */
export function extractPurpose(content: string): string {
  const match = content.match(/## Purpose\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!match) return "Generate this structure";
  const text = match[1]!.trim();
  const firstSentence = text.split(/\.\s/)[0]!;
  return firstSentence.length > 80
    ? firstSentence.slice(0, 77) + "..."
    : firstSentence;
}

/**
 * Scan the Structures directory and return a Skill for each .md file.
 * Returns [] if the directory doesn't exist.
 */
export async function loadSkills(vaultDir: string): Promise<Skill[]> {
  const structuresDir = clarkStructuresDirPath(vaultDir);
  try {
    const entries = await readdir(structuresDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md"));

    const skills: Skill[] = [];
    for (const file of mdFiles) {
      const content = await Bun.file(join(structuresDir, file)).text();
      skills.push({
        slug: slugify(file),
        displayName: file.replace(/\.md$/i, ""),
        content,
        description: extractPurpose(content),
      });
    }
    return skills;
  } catch {
    return [];
  }
}

/**
 * Build the system prompt overlay for an active skill.
 * Appended to the base system prompt during the skill's conversation turn.
 */
export function buildSkillPrompt(skill: Skill, args: string): string {
  let prompt = `\n\n---\n## Active Skill: ${skill.displayName}\n\n`;
  prompt += `The user wants to create a "${skill.displayName}" structure in their notes library. `;
  prompt += `Use the file tools (create_file, list_files, search_notes) to accomplish this.\n\n`;
  prompt += `Here are the instructions for this structure:\n\n${skill.content}\n`;

  if (args) {
    prompt += `\nThe user provided this context: "${args}"\n`;
    prompt += `Use this information to pre-fill what you can, but ask clarifying questions for anything ambiguous.\n`;
  } else {
    prompt += `\nThe user didn't provide additional context. Ask what information you need to create this structure.\n`;
  }

  prompt += `\nRemember: Guide the student through creating this structure. Ask questions to gather needed information rather than making assumptions.\n`;

  return prompt;
}
