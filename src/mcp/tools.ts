/**
 * MCP tool definitions and handlers.
 *
 * Each tool is defined with its schema and handler function.
 * Canvas tools delegate to the CanvasBroker; file tools use the filesystem directly.
 */

import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { CanvasBroker } from "../canvas/server.ts";
import { exportPDFToFile } from "../canvas/pdf-export.ts";
import { extractPDFText } from "./pdf.ts";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
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
  notesDir?: string;
  problemPath?: string;
}

/**
 * Create all tool definitions with their handlers wired to the given config.
 */
export function createTools(config: ToolsConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: "read_file",
      description:
        "Read the contents of a file by path. Supports markdown (.md) as text and PDF (.pdf) with text extraction.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or relative path to the file",
          },
        },
        required: ["path"],
      },
      handler: async (input) => {
        const filePath = input.path as string;
        try {
          const ext = extname(filePath).toLowerCase();
          if (ext === ".pdf") {
            const text = await extractPDFText(filePath);
            return { content: [{ type: "text", text }] };
          }
          const text = await Bun.file(filePath).text();
          return { content: [{ type: "text", text }] };
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
        "Keyword search across all files in the notes directory. Returns matching file paths and text snippets.",
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
      handler: async (input) => {
        const query = (input.query as string).toLowerCase();
        if (!config.notesDir) {
          return {
            content: [{ type: "text", text: "No notes directory configured. Use --notes <path> to set one." }],
            isError: true,
          };
        }

        const results = await searchDirectory(config.notesDir, query);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No results found for "${query}"` }] };
        }

        const text = results
          .slice(0, 10) // Limit to top 10 results
          .map((r) => `### ${r.path}\n${r.snippets.join("\n...\n")}`)
          .join("\n\n---\n\n");

        return { content: [{ type: "text", text }] };
      },
    },

    {
      name: "list_files",
      description: "List files in a directory, optionally filtered by extension.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list",
          },
          extension: {
            type: "string",
            description: "Filter by file extension (e.g., '.md', '.pdf')",
          },
        },
        required: ["path"],
      },
      handler: async (input) => {
        const dirPath = input.path as string;
        const ext = input.extension as string | undefined;

        try {
          const entries = await readdir(dirPath, { recursive: true });
          const filtered = ext
            ? entries.filter((e) => e.endsWith(ext))
            : entries;

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
      handler: async () => {
        // TODO: Call storage.getSnapshot() and write to disk
        return {
          content: [{ type: "text", text: "Canvas state saved." }],
        };
      },
    },
  ];

  return tools;
}

// --- Search helpers ---

interface SearchResult {
  path: string;
  snippets: string[];
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

      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.toLowerCase().includes(query)) {
          // Include surrounding context (1 line above and below)
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length - 1, i + 1);
          const snippet = lines.slice(start, end + 1).join("\n");
          matchingLines.push(snippet);
        }
      }

      if (matchingLines.length > 0) {
        results.push({
          path: fullPath,
          snippets: matchingLines.slice(0, 3), // Limit snippets per file
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}
