/**
 * MCP tool definitions and handlers.
 *
 * Each tool is defined with its schema and handler function.
 * File tools are scoped to the vault directory. Canvas tools delegate to the CanvasBroker.
 */

import { readdir, mkdir, rename, unlink } from "node:fs/promises";
import { join, extname, dirname, relative } from "node:path";
import type { CanvasBroker } from "../canvas/server.ts";
import { exportPDFToFile } from "../canvas/pdf-export.ts";
import { extractPDFText, getPDFInfo } from "./pdf.ts";
import type { ToolInputSchema } from "../llm/provider.ts";
import type { OCRProvider } from "../ocr/provider.ts";
import { checkPopplerAvailable, getPopplerInstallInstructions, renderPDFPages } from "../ocr/pdf-renderer.ts";
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
}

/**
 * Create all tool definitions with their handlers wired to the given config.
 */
export function createTools(config: ToolsConfig): ToolDefinition[] {
  const currentVaultDir = () => config.getVaultDir?.() ?? config.vaultDir ?? ".";
  const currentExportDir = () => config.getExportDir?.() ?? process.cwd();

  return [
    // --- File tools (vault-scoped) ---

    {
      name: "read_file",
      description:
        "Read a file from the student's notes vault. Markdown files return text content with a list of resolved wikilinks. PDFs return extracted text. Images return the image for visual analysis.",
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
            content: [{ type: "text", text: "Error: path is outside the vault directory." }],
            isError: true,
          };
        }

        try {
          if (isImageFile(absolutePath)) {
            const buffer = await Bun.file(absolutePath).arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            return {
              content: [
                { type: "image", data: base64, mimeType: imageMimeType(absolutePath) },
                { type: "text", text: `Image: ${inputPath}` },
              ],
            };
          }

          if (isPDFFile(absolutePath)) {
            const text = await extractPDFText(absolutePath);
            const info = await getPDFInfo(absolutePath);
            const avgCharsPerPage = text.length / Math.max(info.pages, 1);
            let content = wrapFileContent(inputPath, text);
            if (avgCharsPerPage < 50) {
              content += `\n\n[Note: This PDF has very little extractable text (~${Math.round(avgCharsPerPage)} chars/page across ${info.pages} page${info.pages === 1 ? "" : "s"}). It may be scanned or image-based. Use transcribe_pdf to OCR it if you need the full content.]`;
            }
            return { content: [{ type: "text", text: content }] };
          }

          // Markdown / text file
          const text = await Bun.file(absolutePath).text();
          const links = extractWikilinks(text);
          const footer = await buildLinkFooter(links, vaultDir);
          return { content: [{ type: "text", text: wrapFileContent(inputPath, text + footer) }] };
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
        "Keyword search across markdown and text files in the notes vault. Returns matching file paths and text snippets ranked by match density.",
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
        const query = (input.query as string).toLowerCase();
        const results = await searchDirectory(vaultDir, query);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No results found for "${query}"` }] };
        }

        const text = results
          .sort((a, b) => b.matchCount - a.matchCount)
          .slice(0, 10)
          .map((r) => `### ${r.path} (${r.matchCount} matches)\n${wrapFileContent(r.path, r.snippets.join("\n...\n"))}`)
          .join("\n\n---\n\n");

        return { content: [{ type: "text", text }] };
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
            description: "Subdirectory path relative to the vault root (omit for vault root)",
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
            content: [{ type: "text", text: "Error: path is outside the vault directory." }],
            isError: true,
          };
        }

        const ext = input.extension as string | undefined;

        try {
          const entries = await readdir(absolutePath, { recursive: true });
          const filtered = ext ? entries.filter((e) => e.endsWith(ext)) : entries;

          return {
            content: [{ type: "text", text: filtered.join("\n") || "(empty directory)" }],
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error listing directory: ${err}` }],
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
            content: [{ type: "text", text: "Error: path is outside the vault directory." }],
            isError: true,
          };
        }

        try {
          const file = Bun.file(absolutePath);
          if (await file.exists()) {
            return {
              content: [{ type: "text", text: "Error: file already exists. Use edit_file to modify existing files." }],
              isError: true,
            };
          }

          // Ensure parent directory exists
          await mkdir(dirname(absolutePath), { recursive: true });
          await Bun.write(absolutePath, input.content as string);
          invalidateFileIndex();
          return { content: [{ type: "text", text: `Created: ${inputPath}` }] };
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
            content: [{ type: "text", text: "Error: path is outside the vault directory." }],
            isError: true,
          };
        }

        const oldText = input.old_text as string;
        const newText = input.new_text as string;

        try {
          const content = await Bun.file(absolutePath).text();

          if (!content.includes(oldText)) {
            return {
              content: [{ type: "text", text: "Error: old_text not found in file." }],
              isError: true,
            };
          }

          const updated = content.replace(oldText, newText);
          await Bun.write(absolutePath, updated);
          return { content: [{ type: "text", text: `Updated: ${inputPath}` }] };
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
      description:
        "Rename or move a file within the student's notes vault.",
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
            content: [{ type: "text", text: "Error: old_path is outside the vault directory." }],
            isError: true,
          };
        }

        const absoluteNewPath = await resolveVaultPath(newPath, vaultDir);
        if (!absoluteNewPath) {
          return {
            content: [{ type: "text", text: "Error: new_path is outside the vault directory." }],
            isError: true,
          };
        }

        try {
          if (!(await Bun.file(absoluteOldPath).exists())) {
            return {
              content: [{ type: "text", text: `Error: source file not found: ${oldPath}` }],
              isError: true,
            };
          }

          if (await Bun.file(absoluteNewPath).exists()) {
            return {
              content: [{ type: "text", text: `Error: destination already exists: ${newPath}` }],
              isError: true,
            };
          }

          await mkdir(dirname(absoluteNewPath), { recursive: true });
          await rename(absoluteOldPath, absoluteNewPath);
          invalidateFileIndex();
          return { content: [{ type: "text", text: `Renamed: ${oldPath} → ${newPath}` }] };
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
            content: [{ type: "text", text: "Error: confirm must be true to delete a file." }],
            isError: true,
          };
        }

        const absolutePath = await resolveVaultPath(inputPath, vaultDir);
        if (!absolutePath) {
          return {
            content: [{ type: "text", text: "Error: path is outside the vault directory." }],
            isError: true,
          };
        }

        try {
          if (!(await Bun.file(absolutePath).exists())) {
            return {
              content: [{ type: "text", text: `Error: file not found: ${inputPath}` }],
              isError: true,
            };
          }

          await unlink(absolutePath);
          invalidateFileIndex();
          return { content: [{ type: "text", text: `Deleted: ${inputPath}` }] };
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
            description: "Page name to snapshot (e.g., 'Page 1'). Omit to capture the first page.",
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
            content: [{ type: "text", text: "No canvas is open. Ask the student to open a canvas with /canvas." }],
            isError: true,
          };
        }
        try {
          const response = await broker.requestSnapshot(input.page as string | undefined);

          // Handle special cases
          if (response.page === "NO_FRAMES") {
            return {
              content: [{
                type: "text",
                text: "The canvas has no pages (frames). The student may have deleted all frames. Ask them to create content on the canvas or use the canvas normally - frames will be auto-created when they start drawing.",
              }],
              isError: true,
            };
          }

          if (response.page === "ERROR") {
            return {
              content: [{ type: "text", text: "Error: Unable to find the requested page on the canvas." }],
              isError: true,
            };
          }

          // Empty PNG means the page exists but has no content
          if (!response.png) {
            return {
              content: [{
                type: "text",
                text: `Page "${response.page}" exists but is currently blank (no content to display).`,
              }],
            };
          }

          return {
            content: [
              { type: "image", data: response.png, mimeType: "image/png" },
              { type: "text", text: `Snapshot of page: ${response.page}` },
            ],
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
              description: "Output file path for the PDF (defaults to <export-dir>/clark-export.pdf)",
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
            content: [{ type: "text", text: "No canvas is open. Ask the student to open a canvas with /canvas." }],
            isError: true,
          };
        }
        const outputPath = (input.output_path as string) ?? join(currentExportDir(), "clark-export.pdf");
        try {
          const response = await broker.requestExport();

          // Handle case where canvas has no frames
          if (response.pages.length === 0) {
            return {
              content: [{
                type: "text",
                text: "The canvas has no pages to export. The student may have deleted all frames or the canvas is empty. Ask them to create content on the canvas first.",
              }],
              isError: true,
            };
          }

          const path = await exportPDFToFile(response.pages, outputPath);
          const pageCount = response.pages.length;
          return {
            content: [{ type: "text", text: `PDF exported to: ${path} (${pageCount} page${pageCount === 1 ? "" : "s"})` }],
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
            content: [{ type: "text", text: "No canvas is open. Use /canvas to open one first." }],
            isError: true,
          };
        }
        try {
          await saveCanvas();
          return {
            content: [{ type: "text", text: "Canvas state saved." }],
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
            description: "Tag to search for (with or without # prefix, e.g., 'class' or '#class'). Supports nested tags like 'class/cs101'.",
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
              content: [{ type: "text", text: `No files found with tag #${tag}` }],
            };
          }

          const formatted = results.map((r) => {
            const snippetText = r.snippets.length > 0
              ? `\n\nContext snippets:\n${r.snippets.map(s => `  ${s}`).join('\n')}`
              : '';
            return wrapFileContent(r.path, `Found tag #${tag} (${r.matchCount} occurrence${r.matchCount > 1 ? 's' : ''})${snippetText}`);
          });

          const summary = `Found ${results.length} file${results.length > 1 ? 's' : ''} with tag #${tag}:\n\n`;
          return {
            content: [{ type: "text", text: summary + formatted.join("\n\n") }],
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error searching for tag: ${err}` }],
            isError: true,
          };
        }
      },
    },

    {
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
            description: "Maximum number of results to return (default: 5, max: 10)",
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
            content: [{ type: "text", text: "Error: search query cannot be empty." }],
            isError: true,
          };
        }

        const maxResults = Math.min((input.max_results as number) ?? 5, 10);

        try {
          const results = await performWebSearch(query, maxResults);

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: `No web results found for query: "${query}"` }],
            };
          }

          const formatted = results.map((r, i) =>
            `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}`
          ).join('\n\n');

          const summary = `Found ${results.length} web result${results.length > 1 ? 's' : ''} for "${query}":\n\n`;
          return {
            content: [{ type: "text", text: summary + formatted }],
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error performing web search: ${err}` }],
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
            description: "Optional page range to transcribe (e.g., '1-5' or '3'). Omit to transcribe all pages.",
          },
          output_path: {
            type: "string",
            description: "Path for the output markdown file, relative to the vault root. Choose based on vault structure and CLARK.md conventions.",
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
        const progress = config.onProgress;

        // Resolve and validate paths
        const absolutePdfPath = await resolveVaultPath(inputPath, vaultDir);
        if (!absolutePdfPath) {
          return {
            content: [{ type: "text", text: "Error: PDF path is outside the vault directory." }],
            isError: true,
          };
        }

        const absoluteOutputPath = await resolveVaultPath(outputPath, vaultDir);
        if (!absoluteOutputPath) {
          return {
            content: [{ type: "text", text: "Error: output path is outside the vault directory." }],
            isError: true,
          };
        }

        if (!isPDFFile(absolutePdfPath)) {
          return {
            content: [{ type: "text", text: "Error: the specified file is not a PDF." }],
            isError: true,
          };
        }

        try {
          if (!(await Bun.file(absolutePdfPath).exists())) {
            return {
              content: [{ type: "text", text: `Error: file not found: ${inputPath}` }],
              isError: true,
            };
          }
        } catch {
          return {
            content: [{ type: "text", text: `Error: cannot access file: ${inputPath}` }],
            isError: true,
          };
        }

        // Check poppler
        const hasPop = await checkPopplerAvailable();
        if (!hasPop) {
          return {
            content: [{
              type: "text",
              text: `Error: pdftoppm (poppler) is not installed. PDF OCR requires poppler to render pages to images.\n${getPopplerInstallInstructions()}`,
            }],
            isError: true,
          };
        }

        // Check OCR provider
        const ocrProvider = config.getOCRProvider?.();
        if (!ocrProvider) {
          return {
            content: [{
              type: "text",
              text: "Error: No OCR provider available. The current LLM provider may not support vision. Switch to a vision-capable provider (Anthropic, OpenAI, or Gemini) to use OCR.",
            }],
            isError: true,
          };
        }

        // Parse page range
        let pageRange: { start: number; end: number } | undefined;
        if (pageRangeStr) {
          const match = pageRangeStr.match(/^(\d+)(?:-(\d+))?$/);
          if (!match) {
            return {
              content: [{ type: "text", text: `Error: invalid page range "${pageRangeStr}". Use format like "1-5" or "3".` }],
              isError: true,
            };
          }
          const start = parseInt(match[1]!, 10);
          const end = match[2] ? parseInt(match[2], 10) : start;
          pageRange = { start, end };
        }

        try {
          // Render PDF pages to images
          progress?.(`Rendering PDF pages from ${inputPath}...`);
          const renderedPages = await renderPDFPages(absolutePdfPath, { pageRange }, (page, total) => {
            progress?.(`Rendered page ${page}/${total}`);
          });

          if (renderedPages.length === 0) {
            return {
              content: [{ type: "text", text: "Error: no pages were rendered from the PDF." }],
              isError: true,
            };
          }

          // OCR each page
          const pageTexts: string[] = [];
          for (let i = 0; i < renderedPages.length; i++) {
            const page = renderedPages[i]!;
            progress?.(`Transcribing page ${page.pageNumber} (${i + 1}/${renderedPages.length})...`);
            const text = await ocrProvider.transcribeImage(page.imageBuffer, page.mimeType);
            pageTexts.push(text);
          }

          // Assemble markdown with metadata header
          const now = new Date().toISOString();
          const rangeStr = pageRange
            ? `${pageRange.start}-${pageRange.end}`
            : `1-${renderedPages.length}`;

          let markdown = `---\nsource: ${inputPath}\ngenerated: ${now}\npages: ${rangeStr}\nmethod: ${ocrProvider.name}\n---\n\n`;

          for (let i = 0; i < pageTexts.length; i++) {
            const pageNum = renderedPages[i]!.pageNumber;
            if (renderedPages.length > 1) {
              markdown += `## Page ${pageNum}\n\n`;
            }
            markdown += pageTexts[i]!.trim() + "\n\n";
          }

          // Write output file
          await mkdir(dirname(absoluteOutputPath), { recursive: true });
          await Bun.write(absoluteOutputPath, markdown);
          invalidateFileIndex();

          progress?.(`OCR complete: ${renderedPages.length} page${renderedPages.length === 1 ? "" : "s"} transcribed.`);

          return {
            content: [{
              type: "text",
              text: `Transcription saved to ${outputPath} (${renderedPages.length} page${renderedPages.length === 1 ? "" : "s"}).`,
            }],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error during PDF OCR: ${msg}` }],
            isError: true,
          };
        }
      },
    },
  ];
}

// --- Search helpers ---

interface SearchResult {
  path: string;
  snippets: string[];
  matchCount: number;
}

function wrapFileContent(path: string, content: string): string {
  return `<<<BEGIN_FILE_CONTENT path="${path}">>>\n${content}\n<<<END_FILE_CONTENT>>>`;
}

async function searchFile(dirPath: string, entry: string, query: string): Promise<SearchResult | null> {
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

async function searchDirectory(dirPath: string, query: string): Promise<SearchResult[]> {
  const entries = await readdir(dirPath, { recursive: true });
  const candidates = entries.filter((e) => {
    const ext = extname(e).toLowerCase();
    return ext === ".md" || ext === ".txt";
  });

  const BATCH_SIZE = 20;
  const results: SearchResult[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((entry) => searchFile(dirPath, entry, query)));
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
async function searchByTag(dirPath: string, tag: string, maxResults: number): Promise<SearchResult[]> {
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
      batch.map((entry) => searchFileForTag(dirPath, entry, tag))
    );
    results.push(...batchResults.filter((r): r is SearchResult => r !== null));

    if (results.length >= maxResults) {
      break;
    }
  }

  return results.slice(0, maxResults);
}

async function searchFileForTag(dirPath: string, entry: string, queryTag: string): Promise<SearchResult | null> {
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
          const snippet = lines.slice(start, end + 1).join("\n").trim();
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

/**
 * Check rate limit and wait if necessary.
 */
async function checkRateLimit(): Promise<void> {
  const now = Date.now();

  // Remove old timestamps outside the window
  while (rateLimitQueue.length > 0 && rateLimitQueue[0]! < now - RATE_LIMIT_WINDOW_MS) {
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
async function performWebSearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  // Check cache first
  const cacheKey = `${query}:${maxResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.results;
  }

  // Apply rate limiting
  await checkRateLimit();

  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned status ${response.status}`);
    }

    const html = await response.text();

    // Detect CAPTCHA/anomaly detection
    if (html.includes("anomaly-modal") || html.includes("challenge-form")) {
      throw new Error("DuckDuckGo CAPTCHA detected. Web search may be temporarily unavailable due to rate limiting.");
    }

    const results = parseDuckDuckGoResults(html, maxResults);

    // Cache the results
    searchCache.set(cacheKey, {
      results,
      timestamp: Date.now(),
    });

    return results;
  } catch (err) {
    throw new Error(`Web search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Parse DuckDuckGo HTML results.
 * Simple regex-based extraction (no DOM parser needed).
 */
function parseDuckDuckGoResults(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  // DuckDuckGo HTML results are in <div class="result"> elements
  // Title is in <a class="result__a">
  // URL is in the href
  // Snippet is in <a class="result__snippet">

  // Match result blocks
  const resultRegex = /<div class="result[^"]*">[\s\S]*?<\/div>\s*<\/div>/g;
  const matches = html.matchAll(resultRegex);

  for (const match of matches) {
    if (results.length >= maxResults) break;

    const resultHtml = match[0];

    // Extract title and URL
    const titleMatch = resultHtml.match(/<a class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const url = decodeURIComponent(titleMatch[1] || "");
    const titleHtml = titleMatch[2] || "";
    const title = stripHtmlTags(titleHtml).trim();

    // Extract snippet
    const snippetMatch = resultHtml.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippetHtml = snippetMatch?.[1] || "";
    const snippet = stripHtmlTags(snippetHtml).trim();

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
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
