/**
 * Typed representation of a Structure definition file.
 *
 * Structure files live in Clark/Structures/ (user workspace) and
 * core/prompts/structures/ (shipped defaults). They follow a loose convention
 * of ## Purpose, ## Generation, and ## Template sections.
 */

export interface StructureData {
  name: string;
  purpose: string;
  generation: string;
  template: string | null;
  tags: string[];
}

export class Structure {
  name: string;
  purpose: string;
  generation: string;
  template: string | null;
  tags: string[];

  constructor(data: StructureData) {
    this.name = data.name;
    this.purpose = data.purpose;
    this.generation = data.generation;
    this.template = data.template;
    this.tags = data.tags;
  }

  /**
   * Parse a structure .md file into a typed Structure.
   * Any missing section falls back to a safe default.
   */
  static fromMarkdown(name: string, content: string): Structure {
    const purpose =
      extractSection(content, "Purpose") ?? "Generate this structure";
    const generation = extractSection(content, "Generation") ?? "";
    const template = extractSection(content, "Template") ?? null;
    const tags = extractTags(content);

    return new Structure({ name, purpose, generation, template, tags });
  }

  /**
   * One-line summary used in the system prompt (first sentence, max 80 chars).
   */
  get summary(): string {
    const firstSentence = this.purpose.split(/\.\s/)[0]!;
    return firstSentence.length > 80
      ? firstSentence.slice(0, 77) + "..."
      : firstSentence;
  }
}

function extractSection(content: string, heading: string): string | null {
  const match = content.match(
    new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`),
  );
  if (!match) return null;
  return match[1]!.trim() || null;
}

function extractTags(content: string): string[] {
  const matches = content.match(/#\w+/g) ?? [];
  return [...new Set(matches)];
}
