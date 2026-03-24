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

import classStructure from "./prompts/structures/Class.md" with { type: "text" };
import problemSetStructure from "./prompts/structures/Problem Set.md" with { type: "text" };
import ideaStructure from "./prompts/structures/Idea.md" with { type: "text" };
import paperStructure from "./prompts/structures/Paper.md" with { type: "text" };
import quoteStructure from "./prompts/structures/Quote.md" with { type: "text" };
import resourceStructure from "./prompts/structures/Resource.md" with { type: "text" };

export const CLARK_DIR_NAME = "Clark";
export const CLARK_CANVAS_DIR_NAME = "Canvas";
export const CLARK_STRUCTURES_DIR_NAME = "Structures";
export const CLARK_TRANSCRIPTS_DIR_NAME = "Transcripts";
export const CLARK_SESSIONS_DIR_NAME = "Sessions";
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

export function clarkSessionsDirPath(workspaceDir: string): string {
  return join(clarkDirPath(workspaceDir), CLARK_SESSIONS_DIR_NAME);
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

### Workspace Layout

${workspaceLayout}

### Tags

- \`#class\` — A course or class
- \`#problem_set\` — A homework assignment or problem set
- \`#paper\` — An academic paper
- \`#quote\` — A quote

Do not use ANY additionaly or nested tags unless explicitly asked.

### File Processing Conventions

When processing PDFs and images:
- Include YAML frontmatter with source path, timestamp, and page range
- For scanned/handwritten PDFs, use OCR via \`transcribe_pdf\`
- For text-based PDFs, extract text directly via \`read_file\`

**Auto-detection**: When you call \`read_file\` on a PDF or image, Clark automatically checks for a markdown transcript and uses it if available. Transcripts are found by checking:
1. Same directory with .md extension (e.g., \`Resources/PDFs/lecture.pdf\` → \`Resources/PDFs/lecture.md\`)
2. Clark transcripts directory (e.g., any PDF/image → \`Clark/Transcripts/<filename>.md\`)

### Linking Conventions

- Use \`[[wikilinks]]\` to connect related notes
- Use \`![[embeds]]\` to embed images or other files inline
- When creating new files, link them to relevant classes or topics
- For files in the user's library link using only the base filename with no extension
- Ex. Resources/PDFs/example.pdf -> [[example]]
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
    clarkSessionsDirPath(path),
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
  "Clark/Structures/Class.md": classStructure,
  "Clark/Structures/Problem Set.md": problemSetStructure,
  "Clark/Structures/Idea.md": ideaStructure,
  "Clark/Structures/Paper.md": paperStructure,
  "Clark/Structures/Quote.md": quoteStructure,
  "Clark/Structures/Resource.md": resourceStructure,
};

const DEFAULT_ROOT_TEMPLATES: Record<string, string> = {
  "Templates/Paper Template.md": `#paper

## Key Ideas

## Questions
`,
};
