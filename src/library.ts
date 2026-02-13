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
export const CLARK_CONTEXT_FILE_NAME = "CLARK.md";

const DEFAULT_ROOT_DIRS = [
  "Notes",
  "Resources",
  "Resources/Images",
  "Resources/PDFs",
  "Resources/Transcriptions",
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

  await ensureClarkCore(expanded);

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

async function ensureClarkCore(path: string): Promise<void> {
  const dirs = [
    clarkDirPath(path),
    clarkCanvasDirPath(path),
    clarkStructuresDirPath(path),
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  await writeIfMissing(clarkContextFilePath(path), "");
  for (const [relPath, content] of Object.entries(CLARK_STRUCTURE_TEMPLATES)) {
    await writeIfMissing(join(path, relPath), content);
  }
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
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
When processing a new resource, you should add it into the appropriate folder in the Resources directory. There are directories right now for "Images", "PDFs", and "Transcriptions".

When a resource is added, you should create a markdown transcription and put that in the "Transcriptions" folder. This transcript should be in markdown format while preserving headers and bullet points for the structure of the document. Images or diagrams should be tagged with a markdown link. Math should be formatted in LaTeX.

If relevant, add this resource to a \`Class\`, \`Problem Set\` or \`Paper\`. `,
};

const DEFAULT_ROOT_TEMPLATES: Record<string, string> = {
  "Templates/Paper Template.md": `#paper

## Key Ideas

## Questions
`,
};
