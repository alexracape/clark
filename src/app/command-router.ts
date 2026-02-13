import { dirname, extname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { Skill } from "../skills.ts";
import type { Conversation } from "../llm/messages.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { CanvasSessionManager } from "./canvas-session.ts";
import { expandPath } from "../library.ts";

export interface CommandRouterOptions {
  canvas: CanvasSessionManager;
  getExportDir: () => string;
  setExportDir: (dir: string) => void;
  persistExportDir?: (dir: string) => Promise<void>;
  skills: Skill[];
  conversation: Conversation;
  provider: LLMProvider;
}

export function createSlashCommandHandler(options: CommandRouterOptions) {
  const { canvas, getExportDir, setExportDir, persistExportDir, skills, conversation, provider } = options;

  async function pathIsDirectory(path: string): Promise<boolean> {
    try {
      const s = await stat(path);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  async function resolveExportTarget(args: string, canvasName: string): Promise<{ outputPath: string; nextExportDir: string | null }> {
    const trimmed = args.trim();
    if (!trimmed) {
      const exportDir = getExportDir();
      return {
        outputPath: join(exportDir, `${canvasName}.pdf`),
        nextExportDir: null,
      };
    }

    const rawPath = expandPath(trimmed);
    const absolutePath = resolve(rawPath);
    const trailingSlash = /[\\/]$/.test(trimmed);
    const looksLikePdfFile = extname(absolutePath).toLowerCase() === ".pdf";

    if (trailingSlash) {
      return {
        outputPath: join(absolutePath, `${canvasName}.pdf`),
        nextExportDir: absolutePath,
      };
    }

    if (looksLikePdfFile) {
      return {
        outputPath: absolutePath,
        nextExportDir: dirname(absolutePath),
      };
    }

    if (await pathIsDirectory(absolutePath)) {
      return {
        outputPath: join(absolutePath, `${canvasName}.pdf`),
        nextExportDir: absolutePath,
      };
    }

    return {
      outputPath: join(absolutePath, `${canvasName}.pdf`),
      nextExportDir: absolutePath,
    };
  }

  return async function handleSlashCommand(name: string, args: string): Promise<string | null> {
    switch (name) {
      case "help": {
        const lines = [
          "Available commands:",
          "  /help              Show this help message",
          "  /canvas            Open or switch canvas",
          "  /export [path]     Export canvas as A4 PDF",
          "  /model             Switch model and provider",
          "  /context           Show context window usage",
          "  /compact           Summarize conversation to save context",
          "  /clear             Clear conversation history",
          "  Ctrl+C             Exit",
        ];

        if (skills.length > 0) {
          lines.push("", "Skills (from Clark/Structures/):");
          for (const s of skills) {
            const padded = `  /${s.slug}`.padEnd(23);
            lines.push(`${padded}${s.description}`);
          }
        }

        return lines.join("\n");
      }

      case "canvas": {
        if (!args) {
          return null;
        }

        const info = await canvas.open(args.trim());
        return `Canvas "${info.name}" opened at ${info.url}\nOpen this on your iPad to start drawing.`;
      }

      case "export": {
        const active = canvas.activeInfo;
        if (!active) {
          return "No canvas is open. Use /canvas to open one.";
        }

        try {
          const { exportPDFToFile } = await import("../canvas/pdf-export.ts");
          const { outputPath, nextExportDir } = await resolveExportTarget(args, active.name);
          const { pages } = await canvas.exportPages();
          await exportPDFToFile(pages, outputPath);
          let persistenceWarning = "";

          if (nextExportDir) {
            setExportDir(nextExportDir);
            try {
              await persistExportDir?.(nextExportDir);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              persistenceWarning = `\nExport directory updated for this session, but failed to persist config: ${msg}`;
            }
          }

          return `PDF exported to: ${outputPath}${persistenceWarning}`;
        } catch (err) {
          if (err instanceof Error && err.message === "No iPad client connected") {
            return "Export failed: no canvas client is currently connected.\nOpen the canvas URL in a browser (e.g. on your iPad) and keep it connected while running /export.";
          }
          return `Export failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      case "model":
        return null;

      case "context":
        return null;

      case "compact": {
        const ctx = conversation.estimateContext();
        if (ctx.messageCount <= 4) {
          return "Conversation is too short to compact.";
        }

        try {
          const msgs = conversation.getMessages();
          const textParts = msgs
            .flatMap((m) => m.content)
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text);
          const transcript = textParts.join("\n---\n").slice(0, 8000);

          let summary = "";
          for await (const chunk of provider.chat(
            [{ role: "user", content: [{ type: "text", text: `Summarize this tutoring conversation in 2-3 concise paragraphs. Focus on the topics discussed, key concepts, and where the student left off:\n\n${transcript}` }] }],
            [],
            "You are a helpful assistant that summarizes conversations concisely.",
          )) {
            if (chunk.type === "text_delta") summary += chunk.text;
          }

          const before = ctx.totalTokens;
          conversation.compact(summary);
          const after = conversation.estimateContext().totalTokens;
          return `Conversation compacted. ~${(before - after).toLocaleString()} tokens reclaimed.\n\nSummary preserved:\n${summary}`;
        } catch (err) {
          return `Compact failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      case "clear":
        conversation.clear();
        return "Conversation cleared.";

      default:
        return `Unknown command: /${name}. Type /help for available commands.`;
    }
  };
}
