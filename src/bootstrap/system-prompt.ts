import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadClarkContext, clarkStructuresDirPath } from "../library.ts";

/**
 * Extract the first sentence of the ## Purpose section from a Structure file.
 */
function extractPurpose(content: string): string {
  const match = content.match(/## Purpose\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!match) return "Generate this structure";
  const text = match[1]!.trim();
  const firstSentence = text.split(/\.\s/)[0]!;
  return firstSentence.length > 80
    ? firstSentence.slice(0, 77) + "..."
    : firstSentence;
}

/**
 * Scan Clark/Structures/ and return a summary for the system prompt.
 */
async function loadStructureSummary(workspaceDir: string): Promise<string> {
  const structuresDir = clarkStructuresDirPath(workspaceDir);
  try {
    const entries = await readdir(structuresDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
    if (mdFiles.length === 0) return "";

    const lines: string[] = [];
    for (const file of mdFiles) {
      const content = await Bun.file(join(structuresDir, file)).text();
      const name = file.replace(/\.md$/i, "");
      const purpose = extractPurpose(content);
      lines.push(`- **${name}**: ${purpose}`);
    }

    return [
      "## Structures",
      "",
      "The student's workspace contains Structure definitions in Clark/Structures/.",
      "When they want to create a new structure, read the full definition file for instructions, then use create_file to make it.",
      "",
      ...lines,
    ].join("\n");
  } catch {
    return "";
  }
}

export async function loadEffectiveSystemPrompt(workspaceDir: string): Promise<string> {
  const systemPromptPath = new URL("../prompts/system.md", import.meta.url).pathname;
  const systemPrompt = await Bun.file(systemPromptPath).text();

  const sections = [systemPrompt];

  const structures = await loadStructureSummary(workspaceDir);
  if (structures) {
    sections.push(structures);
  }

  const clarkContext = await loadClarkContext(workspaceDir);
  if (clarkContext) {
    sections.push(`## CLARK.md\n${clarkContext}`);
  }

  return sections.join("\n\n---\n");
}
