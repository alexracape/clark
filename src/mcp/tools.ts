/**
 * MCP tool definitions and handlers.
 *
 * Each tool is defined with its schema and handler function.
 * File tools are scoped to the vault directory. Canvas tools delegate to the CanvasBroker.
 */

import { readdir, stat, mkdir } from "node:fs/promises";
import { join, extname, dirname, relative } from "node:path";
import type { CanvasBroker } from "../canvas/server.ts";
import { exportPDFToFile } from "../canvas/pdf-export.ts";
import { extractPDFText } from "./pdf.ts";
import {
  extractWikilinks,
  buildLinkFooter,
  resolveVaultPath,
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
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
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
  broker: CanvasBroker;
  vaultDir: string;
  /** Callback to persist canvas state. Provided by index.ts when TLSocketRoom is available. */
  saveCanvas?: () => Promise<void>;
}

/**
 * Create all tool definitions with their handlers wired to the given config.
 */
export function createTools(config: ToolsConfig): ToolDefinition[] {
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
        const inputPath = input.path as string;
        const absolutePath = resolveVaultPath(inputPath, config.vaultDir);
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
            return { content: [{ type: "text", text }] };
          }

          // Markdown / text file
          const text = await Bun.file(absolutePath).text();
          const links = extractWikilinks(text);
          const footer = await buildLinkFooter(links, config.vaultDir);
          return { content: [{ type: "text", text: text + footer }] };
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
        const query = (input.query as string).toLowerCase();

        const results = await searchDirectory(config.vaultDir, query);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No results found for "${query}"` }] };
        }

        const text = results
          .sort((a, b) => b.matchCount - a.matchCount)
          .slice(0, 10)
          .map((r) => `### ${r.path} (${r.matchCount} matches)\n${r.snippets.join("\n...\n")}`)
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
        const subPath = (input.path as string | undefined) ?? ".";
        const absolutePath = resolveVaultPath(subPath, config.vaultDir);
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
        const inputPath = input.path as string;
        const absolutePath = resolveVaultPath(inputPath, config.vaultDir);
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
        const inputPath = input.path as string;
        const absolutePath = resolveVaultPath(inputPath, config.vaultDir);
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

    // --- Canvas tools ---

    {
      name: "read_canvas",
      description:
        "Capture a PNG snapshot of a canvas page from the student's iPad. Returns the image for visual analysis of handwritten work.",
      inputSchema: {
        type: "object",
        properties: {
          page: {
            type: "string",
            description: "Page ID to snapshot (omit for current page)",
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      handler: async (input) => {
        try {
          const response = await config.broker.requestSnapshot(input.page as string | undefined);
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
        "Export all canvas pages as an A4 PDF file. Returns the file path.",
      inputSchema: {
        type: "object",
        properties: {
          output_path: {
            type: "string",
            description: "Output file path for the PDF (defaults to ./output.pdf)",
          },
        },
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      handler: async (input) => {
        const outputPath = (input.output_path as string) ?? "./output.pdf";
        try {
          const response = await config.broker.requestExport();
          const path = await exportPDFToFile(response.pages, outputPath);
          return {
            content: [{ type: "text", text: `PDF exported to: ${path}` }],
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
        if (!config.saveCanvas) {
          return {
            content: [{ type: "text", text: "Canvas save not available (no TLSocketRoom configured)." }],
            isError: true,
          };
        }
        try {
          await config.saveCanvas();
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
  ];
}

// --- Search helpers ---

interface SearchResult {
  path: string;
  snippets: string[];
  matchCount: number;
}

async function searchDirectory(dirPath: string, query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const entries = await readdir(dirPath, { recursive: true });

  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (ext !== ".md" && ext !== ".txt") continue;

    const fullPath = join(dirPath, entry);
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) continue;

    try {
      const content = await Bun.file(fullPath).text();
      const lines = content.split("\n");
      const matchingLines: string[] = [];
      let matchCount = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.toLowerCase().includes(query)) {
          matchCount++;
          // Include surrounding context (1 line above and below)
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length - 1, i + 1);
          const snippet = lines.slice(start, end + 1).join("\n");
          matchingLines.push(snippet);
        }
      }

      if (matchingLines.length > 0) {
        results.push({
          path: relative(dirPath, fullPath),
          snippets: matchingLines.slice(0, 3),
          matchCount,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}
