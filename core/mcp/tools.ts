/**
 * MCP tool definitions and handlers.
 *
 * Each tool is defined with its schema and handler function.
 * File tools are scoped to the vault directory. Canvas tools delegate to the CanvasBroker.
 */

import { readdir, mkdir, rename, unlink, appendFile } from "node:fs/promises";
import { join, extname, dirname, relative, basename } from "node:path";
import { homedir } from "node:os";
import type { CanvasBroker } from "../canvas/server.ts";
import { exportPDFToFile } from "../canvas/pdf-export.ts";
import { extractPDFText, getPDFInfo, POPPLER_DOCS_URL } from "./pdf.ts";
import type { ToolInputSchema } from "../llm/provider.ts";
import type { OCRProvider } from "../ocr/provider.ts";
import type { EmbeddingProvider } from "../embedding/provider.ts";
import type { EmbeddingIndex } from "../embedding/index.ts";
import { SearchIndexer } from "../embedding/indexer.ts";
import { transcribePDF } from "../ocr/transcribe.ts";
import {
  extractWikilinks,
  buildLinkFooter,
  resolveVaultPath,
  invalidateFileIndex,
  isImageFile,
  isPDFFile,
  imageMimeType,
} from "./vault.ts";

export interface ToolAnnotations {
  /** If true, the tool does not modify its environment. */
  readOnlyHint?: boolean;
  /** If true, the tool may perform destructive updates (only meaningful when readOnlyHint is false). */
  destructiveHint?: boolean;
  /** If true, calling the tool repeatedly with the same args has no additional effect. */
  idempotentHint?: boolean;
  /** If true, the tool may interact with external entities beyond the local environment. */
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: ToolAnnotations;
  handler: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}

export interface ToolsConfig {
  /** Dynamic getter for the canvas broker. Returns null when no canvas is open. */
  getBroker: () => CanvasBroker | null;
  /** Legacy static vault dir (kept for compatibility in tests). */
  vaultDir?: string;
  /** Dynamic getter for vault/library dir (preferred). */
  getVaultDir?: () => string;
  /** Dynamic getter for default PDF export directory. */
  getExportDir?: () => string;
  /** Dynamic getter for canvas save function. Returns null when no canvas is open. */
  getSaveCanvas: () => (() => Promise<void>) | null;
  /** Callback for emitting progress messages to the TUI during long operations. */
  onProgress?: (message: string) => void;
  /** Dynamic getter for the OCR provider. Returns null if vision is not available. */
  getOCRProvider?: () => OCRProvider | null;
  /** Dynamic getter for the embedding provider. Returns null if not configured. */
  getEmbeddingProvider?: () => EmbeddingProvider | null;
  /** Dynamic getter for the embedding search index. Returns null if not configured. */
  getSearchIndex?: () => EmbeddingIndex | null;
  /**
   * When true, include the local DuckDuckGo websearch tool (for Ollama/local providers).
   * When false or omitted, include a lightweight websearch stub — the cloud proxy
   * replaces it with native provider search (Anthropic, OpenAI, Google) or Perplexity.
   */
  useLocalWebSearch?: boolean;
}

function invalidInputResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Find a transcript file for a given source file (PDF or image).
 * Checks common locations based on vault conventions.
 * Returns the relative path to the transcript if found, null otherwise.
 */
async function findTranscript(
  sourcePath: string,
  absoluteSourcePath: string,
  vaultDir: string,
): Promise<string | null> {
  const sourceBasename = basename(absoluteSourcePath, extname(absoluteSourcePath));

  // Location 1: Same directory with .md extension
  // e.g., Resources/PDFs/lecture.pdf -> Resources/PDFs/lecture.md
  const sameDirPath = join(dirname(absoluteSourcePath), `${sourceBasename}.md`);
  if (await Bun.file(sameDirPath).exists()) {
    return relative(vaultDir, sameDirPath);
  }

  // Location 2: Clark/Transcripts/ (default convention)
  // e.g., any/path/lecture.pdf -> Clark/Transcripts/lecture.md
  const transcriptsDirPath = join(vaultDir, "Clark", "Transcripts", `${sourceBasename}.md`);
  if (await Bun.file(transcriptsDirPath).exists()) {
    return relative(vaultDir, transcriptsDirPath);
  }

  return null;
}

/**
 * Create all tool definitions with their handlers wired to the given config.
 */
export function createTools(config: ToolsConfig): ToolDefinition[] {
  const currentVaultDir = () =>
    config.getVaultDir?.() ?? config.vaultDir ?? ".";
  const currentExportDir = () => config.getExportDir?.() ?? process.cwd();

  const tools: ToolDefinition[] = [
    // --- File tools (vault-scoped) ---

    {
      name: "read_file",
      description:
        "Read a file from the student's notes vault. Markdown files return text content with a list of resolved wikilinks. PDFs return extracted text (or a markdown transcript if available). Images return the image for visual analysis (or a markdown transcript if available). When a transcript exists for a PDF or image, it will be used automatically.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file, relative to the vault root",
          },
        },
        required: ["path"],
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        const inputPath = input.path as string;
        const absolutePath = await resolveVaultPath(inputPath, vaultDir);
        if (!absolutePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        try {
          // Check for transcript if this is a PDF or image
          if (isPDFFile(absolutePath) || isImageFile(absolutePath)) {
            const transcriptPath = await findTranscript(
              inputPath,
              absolutePath,
              vaultDir,
            );
            if (transcriptPath) {
              const transcriptAbsPath = join(vaultDir, transcriptPath);
              const text = await Bun.file(transcriptAbsPath).text();
              const links = extractWikilinks(text);
              const footer = await buildLinkFooter(links, vaultDir);
              const note = `\n\n[Note: Read from transcript at ${transcriptPath} (source: ${inputPath})]`;
              return {
                content: [
                  {
                    type: "text",
                    text: wrapFileContent(transcriptPath, text + footer + note),
                  },
                ],
                isError: false,
              };
            }
          }

          if (isImageFile(absolutePath)) {
            const buffer = await Bun.file(absolutePath).arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            return {
              content: [
                {
                  type: "image",
                  data: base64,
                  mimeType: imageMimeType(absolutePath),
                },
                { type: "text", text: `Image: ${inputPath}` },
              ],
              isError: false,
            };
          }

          if (isPDFFile(absolutePath)) {
            try {
              const text = await extractPDFText(absolutePath);
              const info = await getPDFInfo(absolutePath);
              const avgCharsPerPage = text.length / Math.max(info.pages, 1);
              let content = wrapFileContent(inputPath, text);
              if (avgCharsPerPage < 50) {
                content += `\n\n[Note: This PDF has very little extractable text (~${Math.round(avgCharsPerPage)} chars/page across ${info.pages} page${info.pages === 1 ? "" : "s"}). It may be scanned or image-based. Use transcribe_pdf to OCR it if you need the full content.]`;
              }
              return {
                content: [{ type: "text", text: content }],
                isError: false,
              };
            } catch {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error: PDF reading requires poppler to be installed.\nSee: ${POPPLER_DOCS_URL}`,
                  },
                ],
                isError: true,
              };
            }
          }

          // Markdown / text file
          const text = await Bun.file(absolutePath).text();
          const links = extractWikilinks(text);
          const footer = await buildLinkFooter(links, vaultDir);
          return {
            content: [
              { type: "text", text: wrapFileContent(inputPath, text + footer) },
            ],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error reading file: ${err}` }],
            isError: true,
          };
        }
      },
    },

    {
      name: "search_notes",
      description:
        "Search for the most related files in the notes vault. Uses semantic search when embeddings are configured, otherwise falls back to keyword matching. Returns a ranked list of the top 10 most related files. If multiple chunks from the same file match, that file is ranked higher. Use read_file to get the full content of any result.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (keyword or phrase)",
          },
        },
        required: ["query"],
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        const query = input.query;
        if (typeof query !== "string") {
          return invalidInputResult("query must be a string.");
        }
        const embeddingProvider = config.getEmbeddingProvider?.() ?? null;
        const searchIndex = config.getSearchIndex?.() ?? null;

        // Try semantic search if provider + index are available
        if (embeddingProvider && searchIndex) {
          const indexEmpty = searchIndex.isEmpty(embeddingProvider.modelId);

          if (indexEmpty) {
            // First search ever — build the index now and wait for it so this
            // query gets real semantic results instead of falling through to
            // keyword search on an empty index.
            config.onProgress?.("Building semantic search index...");
            await triggerBackgroundIndexing(vaultDir, searchIndex, embeddingProvider);
          } else {
            // Index populated — kick off a background refresh for stale files
            triggerBackgroundIndexing(vaultDir, searchIndex, embeddingProvider);
          }

          try {
            const [queryVec] = await embeddingProvider.embed([query]);
            if (queryVec && queryVec.length > 0) {
              const results = searchIndex.searchSimilar(queryVec, embeddingProvider.modelId, 30);

              if (results.length > 0) {
                // Aggregate by file path
                const fileMap = new Map<string, { maxScore: number; count: number }>();
                for (const r of results) {
                  const existing = fileMap.get(r.path);
                  if (existing) {
                    existing.maxScore = Math.max(existing.maxScore, r.score);
                    existing.count += 1;
                  } else {
                    fileMap.set(r.path, { maxScore: r.score, count: 1 });
                  }
                }

                // Compute aggregated score and sort
                const fileResults = Array.from(fileMap.entries())
                  .map(([path, { maxScore, count }]) => ({
                    path,
                    score: maxScore + 0.05 * (count - 1),
                    count,
                  }))
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 10);

                const text = fileResults
                  .map((r, i) =>
                    `${i + 1}. ${r.path} (score: ${r.score.toFixed(3)}, ${r.count} chunk${r.count > 1 ? "s" : ""})`,
                  )
                  .join("\n");

                return { content: [{ type: "text", text }], isError: false };
              }
            }
          } catch {
            // Embedding failed — fall through to keyword search
          }
        }

        // Keyword search fallback
        const keywordResults = await searchDirectory(vaultDir, query.toLowerCase());
        if (keywordResults.length === 0) {
          return {
            content: [
              { type: "text", text: `No results found for "${query}"` },
            ],
            isError: false,
          };
        }

        const text = keywordResults
          .sort((a, b) => b.matchCount - a.matchCount)
          .slice(0, 10)
          .map(
            (r, i) =>
              `${i + 1}. ${r.path} (${r.matchCount} matches)`,
          )
          .join("\n");

        return { content: [{ type: "text", text }], isError: false };
      },
    },

    {
      name: "list_files",
      description:
        "List files in the notes vault, optionally scoped to a subdirectory and filtered by extension.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Subdirectory path relative to the vault root (omit for vault root)",
          },
          extension: {
            type: "string",
            description: "Filter by file extension (e.g., '.md', '.pdf')",
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        const subPath = (input.path as string | undefined) ?? ".";
        const absolutePath = await resolveVaultPath(subPath, vaultDir);
        if (!absolutePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        const ext = input.extension as string | undefined;

        try {
          const entries = await readdir(absolutePath, { recursive: true });
          const filtered = ext
            ? entries.filter((e) => e.endsWith(ext))
            : entries;

          return {
            content: [
              {
                type: "text",
                text: filtered.join("\n") || "(empty directory)",
              },
            ],
            isError: false,
          };
        } catch (err) {
          return {
            content: [
              { type: "text", text: `Error listing directory: ${err}` },
            ],
            isError: true,
          };
        }
      },
    },

    {
      name: "create_file",
      description:
        "Create a new file in the student's notes vault. Fails if the file already exists.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path for the new file, relative to the vault root",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
        },
        required: ["path", "content"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        const inputPath = input.path as string;
        const absolutePath = await resolveVaultPath(inputPath, vaultDir);
        if (!absolutePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        try {
          const file = Bun.file(absolutePath);
          if (await file.exists()) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: file already exists. Use edit_file to modify existing files.",
                },
              ],
              isError: true,
            };
          }

          // Ensure parent directory exists
          await mkdir(dirname(absolutePath), { recursive: true });
          await Bun.write(absolutePath, input.content as string);
          invalidateFileIndex();
          queueFileReindex(inputPath, config);
          return {
            content: [{ type: "text", text: `Created: ${inputPath}` }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error creating file: ${err}` }],
            isError: true,
          };
        }
      },
    },

    {
      name: "edit_file",
      description:
        "Edit an existing file in the student's notes vault by finding and replacing a text substring.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file, relative to the vault root",
          },
          old_text: {
            type: "string",
            description: "The exact text to find and replace",
          },
          new_text: {
            type: "string",
            description: "The replacement text",
          },
        },
        required: ["path", "old_text", "new_text"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        const inputPath = input.path as string;
        const absolutePath = await resolveVaultPath(inputPath, vaultDir);
        if (!absolutePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        const oldText = input.old_text as string;
        const newText = input.new_text as string;

        try {
          const content = await Bun.file(absolutePath).text();

          if (!content.includes(oldText)) {
            return {
              content: [
                { type: "text", text: "Error: old_text not found in file." },
              ],
              isError: true,
            };
          }

          const updated = content.replace(oldText, newText);
          await Bun.write(absolutePath, updated);
          queueFileReindex(inputPath, config);
          return {
            content: [{ type: "text", text: `Updated: ${inputPath}` }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error editing file: ${err}` }],
            isError: true,
          };
        }
      },
    },

    {
      name: "rename_file",
      description: "Rename or move a file within the student's notes vault.",
      inputSchema: {
        type: "object",
        properties: {
          old_path: {
            type: "string",
            description: "Current path of the file, relative to the vault root",
          },
          new_path: {
            type: "string",
            description: "New path for the file, relative to the vault root",
          },
        },
        required: ["old_path", "new_path"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        const oldPath = input.old_path as string;
        const newPath = input.new_path as string;

        const absoluteOldPath = await resolveVaultPath(oldPath, vaultDir);
        if (!absoluteOldPath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: old_path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        const absoluteNewPath = await resolveVaultPath(newPath, vaultDir);
        if (!absoluteNewPath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: new_path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        try {
          if (!(await Bun.file(absoluteOldPath).exists())) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: source file not found: ${oldPath}`,
                },
              ],
              isError: true,
            };
          }

          if (await Bun.file(absoluteNewPath).exists()) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: destination already exists: ${newPath}`,
                },
              ],
              isError: true,
            };
          }

          await mkdir(dirname(absoluteNewPath), { recursive: true });
          await rename(absoluteOldPath, absoluteNewPath);
          invalidateFileIndex();
          return {
            content: [
              { type: "text", text: `Renamed: ${oldPath} → ${newPath}` },
            ],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error renaming file: ${err}` }],
            isError: true,
          };
        }
      },
    },

    {
      name: "delete_file",
      description:
        "Delete a file from the student's notes vault. Requires explicit confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file, relative to the vault root",
          },
          confirm: {
            type: "boolean",
            description: "Must be true to confirm deletion",
          },
        },
        required: ["path", "confirm"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        const inputPath = input.path as string;

        if (input.confirm !== true) {
          return {
            content: [
              {
                type: "text",
                text: "Error: confirm must be true to delete a file.",
              },
            ],
            isError: true,
          };
        }

        const absolutePath = await resolveVaultPath(inputPath, vaultDir);
        if (!absolutePath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        try {
          if (!(await Bun.file(absolutePath).exists())) {
            return {
              content: [
                { type: "text", text: `Error: file not found: ${inputPath}` },
              ],
              isError: true,
            };
          }

          await unlink(absolutePath);
          invalidateFileIndex();
          return {
            content: [{ type: "text", text: `Deleted: ${inputPath}` }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error deleting file: ${err}` }],
            isError: true,
          };
        }
      },
    },

    // --- Canvas tools ---

    {
      name: "read_canvas",
      description:
        "Capture a PNG snapshot of a canvas page from the student's iPad. Returns the image for visual analysis of handwritten work. This captures a specific frame (page), not the user's current viewport.",
      inputSchema: {
        type: "object",
        properties: {
          page: {
            type: "string",
            description:
              "Page name to snapshot (e.g., 'Page 1'). Omit to capture the first page.",
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const broker = config.getBroker();
        if (!broker) {
          return {
            content: [
              {
                type: "text",
                text: "No canvas is open. Ask the student to open a canvas with /canvas.",
              },
            ],
            isError: true,
          };
        }
        try {
          const response = await broker.requestSnapshot(
            input.page as string | undefined,
          );

          // Handle special cases
          if (response.page === "NO_FRAMES") {
            return {
              content: [
                {
                  type: "text",
                  text: "The canvas has no pages (frames). The student may have deleted all frames. Ask them to create content on the canvas or use the canvas normally - frames will be auto-created when they start drawing.",
                },
              ],
              isError: true,
            };
          }

          if (response.page === "ERROR") {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: Unable to find the requested page on the canvas.",
                },
              ],
              isError: true,
            };
          }

          // Empty PNG means the page exists but has no content
          if (!response.png) {
            return {
              content: [
                {
                  type: "text",
                  text: `Page "${response.page}" exists but is currently blank (no content to display).`,
                },
              ],
              isError: false,
            };
          }

          return {
            content: [
              { type: "image", data: response.png, mimeType: "image/png" },
              { type: "text", text: `Snapshot of page: ${response.page}` },
            ],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error capturing canvas: ${err}` }],
            isError: true,
          };
        }
      },
    },

    {
      name: "export_pdf",
      description:
        "Export all canvas pages as an A4 PDF file. Returns the file path. Only exports pages with content (blank trailing pages are excluded).",
      inputSchema: {
        type: "object",
        properties: {
          output_path: {
            type: "string",
            description:
              "Output file path for the PDF (defaults to <export-dir>/clark-export.pdf)",
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      handler: async (input) => {
        const broker = config.getBroker();
        if (!broker) {
          return {
            content: [
              {
                type: "text",
                text: "No canvas is open. Ask the student to open a canvas with /canvas.",
              },
            ],
            isError: true,
          };
        }
        const outputPath =
          (input.output_path as string) ??
          join(currentExportDir(), "clark-export.pdf");
        try {
          const response = await broker.requestExport();

          // Handle case where canvas has no frames
          if (response.pages.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "The canvas has no pages to export. The student may have deleted all frames or the canvas is empty. Ask them to create content on the canvas first.",
                },
              ],
              isError: true,
            };
          }

          const path = await exportPDFToFile(response.pages, outputPath);
          const pageCount = response.pages.length;
          return {
            content: [
              {
                type: "text",
                text: `PDF exported to: ${path} (${pageCount} page${pageCount === 1 ? "" : "s"})`,
              },
            ],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error exporting PDF: ${err}` }],
            isError: true,
          };
        }
      },
    },

    {
      name: "save_canvas",
      description: "Persist current canvas state to disk.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async () => {
        const saveCanvas = config.getSaveCanvas();
        if (!saveCanvas) {
          return {
            content: [
              {
                type: "text",
                text: "No canvas is open. Use /canvas to open one first.",
              },
            ],
            isError: true,
          };
        }
        try {
          await saveCanvas();
          return {
            content: [{ type: "text", text: "Canvas state saved." }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error saving canvas: ${err}` }],
            isError: true,
          };
        }
      },
    },

    {
      name: "search_by_tag",
      description:
        "Search notes by Obsidian-style tags (e.g., #class, #paper, #class/cs101). Supports nested tags with slash notation. Returns files containing the specified tag with context snippets.",
      inputSchema: {
        type: "object",
        properties: {
          tag: {
            type: "string",
            description:
              "Tag to search for (with or without # prefix, e.g., 'class' or '#class'). Supports nested tags like 'class/cs101'.",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return (default: 10)",
          },
        },
        required: ["tag"],
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        let tag = (input.tag as string).trim();

        // Normalize tag: remove leading # if present
        if (tag.startsWith("#")) {
          tag = tag.slice(1);
        }

        if (!tag) {
          return {
            content: [{ type: "text", text: "Error: tag cannot be empty." }],
            isError: true,
          };
        }

        const maxResults = (input.max_results as number) ?? 10;

        try {
          const results = await searchByTag(vaultDir, tag, maxResults);

          if (results.length === 0) {
            return {
              content: [
                { type: "text", text: `No files found with tag #${tag}` },
              ],
              isError: false,
            };
          }

          const formatted = results.map((r) => {
            const snippetText =
              r.snippets.length > 0
                ? `\n\nContext snippets:\n${r.snippets.map((s) => `  ${s}`).join("\n")}`
                : "";
            return wrapFileContent(
              r.path,
              `Found tag #${tag} (${r.matchCount} occurrence${r.matchCount > 1 ? "s" : ""})${snippetText}`,
            );
          });

          const summary = `Found ${results.length} file${results.length > 1 ? "s" : ""} with tag #${tag}:\n\n`;
          return {
            content: [{ type: "text", text: summary + formatted.join("\n\n") }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [
              { type: "text", text: `Error searching for tag: ${err}` },
            ],
            isError: true,
          };
        }
      },
    },

    // --- OCR tools ---

    {
      name: "transcribe_pdf",
      description:
        "OCR a scanned or image-based PDF using vision AI. Renders PDF pages to images via poppler and transcribes each page to markdown. Use this when read_file shows a PDF has little extractable text (likely scanned or handwritten). Returns the transcribed markdown content and saves it to the specified output path.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the PDF file, relative to the vault root",
          },
          page_range: {
            type: "string",
            description:
              "Optional page range to transcribe (e.g., '1-5' or '3'). Omit to transcribe all pages.",
          },
          output_path: {
            type: "string",
            description:
              "Path for the output markdown file, relative to the vault root. Choose based on vault structure and CLARK.md conventions.",
          },
          consolidate: {
            type: "boolean",
            description:
              "If true, consolidate and deduplicate content across pages (useful for slide decks with repeated headers/footers). Default: false.",
          },
        },
        required: ["path", "output_path"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      handler: async (input) => {
        const vaultDir = currentVaultDir();
        const inputPath = input.path as string;
        const outputPath = input.output_path as string;
        const pageRangeStr = input.page_range as string | undefined;
        const consolidate = input.consolidate as boolean | undefined;
        const progress = config.onProgress;

        // Resolve and validate paths
        const absolutePdfPath = await resolveVaultPath(inputPath, vaultDir);
        if (!absolutePdfPath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: PDF path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        const absoluteOutputPath = await resolveVaultPath(outputPath, vaultDir);
        if (!absoluteOutputPath) {
          return {
            content: [
              {
                type: "text",
                text: "Error: output path is outside the vault directory.",
              },
            ],
            isError: true,
          };
        }

        if (!isPDFFile(absolutePdfPath)) {
          return {
            content: [
              { type: "text", text: "Error: the specified file is not a PDF." },
            ],
            isError: true,
          };
        }

        try {
          if (!(await Bun.file(absolutePdfPath).exists())) {
            return {
              content: [
                { type: "text", text: `Error: file not found: ${inputPath}` },
              ],
              isError: true,
            };
          }
        } catch {
          return {
            content: [
              { type: "text", text: `Error: cannot access file: ${inputPath}` },
            ],
            isError: true,
          };
        }

        // Parse page range
        let pageRange: { start: number; end: number } | undefined;
        if (pageRangeStr) {
          const match = pageRangeStr.match(/^(\d+)(?:-(\d+))?$/);
          if (!match) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: invalid page range "${pageRangeStr}". Use format like "1-5" or "3".`,
                },
              ],
              isError: true,
            };
          }
          const start = parseInt(match[1]!, 10);
          const end = match[2] ? parseInt(match[2], 10) : start;
          pageRange = { start, end };
        }

        try {
          progress?.(`Transcribing PDF pages from ${inputPath}...`);
          const ocrProvider = config.getOCRProvider?.() ?? null;
          const result = await transcribePDF({
            pdfPath: absolutePdfPath,
            ocrProvider,
            sourcePath: inputPath,
            pageRange,
            consolidate,
            onProgress: (event) => {
              if (event.phase === "render") {
                progress?.(
                  `Rendered page ${event.pageNumber} (${event.completed}/${event.total})`,
                );
                return;
              }
              progress?.(
                `Transcribing page ${event.pageNumber} (${event.completed}/${event.total})...`,
              );
            },
          });

          // Write output file
          await mkdir(dirname(absoluteOutputPath), { recursive: true });
          await Bun.write(absoluteOutputPath, result.markdown);
          invalidateFileIndex();

          progress?.(
            `Transcription complete: ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} (${result.method}).`,
          );

          return {
            content: [
              {
                type: "text",
                text: `Transcription saved to ${outputPath} (${result.pageCount} page${result.pageCount === 1 ? "" : "s"}, method: ${result.method}).`,
              },
            ],
            isError: false,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error: ${msg}` }],
            isError: true,
          };
        }
      },
    },
  ];

  // Web search: local DuckDuckGo scraper for Ollama, lightweight stub for cloud providers
  if (config.useLocalWebSearch) {
    tools.push({
      name: "websearch",
      description:
        "Search the web using DuckDuckGo. Returns titles, URLs, and snippets from search results. Use this when local notes don't contain the information needed.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to send to DuckDuckGo",
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of results to return (default: 5, max: 10)",
          },
        },
        required: ["query"],
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async (input) => {
        const query = (input.query as string).trim();

        if (!query) {
          return {
            content: [
              { type: "text", text: "Error: search query cannot be empty." },
            ],
            isError: true,
          };
        }

        const maxResults = Math.min((input.max_results as number) ?? 5, 10);

        try {
          const results = await performWebSearch(query, maxResults);

          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No web results found for query: "${query}"`,
                },
              ],
              isError: false,
            };
          }

          const formatted = results
            .map(
              (r, i) =>
                `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}`,
            )
            .join("\n\n");

          const summary = `Found ${results.length} web result${results.length > 1 ? "s" : ""} for "${query}":\n\n`;
          return {
            content: [{ type: "text", text: summary + formatted }],
            isError: false,
          };
        } catch (err) {
          return {
            content: [
              { type: "text", text: `Error performing web search: ${err}` },
            ],
            isError: true,
          };
        }
      },
    });
  } else {
    // Cloud provider stub — the tool definition is sent to the cloud proxy which
    // replaces it with native provider search. The handler is never called locally.
    tools.push({
      name: "websearch",
      description:
        "Search the web for current information. Use this when local notes don't contain the information needed.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
      handler: async () => ({
        content: [{ type: "text" as const, text: "Web search is handled by the cloud proxy." }],
        isError: true,
      }),
    });
  }

  return tools.map((tool) => withToolDebugLogging(tool));
}

function withToolDebugLogging(tool: ToolDefinition): ToolDefinition {
  const originalHandler = tool.handler;
  return {
    ...tool,
    handler: async (input) => {
      const startedAt = Date.now();
      await appendDebugLog("tool_call_start", [
        `tool=${tool.name}`,
        `input=${stringifyForDebug(input)}`,
      ]);
      try {
        const result = await originalHandler(input);
        await appendDebugLog("tool_call_end", [
          `tool=${tool.name}`,
          `duration_ms=${Date.now() - startedAt}`,
          `is_error=${result.isError === true}`,
          `result=${stringifyForDebug(result)}`,
        ]);
        return result;
      } catch (err) {
        await appendDebugLog("tool_call_throw", [
          `tool=${tool.name}`,
          `duration_ms=${Date.now() - startedAt}`,
          `error=${err instanceof Error ? err.message : String(err)}`,
        ]);
        throw err;
      }
    },
  };
}

async function appendDebugLog(event: string, lines: string[]): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = `\n[${timestamp}] ${event}\n${lines.join("\n")}\n`;
  try {
    await mkdir(dirname(DEBUG_LOG_PATH), { recursive: true });
    await appendFile(DEBUG_LOG_PATH, entry, "utf8");
  } catch {
    // Never fail tool calls due to debug logging.
  }
}

function stringifyForDebug(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (_key, raw) => {
      if (typeof raw === "object" && raw !== null) {
        if (seen.has(raw)) return "[circular]";
        seen.add(raw);
      }
      if (typeof raw === "string") {
        if (_key === "data" && raw.length > 256) {
          return `[omitted base64 data: ${raw.length} chars]`;
        }
        if (raw.length > DEBUG_LOG_MAX_STRING_CHARS) {
          return `${raw.slice(0, DEBUG_LOG_MAX_STRING_CHARS)}...[truncated ${raw.length - DEBUG_LOG_MAX_STRING_CHARS} chars]`;
        }
      }
      return raw;
    });
    return text ?? String(value);
  } catch {
    return String(value);
  }
}

// --- Search helpers ---

interface SearchResult {
  path: string;
  snippets: string[];
  matchCount: number;
}

function wrapFileContent(path: string, content: string): string {
  return `<file_content path="${path}">\n${content}\n</file_content>`;
}

async function searchFile(
  dirPath: string,
  entry: string,
  query: string,
): Promise<SearchResult | null> {
  const fullPath = join(dirPath, entry);
  try {
    const content = await Bun.file(fullPath).text();
    const lines = content.split("\n");
    const matchingLines: string[] = [];
    let matchCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(query)) {
        matchCount++;
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 1);
        const snippet = lines.slice(start, end + 1).join("\n");
        matchingLines.push(snippet);
      }
    }

    if (matchingLines.length > 0) {
      return {
        path: relative(dirPath, fullPath),
        snippets: matchingLines.slice(0, 3),
        matchCount,
      };
    }
  } catch {
    // Skip unreadable files (directories, binary, etc.)
  }
  return null;
}

/** In-flight indexing promise — prevents concurrent runs and allows callers to await. */
let activeIndexingPromise: Promise<void> | null = null;

/**
 * Trigger background indexing of stale files.
 * Deduplicates: if indexing is already running, returns the existing promise.
 * The returned promise resolves when indexing completes (or fails silently).
 */
function triggerBackgroundIndexing(
  vaultDir: string,
  index: EmbeddingIndex,
  provider: EmbeddingProvider,
): Promise<void> {
  if (activeIndexingPromise) return activeIndexingPromise;

  const indexer = new SearchIndexer(index, provider);
  activeIndexingPromise = indexer.indexStaleFiles(vaultDir)
    .catch(() => {
      // Best-effort — silently ignore indexing errors
    })
    .finally(() => {
      activeIndexingPromise = null;
    });

  return activeIndexingPromise;
}

/** Opportunistically re-index a single file after a write operation. */
function queueFileReindex(relativePath: string, toolsConfig: ToolsConfig): void {
  const provider = toolsConfig.getEmbeddingProvider?.() ?? null;
  const index = toolsConfig.getSearchIndex?.() ?? null;
  if (!provider || !index) return;

  const vaultDir = toolsConfig.getVaultDir?.() ?? toolsConfig.vaultDir;
  if (!vaultDir) return;

  const indexer = new SearchIndexer(index, provider);
  indexer.indexFile(vaultDir, relativePath).catch(() => {
    // Best-effort — silently ignore indexing errors
  });
}

async function searchDirectory(
  dirPath: string,
  query: string,
): Promise<SearchResult[]> {
  const entries = await readdir(dirPath, { recursive: true });
  const candidates = entries.filter((e) => {
    const ext = extname(e).toLowerCase();
    return ext === ".md" || ext === ".txt";
  });

  const BATCH_SIZE = 20;
  const results: SearchResult[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((entry) => searchFile(dirPath, entry, query)),
    );
    results.push(...batchResults.filter((r): r is SearchResult => r !== null));
  }

  return results;
}

// --- Tag search helpers ---

/**
 * Extract all tags from markdown content.
 * Tags match #word or #word/nested/path format.
 * Returns normalized tags (lowercase, without # prefix).
 */
function extractTags(content: string): string[] {
  // Match #tag or #tag/nested/path
  // Must be preceded by whitespace or start of line
  // Must be followed by whitespace, punctuation, or end of line
  const tagRegex = /(?:^|[\s])#([a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)/g;
  const tags = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(content)) !== null) {
    if (match[1]) {
      // Normalize to lowercase for case-insensitive matching
      tags.add(match[1].toLowerCase());
    }
  }

  return Array.from(tags);
}

/**
 * Check if a tag matches the search query (supports nested tags).
 * For example, searching for "class" matches both "#class" and "#class/cs101".
 */
function tagMatches(tag: string, query: string): boolean {
  const normalizedTag = tag.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  // Exact match
  if (normalizedTag === normalizedQuery) {
    return true;
  }

  // Nested tag match: query "class" matches "class/cs101"
  if (normalizedTag.startsWith(normalizedQuery + "/")) {
    return true;
  }

  return false;
}

/**
 * Search for files containing a specific tag.
 */
async function searchByTag(
  dirPath: string,
  tag: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const entries = await readdir(dirPath, { recursive: true });
  const candidates = entries.filter((e) => {
    const ext = extname(e).toLowerCase();
    return ext === ".md" || ext === ".txt";
  });

  const BATCH_SIZE = 20;
  const results: SearchResult[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((entry) => searchFileForTag(dirPath, entry, tag)),
    );
    results.push(...batchResults.filter((r): r is SearchResult => r !== null));

    if (results.length >= maxResults) {
      break;
    }
  }

  return results.slice(0, maxResults);
}

async function searchFileForTag(
  dirPath: string,
  entry: string,
  queryTag: string,
): Promise<SearchResult | null> {
  const fullPath = join(dirPath, entry);
  try {
    const content = await Bun.file(fullPath).text();
    const tags = extractTags(content);

    // Find matching tags
    const matchingTags = tags.filter((t) => tagMatches(t, queryTag));

    if (matchingTags.length === 0) {
      return null;
    }

    // Extract snippets around tag occurrences
    const lines = content.split("\n");
    const snippets: string[] = [];
    let matchCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineTags = extractTags(lines[i]!);
      const hasMatch = lineTags.some((t) => tagMatches(t, queryTag));

      if (hasMatch) {
        matchCount++;
        if (snippets.length < 3) {
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length - 1, i + 1);
          const snippet = lines
            .slice(start, end + 1)
            .join("\n")
            .trim();
          snippets.push(snippet);
        }
      }
    }

    return {
      path: relative(dirPath, fullPath),
      snippets,
      matchCount,
    };
  } catch {
    // Skip unreadable files
  }
  return null;
}

// --- Web search helpers ---

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface CacheEntry {
  results: WebSearchResult[];
  timestamp: number;
}

// Simple in-memory cache with 5-minute TTL
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Rate limiting: max 10 requests per minute
const rateLimitQueue: number[] = [];
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;
const DDG_SEARCH_ENDPOINTS = [
  "https://html.duckduckgo.com/html/?q=",
  "https://lite.duckduckgo.com/lite/?q=",
];
const DEBUG_LOG_PATH = join(homedir(), ".clark", "debug.txt");
const DEBUG_LOG_MAX_STRING_CHARS = 8_000;
const WEBSEARCH_DEBUG_HTML_MAX_CHARS = 200_000;

/**
 * Check rate limit and wait if necessary.
 */
async function checkRateLimit(): Promise<void> {
  const now = Date.now();

  // Remove old timestamps outside the window
  while (
    rateLimitQueue.length > 0 &&
    rateLimitQueue[0]! < now - RATE_LIMIT_WINDOW_MS
  ) {
    rateLimitQueue.shift();
  }

  // If we've hit the limit, wait until the oldest request expires
  if (rateLimitQueue.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestRequest = rateLimitQueue[0]!;
    const waitTime = oldestRequest + RATE_LIMIT_WINDOW_MS - now;
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    // After waiting, remove the expired request
    rateLimitQueue.shift();
  }

  // Record this request
  rateLimitQueue.push(now);
}

/**
 * Perform a web search using DuckDuckGo HTML scraping.
 */
async function performWebSearch(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  // Check cache first
  const cacheKey = `${query}:${maxResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.results;
  }

  // Apply rate limiting
  await checkRateLimit();

  const errors: string[] = [];

  for (const endpoint of DDG_SEARCH_ENDPOINTS) {
    const searchUrl = `${endpoint}${encodeURIComponent(query)}`;

    try {
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        errors.push(`${searchUrl} returned status ${response.status}`);
        await appendDebugLog("websearch_attempt", [
          `query=${query}`,
          `endpoint=${searchUrl}`,
          `status=${response.status}`,
          "result=http_error",
        ]);
        continue;
      }

      const html = await response.text();

      // Detect CAPTCHA/anomaly detection
      if (html.includes("anomaly-modal") || html.includes("challenge-form")) {
        errors.push(`${searchUrl} returned CAPTCHA challenge`);
        await appendDebugLog("websearch_attempt", [
          `query=${query}`,
          `endpoint=${searchUrl}`,
          `status=${response.status}`,
          "result=captcha",
          "raw_html_begin",
          truncateForDebugLog(html),
          "raw_html_end",
        ]);
        continue;
      }

      const results = parseDuckDuckGoResults(html, maxResults);
      await appendDebugLog("websearch_attempt", [
        `query=${query}`,
        `endpoint=${searchUrl}`,
        `status=${response.status}`,
        `parsed_results=${results.length}`,
        "raw_html_begin",
        truncateForDebugLog(html),
        "raw_html_end",
      ]);
      if (results.length > 0) {
        // Cache successful results
        searchCache.set(cacheKey, {
          results,
          timestamp: Date.now(),
        });
        return results;
      }
    } catch (err) {
      errors.push(
        `${searchUrl} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await appendDebugLog("websearch_attempt", [
        `query=${query}`,
        `endpoint=${searchUrl}`,
        `result=exception`,
        `error=${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
  }

  if (errors.length === DDG_SEARCH_ENDPOINTS.length) {
    throw new Error(`Web search failed: ${errors.join(" | ")}`);
  }

  return [];
}

/**
 * Parse DuckDuckGo HTML results.
 * Simple regex-based extraction (no DOM parser needed).
 */
function parseDuckDuckGoResults(
  html: string,
  maxResults: number,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const resultBlocks = [
    ...html.matchAll(
      /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ),
    ...html.matchAll(/<tr[\s\S]*?<\/tr>/gi),
  ]
    .map((match) => match[0])
    .filter((block) => /result__a|result-link/i.test(block));

  for (const resultHtml of resultBlocks) {
    if (results.length >= maxResults) break;

    const titleMatch = resultHtml.match(
      /<a[^>]*class="[^"]*(?:result__a|result-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) continue;

    const rawHref = titleMatch[1] || "";
    const url = normalizeDuckDuckGoUrl(rawHref);
    const title = stripHtmlTags(titleMatch[2] || "").trim();
    const snippetMatch = resultHtml.match(
      /<(?:a|div|span|td)[^>]*class="[^"]*(?:result__snippet|result-snippet|snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/i,
    );
    const snippet = stripHtmlTags(snippetMatch?.[1] || "").trim();

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function normalizeDuckDuckGoUrl(rawHref: string): string {
  const decodedHtmlHref = stripHtmlTags(rawHref).replace(/&amp;/g, "&").trim();
  if (!decodedHtmlHref) return "";

  const href = decodedHtmlHref.startsWith("//")
    ? `https:${decodedHtmlHref}`
    : decodedHtmlHref;

  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const isDuckDuckGoRedirect =
      (parsed.hostname === "duckduckgo.com" ||
        parsed.hostname === "www.duckduckgo.com") &&
      parsed.pathname.startsWith("/l/");
    if (isDuckDuckGoRedirect) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return safeDecodeURIComponent(uddg);
    }
    return safeDecodeURIComponent(parsed.toString());
  } catch {
    return safeDecodeURIComponent(href);
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function truncateForDebugLog(value: string): string {
  if (value.length <= WEBSEARCH_DEBUG_HTML_MAX_CHARS) return value;
  return `${value.slice(0, WEBSEARCH_DEBUG_HTML_MAX_CHARS)}\n[truncated ${value.length - WEBSEARCH_DEBUG_HTML_MAX_CHARS} chars]`;
}

/**
 * Simple HTML tag stripper.
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "") // Remove tags
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " "); // Normalize whitespace
}
