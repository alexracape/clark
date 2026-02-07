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
import { CanvasBroker, startCanvasServer } from "./src/canvas/index.ts";
import { createTools } from "./src/mcp/index.ts";
import { createProvider } from "./src/llm/index.ts";
import { Conversation } from "./src/llm/messages.ts";
import { App } from "./src/tui/app.tsx";
import { Onboarding } from "./src/tui/onboarding.tsx";
import { loadConfig, applyConfigToEnv, needsOnboarding, type ClarkConfig } from "./src/config.ts";
import { networkInterfaces } from "node:os";

// --- CLI args ---

const argv = await yargs(hideBin(process.argv))
  .option("problem", {
    type: "string",
    describe: "Path to problem set file (PDF or markdown)",
  })
  .option("notes", {
    type: "string",
    describe: "Path to notes directory",
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

function startApp(activeConfig: ClarkConfig) {
  const resolvedProvider = argv.provider ?? activeConfig.provider ?? "anthropic";

  const broker = new CanvasBroker();
  const lanIP = getLanIP();
  const canvasUrl = `http://${lanIP}:${argv.port}`;

  // Start canvas server
  startCanvasServer({ port: argv.port, broker });

  // Initialize tools
  const tools = createTools({
    broker,
    notesDir: argv.notes,
    problemPath: argv.problem,
  });

  // Initialize LLM provider
  const provider = createProvider(resolvedProvider);
  const modelName = argv.model
    ?? process.env.CLARK_MODEL
    ?? activeConfig.model
    ?? (resolvedProvider === "openai" ? "gpt-4o" : "claude-sonnet-4-5-20250929");

  // Load system prompt
  const systemPromptPath = new URL("./src/prompts/system.md", import.meta.url).pathname;

  Bun.file(systemPromptPath).text().then((systemPrompt) => {
    const conversation = new Conversation();

    // --- Slash command handler ---
    async function handleSlashCommand(name: string, args: string): Promise<string | null> {
      switch (name) {
        case "help":
          return [
            "Available commands:",
            "  /help              Show this help message",
            "  /canvas            Show canvas URL for iPad",
            "  /snapshot [page]   Capture canvas and send to assistant",
            "  /export [path]     Export canvas as A4 PDF",
            "  /save              Save canvas state to disk",
            "  /problem <path>    Load a problem set",
            "  /notes <path>      Set notes directory",
            "  /model <provider>  Show or switch LLM provider",
            "  /clear             Clear conversation history",
            "  Ctrl+C             Exit",
          ].join("\n");

        case "canvas":
          return `Canvas URL: ${canvasUrl}\nOpen this on your iPad to start drawing.`;

        case "snapshot": {
          if (!broker.isConnected) {
            return "No iPad connected. Open the canvas URL on your iPad first.";
          }
          try {
            const response = await broker.requestSnapshot(args || undefined);
            conversation.addUserImageMessage(
              "Here is my current work on the canvas:",
              response.png,
            );
            return `Snapshot captured (page: ${response.page}). The assistant can now see your work.`;
          } catch (err) {
            return `Snapshot failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        case "export": {
          if (!broker.isConnected) {
            return "No iPad connected. Open the canvas URL on your iPad first.";
          }
          try {
            const { exportPDFToFile } = await import("./src/canvas/pdf-export.ts");
            const response = await broker.requestExport();
            const outputPath = args || "./clark-export.pdf";
            await exportPDFToFile(response.pages, outputPath);
            return `PDF exported to: ${outputPath}`;
          } catch (err) {
            return `Export failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        case "save":
          return "Canvas save not yet implemented.";

        case "problem":
          if (!args) return "Usage: /problem <path>";
          return `Problem set loaded: ${args}`;

        case "notes":
          if (!args) return "Usage: /notes <path>";
          return `Notes directory set: ${args}`;

        case "model":
          if (!args) return `Current: ${provider.name}/${modelName}`;
          return `Provider switching not yet implemented. Restart with --provider ${args}`;

        case "clear":
          conversation.clear();
          return "Conversation cleared.";

        default:
          return `Unknown command: /${name}. Type /help for available commands.`;
      }
    }

    // --- Render TUI ---
    render(
      React.createElement(App, {
        provider,
        model: modelName,
        conversation,
        systemPrompt,
        tools,
        canvasUrl,
        isCanvasConnected: () => broker.isConnected,
        onSlashCommand: handleSlashCommand,
      }),
    );
  });
}
