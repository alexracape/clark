/**
 * Clark — Socratic Tutoring Assistant
 *
 * Entry point: loads config, runs onboarding if needed,
 * starts the canvas server, initializes the LLM, and renders the TUI.
 */

import React from "react";
import { render } from "ink";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { CanvasBroker, startCanvasServer, listCanvasFiles } from "./src/canvas/index.ts";
import { createTools } from "./src/mcp/index.ts";
import { join } from "node:path";
import { createProvider } from "./src/llm/index.ts";
import { Conversation } from "./src/llm/messages.ts";
import { App } from "./src/tui/app.tsx";
import { Onboarding } from "./src/tui/onboarding.tsx";
import { loadConfig, applyConfigToEnv, needsOnboarding, type ClarkConfig } from "./src/config.ts";
import { CommandHistory } from "./src/tui/history.ts";
import { registerCommands } from "./src/tui/input.tsx";
import { loadSkills } from "./src/skills.ts";
import { networkInterfaces } from "node:os";

// --- CLI args ---

const argv = await yargs(hideBin(process.argv))
  .option("notes", {
    type: "string",
    describe: "Path to notes vault directory",
  })
  .option("provider", {
    type: "string",
    describe: "LLM provider (anthropic or openai)",
  })
  .option("model", {
    type: "string",
    describe: "Specific model ID",
  })
  .option("port", {
    type: "number",
    default: 3000,
    describe: "Port for tldraw canvas server",
  })
  .option("resources", {
    type: "string",
    describe: "Path to resources directory (PDFs, images, slides)",
  })
  .option("canvas-path", {
    type: "string",
    describe: "Path for canvas exports and handwritten work",
  })
  .help()
  .parse();

// --- Get LAN IP for canvas URL ---

function getLanIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// --- Load config ---

const config = await loadConfig();
applyConfigToEnv(config);

// --- Check if onboarding is needed ---

if (needsOnboarding(config)) {
  // Render onboarding flow, then start the app
  const { waitUntilExit } = render(
    React.createElement(Onboarding, {
      onComplete: (newConfig: ClarkConfig) => {
        applyConfigToEnv(newConfig);
        // Re-render with the main app after a brief delay
        setTimeout(() => startApp(newConfig), 100);
      },
    }),
  );
} else {
  startApp(config);
}

// --- Main app startup ---

async function startApp(activeConfig: ClarkConfig) {
  const resolvedProvider = argv.provider ?? activeConfig.provider ?? "anthropic";

  // Resolve configured paths
  const vaultDir = argv.notes ?? activeConfig.resourcePath ?? ".";

  // --- Lazy canvas session ---
  // Canvas starts closed. Populated when user opens one via /canvas.
  let activeCanvas: {
    broker: CanvasBroker;
    server: ReturnType<typeof Bun.serve>;
    saveSnapshot: () => Promise<void>;
    canvasUrl: string;
    canvasName: string;
  } | null = null;

  const canvasDir = join(vaultDir, "Resources", "Canvas");

  /** Open a named canvas — starts the server and loads/creates the .tldr file. */
  async function openCanvas(name: string): Promise<{ url: string }> {
    if (activeCanvas) {
      throw new Error(`Canvas "${activeCanvas.canvasName}" is already open. Restart to switch canvases.`);
    }

    const snapshotPath = join(canvasDir, `${name}.tldr`);
    const broker = new CanvasBroker();
    const lanIP = getLanIP();

    const { server, saveSnapshot } = await startCanvasServer({
      port: argv.port,
      broker,
      snapshotPath,
    });

    const canvasUrl = `http://${lanIP}:${server.port}`;
    activeCanvas = { broker, server, saveSnapshot, canvasUrl, canvasName: name };
    return { url: canvasUrl };
  }

  /** List existing canvas files in the vault. */
  async function listCanvases(): Promise<string[]> {
    return listCanvasFiles(canvasDir);
  }

  // Initialize tools with dynamic getters
  const tools = createTools({
    getBroker: () => activeCanvas?.broker ?? null,
    vaultDir,
    getSaveCanvas: () => activeCanvas?.saveSnapshot ?? null,
  });

  // Resolve model name before creating provider
  const defaultModels: Record<string, string> = {
    anthropic: "claude-sonnet-4-5-20250929",
    openai: "gpt-4o",
    gemini: "gemini-2.5-flash",
  };

  let modelName = argv.model
    ?? process.env.CLARK_MODEL
    ?? activeConfig.model
    ?? defaultModels[resolvedProvider];

  // Ollama: discover default model dynamically if none specified
  if (resolvedProvider === "ollama") {
    const { listLocalModels, checkModelFits } = await import("./src/llm/ollama.ts");

    if (!modelName) {
      try {
        const models = await listLocalModels();
        if (models.length === 0) {
          console.error(
            "No Ollama models found.\n" +
            "  Download one with:  ollama pull llama3.2\n" +
            "  Browse models:      https://ollama.com/library",
          );
          process.exit(1);
        }
        modelName = models[0]!.name;
      } catch {
        console.error(
          "Cannot connect to Ollama.\n" +
          "  Start it with:  ollama serve\n" +
          "  Install:        brew install ollama",
        );
        process.exit(1);
      }
    }

    // RAM preflight check
    try {
      const { sizeBytes, totalRam, pct } = await checkModelFits(modelName);
      if (pct > 0.8) {
        const sizeGB = (sizeBytes / 1e9).toFixed(1);
        const ramGB = (totalRam / 1e9).toFixed(1);
        console.warn(
          `Warning: Model "${modelName}" (${sizeGB} GB) uses ${Math.round(pct * 100)}% of system RAM (${ramGB} GB). Performance may be degraded.`,
        );
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  // Fall back to a sensible default
  modelName ??= "claude-sonnet-4-5-20250929";

  // Initialize LLM provider with resolved model
  const provider = createProvider(resolvedProvider, modelName);

  // Load system prompt
  const systemPromptPath = new URL("./src/prompts/system.md", import.meta.url).pathname;

  Bun.file(systemPromptPath).text().then(async (systemPrompt) => {
    const conversation = new Conversation();

    // --- Load skills from Structures directory ---
    const skills = await loadSkills(vaultDir);
    if (skills.length > 0) {
      registerCommands(skills.map((s) => ({ name: s.slug, description: s.description })));
    }

    // --- Slash command handler ---
    async function handleSlashCommand(name: string, args: string): Promise<string | null> {
      switch (name) {
        case "help": {
          const lines = [
            "Available commands:",
            "  /help              Show this help message",
            "  /canvas            Open or show active canvas",
            "  /export [path]     Export canvas as A4 PDF",
            "  /save              Save canvas state to disk",
            "  /notes [path]      Show or set notes vault directory",
            "  /model             Switch model and provider",
            "  /context           Show context window usage",
            "  /compact           Summarize conversation to save context",
            "  /clear             Clear conversation history",
            "  Ctrl+C             Exit",
          ];

          if (skills.length > 0) {
            lines.push("", "Skills (from Structures/):");
            for (const s of skills) {
              const padded = `  /${s.slug}`.padEnd(23);
              lines.push(`${padded}${s.description}`);
            }
          }

          return lines.join("\n");
        }

        case "canvas":
          // When canvas is open, show info. When closed, return null so App shows picker.
          if (activeCanvas) {
            return `Canvas "${activeCanvas.canvasName}" is open at ${activeCanvas.canvasUrl}\nOpen this on your iPad to start drawing.`;
          }
          return null;

        case "export": {
          if (!activeCanvas) {
            return "No canvas is open. Use /canvas to open one.";
          }
          if (!activeCanvas.broker.isConnected) {
            return "No iPad connected. Open the canvas URL on your iPad first.";
          }
          try {
            const { exportPDFToFile } = await import("./src/canvas/pdf-export.ts");
            const response = await activeCanvas.broker.requestExport();
            const outputPath = args || `${canvasDir}/clark-export.pdf`;
            await exportPDFToFile(response.pages, outputPath);
            return `PDF exported to: ${outputPath}`;
          } catch (err) {
            return `Export failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        case "save":
          if (!activeCanvas) {
            return "No canvas is open. Use /canvas to open one.";
          }
          try {
            await activeCanvas.saveSnapshot();
            return "Canvas state saved.";
          } catch (err) {
            return `Save failed: ${err instanceof Error ? err.message : String(err)}`;
          }

        case "notes":
          if (!args) return `Current vault: ${vaultDir}`;
          return `Vault directory set: ${args}`;

        case "model":
          // Handled by App component's model picker
          return null;

        case "context":
          // Handled by App component (needs activeModel from state)
          return null;

        case "compact": {
          const ctx = conversation.estimateContext();
          if (ctx.messageCount <= 4) {
            return "Conversation is too short to compact.";
          }

          // Use the active LLM to generate a summary
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
    }

    // --- Render TUI ---
    const history = new CommandHistory();

    render(
      React.createElement(App, {
        provider,
        model: modelName,
        config: activeConfig,
        conversation,
        systemPrompt,
        tools,
        isCanvasConnected: () => activeCanvas?.broker.isConnected ?? false,
        onSlashCommand: handleSlashCommand,
        onOpenCanvas: openCanvas,
        listCanvases,
        history,
        skills,
      }),
    );
  });
}
