/**
 * Workspace scaffolding utilities.
 *
 * Behavior:
 * - Always ensure a Clark subdirectory exists under the workspace root.
 * - If the workspace starts empty, also scaffold default top-level notes/resources folders.
 */

import { homedir } from "node:os";
import { mkdir, access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { constants } from "node:fs";

export const CLARK_DIR_NAME = "Clark";
export const CLARK_CANVAS_DIR_NAME = "Canvas";
export const CLARK_STRUCTURES_DIR_NAME = "Structures";
export const CLARK_TRANSCRIPTS_DIR_NAME = "Transcripts";
export const CLARK_CONTEXT_FILE_NAME = "CLARK.md";

const DEFAULT_ROOT_DIRS = [
  "Notes",
  "Resources",
  "Resources/Images",
  "Resources/PDFs",
  "Templates",
] as const;

/**
 * Expand ~ to the home directory in a path.
 */
export function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function clarkDirPath(workspaceDir: string): string {
  return join(expandPath(workspaceDir), CLARK_DIR_NAME);
}

export function clarkCanvasDirPath(workspaceDir: string): string {
  return join(clarkDirPath(workspaceDir), CLARK_CANVAS_DIR_NAME);
}

export function clarkStructuresDirPath(workspaceDir: string): string {
  return join(clarkDirPath(workspaceDir), CLARK_STRUCTURES_DIR_NAME);
}

export function clarkTranscriptsDirPath(workspaceDir: string): string {
  return join(clarkDirPath(workspaceDir), CLARK_TRANSCRIPTS_DIR_NAME);
}

export function clarkContextFilePath(workspaceDir: string): string {
  return join(clarkDirPath(workspaceDir), CLARK_CONTEXT_FILE_NAME);
}

/**
 * Check if a directory exists and has content.
 */
export async function isExistingLibrary(path: string): Promise<boolean> {
  try {
    const files = await readdir(expandPath(path));
    return files.length > 0;
  } catch {
    return false;
  }
}

/**
 * Validate that a path is writable (or can be created).
 */
export async function validateLibraryPath(
  path: string,
): Promise<{ valid: boolean; error?: string }> {
  const expanded = expandPath(path);

  try {
    await access(expanded, constants.W_OK);
    return { valid: true };
  } catch {
    const parent = resolve(expanded, "..");
    try {
      await access(parent, constants.W_OK);
      return { valid: true };
    } catch {
      return {
        valid: false,
        error: `Cannot write to ${expanded} (parent directory not writable)`,
      };
    }
  }
}

/**
 * Ensure workspace shape:
 * - Always create Clark core folders/files.
 * - Scaffold top-level defaults only when root starts empty.
 */
export async function scaffoldLibrary(path: string): Promise<void> {
  const expanded = expandPath(path);
  await mkdir(expanded, { recursive: true });

  const entriesBefore = await readdir(expanded);
  const startedEmpty = entriesBefore.length === 0;

  await ensureClarkCore(expanded, startedEmpty);

  if (startedEmpty) {
    for (const relDir of DEFAULT_ROOT_DIRS) {
      await mkdir(join(expanded, relDir), { recursive: true });
    }
    for (const [relPath, content] of Object.entries(DEFAULT_ROOT_TEMPLATES)) {
      await writeIfMissing(join(expanded, relPath), content);
    }
  }
}

/**
 * Read CLARK.md context text if present.
 */
export async function loadClarkContext(path: string): Promise<string> {
  const file = Bun.file(clarkContextFilePath(path));
  if (!(await file.exists())) return "";
  return (await file.text()).trim();
}

/**
 * Filter out system/hidden directories from a list of entries.
 */
function filterSystemDirs(entries: string[]): string[] {
  const systemDirs = new Set([
    ".git",
    ".obsidian",
    "node_modules",
    ".DS_Store",
    ".vscode",
    ".idea",
    "Clark", // Don't list Clark in the workspace layout
  ]);

  return entries.filter((entry) => {
    // Skip hidden dirs (starting with .)
    if (entry.startsWith(".")) return false;
    // Skip known system dirs
    if (systemDirs.has(entry)) return false;
    return true;
  });
}

/**
 * Generate the Workspace Layout section based on vault state.
 */
async function generateWorkspaceLayout(
  path: string,
  startedEmpty: boolean,
): Promise<string> {
  if (startedEmpty) {
    // Use default layout for new vaults
    return `- \`Notes/\` — Markdown notes, one file per topic
- \`Resources/\` — Raw documents (not markdown)
  - \`Resources/Images/\` — Screenshots, diagrams, photos
  - \`Resources/PDFs/\` — PDF documents
- \`Templates/\` — Reusable note templates
- \`Clark/Canvas/\` — tldraw canvas files (.tldr)
- \`Clark/Structures/\` — Structure definitions that guide how Clark creates files
- \`Clark/Transcripts/\` — Markdown transcripts of PDFs and images`;
  } else {
    // Scan and list actual top-level directories
    const entries = await readdir(path, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const userDirs = filterSystemDirs(dirs);

    if (userDirs.length === 0) {
      return `- \`Clark/Canvas/\` — tldraw canvas files (.tldr)
- \`Clark/Structures/\` — Structure definitions that guide how Clark creates files
- \`Clark/Transcripts/\` — Markdown transcripts of PDFs and images`;
    }

    const userDirList = userDirs
      .map((dir) => `- \`${dir}/\` — (your directory)`)
      .join("\n");
    return `${userDirList}
- \`Clark/Canvas/\` — tldraw canvas files (.tldr)
- \`Clark/Structures/\` — Structure definitions that guide how Clark creates files
- \`Clark/Transcripts/\` — Markdown transcripts of PDFs and images`;
  }
}

/**
 * Generate CLARK.md content based on vault state.
 */
async function generateClarkMd(
  path: string,
  startedEmpty: boolean,
): Promise<string> {
  const workspaceLayout = await generateWorkspaceLayout(path, startedEmpty);

  return `

## Workspace Layout

${workspaceLayout}

## Tags

- \`#class\` — A course or class
- \`#problem_set\` — A homework assignment or problem set
- \`#paper\` — An academic paper
- \`#quote\` — A quote

## File Processing Conventions

When processing PDFs and images:
- Save transcripts to \`Clark/Transcripts/<source-name>.md\`
- Include YAML frontmatter with source path, timestamp, and page range
- For scanned/handwritten PDFs, use OCR via \`transcribe_pdf\`
- For text-based PDFs, extract text directly via \`read_file\`

**Auto-detection**: When you call \`read_file\` on a PDF or image, Clark automatically checks for a markdown transcript and uses it if available. Transcripts are found by checking:
1. Same directory with .md extension (e.g., \`Resources/PDFs/lecture.pdf\` → \`Resources/PDFs/lecture.md\`)
2. Clark transcripts directory (e.g., any PDF/image → \`Clark/Transcripts/<filename>.md\`)

## Linking Conventions

- Use \`[[wikilinks]]\` to connect related notes
- Use \`![[embeds]]\` to embed images or other files inline
- When creating new files, link them to relevant classes or topics
`;
}

async function ensureClarkCore(
  path: string,
  startedEmpty: boolean,
): Promise<void> {
  const dirs = [
    clarkDirPath(path),
    clarkCanvasDirPath(path),
    clarkStructuresDirPath(path),
    clarkTranscriptsDirPath(path),
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  const clarkMd = await generateClarkMd(path, startedEmpty);
  await writeIfMissing(clarkContextFilePath(path), clarkMd);
  for (const [relPath, content] of Object.entries(CLARK_STRUCTURE_TEMPLATES)) {
    await writeIfMissing(join(path, relPath), content);
  }
}

async function writeIfMissing(
  filePath: string,
  content: string,
): Promise<void> {
  const file = Bun.file(filePath);
  if (await file.exists()) return;
  await Bun.write(filePath, content);
}

// ---------------------------------------------------------------------------
// Structure & Template content (matches test/test_vault/)
// ---------------------------------------------------------------------------

const CLARK_STRUCTURE_TEMPLATES: Record<string, string> = {
  "Clark/Structures/Class.md": `## Purpose
This file tracks of the key information associated with a course taken at school.
## Generation
The file should include headings such as "Concepts", "Homework", "Slides", "Class Notes". These files should be tracked with the #class tag.

## Template
#class

## Concepts
-
## Homework
-
## Slides
-
## Class Notes
-
`,

  "Clark/Structures/Problem Set.md": `## Purpose
This file represents a problem set that is being submitted for a class.
## Generation
These files should have the "Concepts" header and the #problem_set tag. This should link to the assignment document at the top. The main content should be the handwritten content as a linked PNG file. You should should add a link to this problem set in the relevant class.

## Template
#problem_set

[[questions.pdf]]
## Concepts
-

![[example_work.png]]`,

  "Clark/Structures/Idea.md": `## Purpose
This is an atomic unit and each idea should have its own file. Ideas should only link out to other ideas.

## Generation
During creation, check if this idea should be added to a \`Class\`. `,

  "Clark/Structures/Paper.md": `## Purpose
This file corresponds to an academic paper that I read.

## Generation
It should contain headings for "Key Ideas" and "Questions." It will also link out to the pdf version of the paper. These files should be marked with the #paper tag. You should not fill in any of the ideas or questions unless you are able to read them from the annotations on the PDF.
## Template
#paper

## Key Ideas
-
## Questions
-

![[example_paper]]`,

  "Clark/Structures/Quote.md": `The title of the file should be the quote itself. Only make changes or shorten if the formatting does not work as a title.

Include the #quote tag underneath followed by the full text of the quote and the author's name if provided.

## Example

Filename: "Do or do not there is no try"

#quote

"Do or do not there is no try"
- Yoda`,

  "Clark/Structures/Resource.md": `## Purpose
These are raw documents that are not in markdown format. They could be images, PDFs, slides, etc.
## Generation
When processing a new resource, you can organize it however makes sense for the workspace (e.g., in a Resources/ directory, or alongside related notes).

When a resource is added, you should create a markdown transcript. Save it to either:
- \`Clark/Transcripts/<filename>.md\` (recommended default)
- Same directory as the source file with .md extension

The transcript should be in markdown format while preserving headers and bullet points for the structure of the document. Images or diagrams should be tagged with a markdown link. Math should be formatted in LaTeX.

If reading the plain resource yields a significant amount of text, use that to create the markdown. Otherwise you can use the provided transcription tool (\`transcribe_pdf\`).

**Important**: When you call \`read_file\` on a PDF or image that has a transcript, the transcript will be used automatically. You don't need to manually read the transcript file.

If relevant, add this resource to a \`Class\`, \`Problem Set\` or \`Paper\`. `,
};

const DEFAULT_ROOT_TEMPLATES: Record<string, string> = {
  "Templates/Paper Template.md": `#paper

## Key Ideas

## Questions
`,
};
