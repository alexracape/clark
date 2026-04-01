import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadClarkContext, clarkStructuresDirPath } from "../../core/library.ts";
import { Structure } from "../../core/structure.ts";
import baseSystemPrompt from "../../core/prompts/system.md" with { type: "text" };

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
      const structure = Structure.fromMarkdown(file.replace(".md", ""), content);
      lines.push(`- **${file}**: ${structure.summary}`);
    }

    return [
      "## Structures",
      "",
      "The student's workspace contains Structure definitions in Clark/Structures/.",
      "When they want to create a new structure, read the full definition file for instructions.",
      "Use the filename as the note title and do not repeat it as a leading # heading unless the user explicitly asks.",
      "",
      ...lines,
    ].join("\n");
  } catch {
    return "";
  }
}

export async function loadEffectiveSystemPrompt(
  workspaceDir: string,
): Promise<string> {
  const sections = [baseSystemPrompt];

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
