/**
 * Library scaffolding utilities.
 *
 * Handles creating the notes library directory structure and
 * writing Structure/Template files for new users.
 */

import { homedir } from "node:os";
import { mkdir, access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { constants } from "node:fs";

/**
 * Expand ~ to the home directory in a path.
 */
export function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Check if a directory exists and has content (i.e. it's an existing library).
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
    // Directory doesn't exist — check if parent is writable
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
 * Create the library directory structure and write Structure/Template files.
 */
export async function scaffoldLibrary(path: string): Promise<void> {
  const expanded = expandPath(path);

  const dirs = [
    expanded,
    join(expanded, "Notes"),
    join(expanded, "Resources"),
    join(expanded, "Resources", "Canvas"),
    join(expanded, "Resources", "Images"),
    join(expanded, "Resources", "PDFs"),
    join(expanded, "Resources", "Transcriptions"),
    join(expanded, "Structures"),
    join(expanded, "Templates"),
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  for (const [relPath, content] of Object.entries(TEMPLATES)) {
    await Bun.write(join(expanded, relPath), content);
  }
}

// ---------------------------------------------------------------------------
// Structure & Template content (matches test/test_vault/)
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, string> = {
  "Structures/Class.md": `## Purpose
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

  "Structures/Problem Set.md": `## Purpose
This file represents a problem set that is being submitted for a class.
## Generation
These files should have the "Concepts" header and the #problem_set tag. This should link to the assignment document at the top. The main content should be the handwritten content as a linked PNG file. You should should add a link to this problem set in the relevant class.

## Template
#problem_set

[[questions.pdf]]
## Concepts
-

![[example_work.png]]`,

  "Structures/Idea.md": `## Purpose
This is an atomic unit and each idea should have its own file. Ideas should only link out to other ideas.

## Generation
During creation, check if this idea should be added to a \`Class\`. `,

  "Structures/Paper.md": `## Purpose
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

  "Structures/Quote.md": `The title of the file should be the quote itself. Only make changes or shorten if the formatting does not work as a title.

Include the #quote tag underneath followed by the full text of the quote and the author's name if provided.

## Example

Filename: "Do or do not there is no try"

#quote

"Do or do not there is no try"
- Yoda`,

  "Structures/Resource.md": `## Purpose
These are raw documents that are not in markdown format. They could be images, PDFs, slides, etc.
## Generation
When processing a new resource, you should add it into the appropriate folder in the Resources directory. There are directories right now for "Images", "PDFs", and "Transcriptions".

When a resource is added, you should create a markdown transcription and put that in the "Transcriptions" folder. This transcript should be in markdown format while preserving headers and bullet points for the structure of the document. Images or diagrams should be tagged with a markdown link. Math should be formatted in LaTeX.

If relevant, add this resource to a \`Class\`, \`Problem Set\` or \`Paper\`. `,

  "Templates/Paper Template.md": `#paper

## Key Ideas

## Questions
`,
};
