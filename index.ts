/**
 * Clark — Socratic Tutoring Assistant
 *
 * Entry point: parses CLI args, starts the canvas server,
 * initializes the MCP server and LLM provider, and renders the TUI.
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { CanvasBroker, startCanvasServer } from "./src/canvas/index.ts";
import { createTools } from "./src/mcp/index.ts";
import { createProvider } from "./src/llm/index.ts";
import { Conversation } from "./src/llm/messages.ts";
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
    default: "anthropic",
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

// --- Bootstrap ---

const broker = new CanvasBroker();
const lanIP = getLanIP();
const canvasUrl = `http://${lanIP}:${argv.port}`;

// Start canvas server
const canvasServer = startCanvasServer({ port: argv.port, broker });
console.log(`Canvas server running at ${canvasUrl}`);

// Initialize tools
const tools = createTools({
  broker,
  notesDir: argv.notes,
  problemPath: argv.problem,
});

// Initialize LLM provider
const provider = createProvider(argv.provider);
console.log(`LLM provider: ${provider.name}`);

// Load system prompt
const systemPrompt = await Bun.file(new URL("./src/prompts/system.md", import.meta.url).pathname).text();

// Initialize conversation
const conversation = new Conversation();

// Load problem set context if provided
if (argv.problem) {
  console.log(`Problem set: ${argv.problem}`);
}
if (argv.notes) {
  console.log(`Notes directory: ${argv.notes}`);
}

console.log("\nClark is ready. TUI rendering coming soon.");
console.log(`Open ${canvasUrl} on your iPad to start drawing.`);

// TODO: Render Ink TUI app with:
// - onMessage: send to LLM provider with conversation history + tools
// - onSlashCommand: handle /canvas, /snapshot, /export, /save, /clear, /model, /help
// - canvasConnected: broker.isConnected
