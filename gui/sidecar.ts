/**
 * Bun sidecar API server for the Tauri GUI.
 *
 * Wraps the existing ConversationEngine and core modules with an HTTP/WS API.
 * The Tauri Rust backend spawns this process and proxies IPC commands to it.
 *
 * Routes:
 *   POST /api/chat       — Run a conversation turn (streaming via WebSocket)
 *   POST /api/command     — Dispatch a slash command
 *   POST /api/ingest      — Copy file to workspace Resources/
 *   GET  /api/status      — Current provider/model info
 *   GET  /api/files       — Workspace file listing
 *   GET  /api/models      — Available models with provider availability
 *   GET  /api/canvases    — List existing canvas names
 *   POST /api/canvas/open — Open a canvas by name
 *   GET  /api/context     — Context window usage breakdown
 *   WS   /api/stream      — Streaming events (text, thinking, tool_start, etc.)
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { networkInterfaces } from "node:os";

import { ConversationEngine } from "../core/engine.ts";
import type { TurnCallbacks } from "../core/engine.ts";
import { Conversation } from "../core/llm/messages.ts";
// Import from index.ts to trigger side-effect provider registration
import { createProvider } from "../core/llm/index.ts";
import { setProviderOptions } from "../core/llm/provider.ts";
import type { LLMProvider } from "../core/llm/provider.ts";
import { getDefaultModelForProvider, getCloudModelEntries, getProviderCatalogEntry, isApiKeyProvider } from "../core/llm/catalog.ts";
import { createTools } from "../core/mcp/index.ts";
import type { ToolDefinition } from "../core/mcp/tools.ts";
import { loadConfig, saveConfig, resolveApiKey, setProviderApiKey } from "../core/config.ts";
import type { ClarkConfig } from "../core/config.ts";
import { scaffoldLibrary, clarkCanvasDirPath } from "../core/library.ts";
import { loadEffectiveSystemPrompt } from "../cli/bootstrap/system-prompt.ts";
import { CanvasSessionManager } from "../core/app/canvas-session.ts";
import { createSlashCommandHandler } from "../core/app/command-router.ts";
import { VisionOCRProvider } from "../core/ocr/provider.ts";
import { detectFilePath, copyFileToResources } from "../core/app/ingest.ts";
import { getWorkspaceDir } from "../core/workspace.ts";
import type { SidecarStreamEvent } from "./src/stream-events.ts";

// --- Types ---

interface StreamSocketData {
  type: "stream";
}

// --- State ---

let config: ClarkConfig;
let provider: LLMProvider;
let providerName: string;
let modelName: string;
let conversation: Conversation;
let engine: ConversationEngine;
let tools: ToolDefinition[];
let canvas: CanvasSessionManager;
let onSlashCommand: (name: string, args: string) => Promise<string | null>;
let workspaceDir: string;
let exportDir: string;
let progressCallback: ((message: string) => void) | undefined;

/** Connected WebSocket clients for streaming events */
const streamClients = new Set<{ send(data: string): void }>();
const streamListeners = new Set<(event: SidecarStreamEvent) => void>();

/** Broadcast an event to all connected stream clients */
function broadcast(event: SidecarStreamEvent): void {
  const data = JSON.stringify(event);
  for (const listener of streamListeners) listener(event);
  for (const ws of streamClients) {
    try {
      ws.send(data);
    } catch {
      streamClients.delete(ws);
    }
  }
}

export function subscribeStreamEvents(listener: (event: SidecarStreamEvent) => void): () => void {
  streamListeners.add(listener);
  return () => streamListeners.delete(listener);
}

// --- Bootstrap ---

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

async function resolveProviderFromConfig(cfg: ClarkConfig): Promise<{
  providerName: string;
  modelName: string;
  provider: LLMProvider;
}> {
  const pName = cfg.provider ?? "anthropic";
  const mName =
    cfg.model
    ?? getDefaultModelForProvider(pName)
    // Ollama has no static default model in the catalog.
    ?? (pName === "ollama" ? "llama3.2" : undefined);

  // Keep the sidecar bootable even when no cloud API keys are configured.
  // This allows the GUI model picker to load and collect missing keys.
  const apiKey = await resolveApiKey(pName, cfg);

  setProviderOptions(pName, {
    ...(apiKey ? { apiKey } : {}),
    ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}),
  });

  try {
    return {
      providerName: pName,
      modelName: mName,
      provider: createProvider(pName, mName),
    };
  } catch (err) {
    // If the configured provider cannot be constructed (e.g. missing API key),
    // fall back to a local provider so the GUI can still boot and open /model.
    const fallbackProvider = "ollama";
    const fallbackModel = "llama3.2";
    setProviderOptions(fallbackProvider, {
      ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}),
    });
    try {
      return {
        providerName: fallbackProvider,
        modelName: fallbackModel,
        provider: createProvider(fallbackProvider, fallbackModel),
      };
    } catch {
      throw err;
    }
  }
}

async function bootstrap(): Promise<void> {
  workspaceDir = getWorkspaceDir();
  await scaffoldLibrary(workspaceDir);

  config = await loadConfig();
  exportDir = config.pdfExportDir ?? workspaceDir;

  const resolved = await resolveProviderFromConfig(config);
  provider = resolved.provider;
  providerName = resolved.providerName;
  modelName = resolved.modelName;

  const systemPrompt = await loadEffectiveSystemPrompt(workspaceDir);
  conversation = new Conversation();

  canvas = new CanvasSessionManager({
    port: 0, // OS-assigned port
    canvasDir: clarkCanvasDirPath(workspaceDir),
    getHost: getLanIP,
    bindHost: "0.0.0.0",
  });

  // Broadcast canvas connection status changes to stream clients
  canvas.subscribeConnectionStatus((status) => {
    const info = canvas.activeInfo;
    broadcast({
      type: "canvas_status",
      status: status.state,
      canvasName: info?.name,
      canvasUrl: info?.url,
    });
  });

  tools = createTools({
    getBroker: () => canvas.broker,
    getVaultDir: () => workspaceDir,
    getExportDir: () => exportDir,
    getSaveCanvas: () => canvas.saveCanvas,
    onProgress: (msg) => {
      progressCallback?.(msg);
      broadcast({ type: "system_message", text: msg });
    },
    getOCRProvider: () => {
      if (!provider.supportsVision) return null;
      return new VisionOCRProvider(provider);
    },
  });

  engine = new ConversationEngine({
    conversation,
    tools,
    systemPrompt,
    maxToolCallsPerTurn: config.maxToolCallsPerTurn,
  });

  onSlashCommand = createSlashCommandHandler({
    canvas,
    getExportDir: () => exportDir,
    setExportDir: (dir: string) => { exportDir = dir; },
    persistExportDir: async (dir: string) => {
      const currentConfig = await loadConfig();
      await saveConfig({ ...currentConfig, pdfExportDir: dir });
    },
    conversation,
    getProvider: () => provider,
  });
}

// --- Helpers ---

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

/** Build TurnCallbacks that broadcast events over the stream WebSocket */
function makeStreamCallbacks(): TurnCallbacks {
  return {
    onStreamingText: (text) => broadcast({ type: "streaming_text", text }),
    onStreamingThinking: (text) => broadcast({ type: "streaming_thinking", text }),
    onStreamingDone: () => broadcast({ type: "streaming_done" }),
    onAssistantMessage: (text) => broadcast({ type: "assistant_message", text }),
    onToolStart: (name) => broadcast({ type: "tool_start", name }),
    onToolResult: (name, result) => broadcast({ type: "tool_result", name, result }),
    onSystemMessage: (text) => broadcast({ type: "system_message", text }),
  };
}

// --- Route Handlers ---

/** POST /api/chat — Run a conversation turn */
async function handleChat(req: Request): Promise<Response> {
  const body = await req.json() as { text: string };
  if (!body.text?.trim()) {
    return jsonResponse({ error: "Missing 'text' field" }, 400);
  }

  // Check for file path (drag-and-drop or pasted path)
  const filePath = await detectFilePath(body.text);
  if (filePath) {
    try {
      const result = await copyFileToResources(filePath, workspaceDir);
      conversation.addUserMessage(
        `I've shared a file: ${result.fileName} (${result.fileSize}). It's now at ${result.destPath}. Please process it.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: `File ingestion failed: ${msg}` }, 500);
    }
  } else {
    conversation.addUserMessage(body.text);
  }

  // Run the turn asynchronously — events stream over WebSocket
  const callbacks = makeStreamCallbacks();
  engine.runTurn(provider, callbacks).then(() => {
    broadcast({ type: "turn_complete" });
  });

  return jsonResponse({ ok: true });
}

/** POST /api/command — Dispatch a slash command */
async function handleCommand(req: Request): Promise<Response> {
  const body = await req.json() as { command: string; args?: string };
  if (!body.command) {
    return jsonResponse({ error: "Missing 'command' field" }, 400);
  }

  const result = await onSlashCommand(body.command, body.args ?? "");

  // Handle special return values
  if (result === null) {
    // Commands like /model, /tutorial return null (handled by UI)
    return jsonResponse({ result: null, uiAction: body.command });
  }
  if (result === "__EXIT__") {
    return jsonResponse({ result: "Exiting.", exit: true });
  }

  return jsonResponse({ result });
}

/** POST /api/ingest — Copy file to workspace Resources/ */
async function handleIngest(req: Request): Promise<Response> {
  const body = await req.json() as { path: string };
  if (!body.path) {
    return jsonResponse({ error: "Missing 'path' field" }, 400);
  }

  try {
    const result = await copyFileToResources(body.path, workspaceDir);
    return jsonResponse(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** GET /api/status — Current provider/model info */
function handleStatus(): Response {
  return jsonResponse({
    provider: providerName,
    model: modelName,
    workspace: workspaceDir,
    canvasConnected: canvas.isConnected,
    canvasInfo: canvas.activeInfo,
    canvasConnectionStatus: canvas.connectionStatus,
  });
}

/** GET /api/files — Workspace file listing (optional ?path= for subdirectories) */
async function handleFiles(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const subpath = url.searchParams.get("path") ?? "";

    // Path traversal protection
    if (subpath.includes("..")) {
      return jsonResponse({ error: "Invalid path" }, 400);
    }

    const resolvedDir = subpath ? join(workspaceDir, subpath) : workspaceDir;
    const entries = await listDirectory(resolvedDir);

    // Include relative path in each entry
    const filesWithPath = entries.map((e) => ({
      ...e,
      path: subpath ? `${subpath}/${e.name}` : e.name,
    }));

    return jsonResponse({ files: filesWithPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** Recursively list files in a directory (shallow, one level) */
async function listDirectory(dir: string): Promise<Array<{ name: string; type: "file" | "directory" }>> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" as const : "file" as const,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return [];
  }
}

/** POST /api/provider — Switch provider/model at runtime */
async function handleProviderSwitch(req: Request): Promise<Response> {
  const body = await req.json() as { provider?: string; model?: string; apiKey?: string };

  try {
    let newConfig = await loadConfig();
    if (body.apiKey && body.provider) {
      if (!isApiKeyProvider(body.provider)) {
        return jsonResponse({ error: `Provider "${body.provider}" does not accept API keys.` }, 400);
      }
      newConfig = await setProviderApiKey(body.provider, body.apiKey, newConfig);
    }
    if (body.provider) newConfig.provider = body.provider;
    if (body.model) newConfig.model = body.model;
    await saveConfig(newConfig);

    const resolved = await resolveProviderFromConfig(newConfig);
    provider = resolved.provider;
    providerName = resolved.providerName;
    modelName = resolved.modelName;

    // Rebuild tools with new OCR provider
    tools = createTools({
      getBroker: () => canvas.broker,
      getVaultDir: () => workspaceDir,
      getExportDir: () => exportDir,
      getSaveCanvas: () => canvas.saveCanvas,
      onProgress: (msg) => {
        progressCallback?.(msg);
        broadcast({ type: "system_message", text: msg });
      },
      getOCRProvider: () => {
        if (!provider.supportsVision) return null;
        return new VisionOCRProvider(provider);
      },
    });
    engine.setTools(tools);

    broadcast({ type: "status_update", provider: providerName, model: modelName });
    return jsonResponse({ provider: providerName, model: modelName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** GET /api/history — Get conversation message history */
function handleHistory(): Response {
  const messages = conversation.getMessages().map((msg) => ({
    role: msg.role,
    content: msg.content.map((c) => {
      if (c.type === "text") return { type: "text", text: c.text };
      if (c.type === "tool_use") return { type: "tool_use", name: c.name, id: c.id };
      if (c.type === "tool_result") return { type: "tool_result", id: c.tool_use_id };
      return { type: c.type };
    }),
  }));
  return jsonResponse({ messages });
}

/** GET /api/models — Available models with provider availability */
async function handleModels(): Promise<Response> {
  const cloudModels = getCloudModelEntries();

  // Check which providers have API keys
  const providerAvailability: Record<string, boolean> = {};
  const currentConfig = await loadConfig();
  for (const entry of cloudModels) {
    if (!(entry.provider in providerAvailability)) {
      const key = await resolveApiKey(entry.provider, currentConfig);
      providerAvailability[entry.provider] = !!key;
    }
  }

  // Check for Ollama models
  let ollamaModels: Array<{ provider: string; providerLabel: string; model: string; label: string }> = [];
  let ollamaStatus = "not-running";
  try {
    const { listLocalModels } = await import("../core/llm/ollama.ts");
    const models = await listLocalModels();
    if (models.length === 0) {
      ollamaStatus = "no-models";
    } else {
      ollamaStatus = "running";
      ollamaModels = models.map((m) => ({
        provider: "ollama",
        providerLabel: getProviderCatalogEntry("ollama")?.label ?? "Ollama (Local)",
        model: m.name,
        label: m.name,
      }));
    }
  } catch {
    ollamaStatus = "not-running";
  }

  return jsonResponse({
    models: [...cloudModels, ...ollamaModels],
    providerAvailability: { ...providerAvailability, ollama: true },
    ollamaStatus,
    current: { provider: providerName, model: modelName },
  });
}

/** GET /api/canvases — List existing canvas names */
async function handleCanvases(): Promise<Response> {
  try {
    const canvases = await canvas.list();
    return jsonResponse({
      canvases,
      active: canvas.activeInfo,
      connectionStatus: canvas.connectionStatus.state,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** POST /api/canvas/open — Open a canvas by name */
async function handleCanvasOpen(req: Request): Promise<Response> {
  const body = await req.json() as { name: string };
  if (!body.name?.trim()) {
    return jsonResponse({ error: "Missing 'name' field" }, 400);
  }
  try {
    const info = await canvas.open(body.name.trim());
    return jsonResponse(info);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** GET /api/context — Context window usage breakdown */
function handleContext(): Response {
  const ctx = conversation.estimateContext();
  return jsonResponse(ctx);
}

// --- Server ---

export async function createSidecarServer(): Promise<{
  fetch: (req: Request, server: { upgrade(req: Request, opts: { data: StreamSocketData }): boolean }) => Promise<Response | undefined>;
  websocket: {
    open: (ws: { send(data: string): void }) => void;
    message: (_ws: unknown, _message: unknown) => void;
    close: (ws: { send(data: string): void }) => void;
  };
}> {
  await bootstrap();

  return {
    async fetch(req, server) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // WebSocket upgrade for /api/stream
    if (url.pathname === "/api/stream") {
      const upgraded = server.upgrade(req, { data: { type: "stream" } });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // REST API routes
    try {
      if (url.pathname === "/api/chat" && req.method === "POST") {
        return await handleChat(req);
      }
      if (url.pathname === "/api/command" && req.method === "POST") {
        return await handleCommand(req);
      }
      if (url.pathname === "/api/ingest" && req.method === "POST") {
        return await handleIngest(req);
      }
      if (url.pathname === "/api/provider" && req.method === "POST") {
        return await handleProviderSwitch(req);
      }
      if (url.pathname === "/api/status" && req.method === "GET") {
        return handleStatus();
      }
      if (url.pathname === "/api/files" && req.method === "GET") {
        return await handleFiles(req);
      }
      if (url.pathname === "/api/history" && req.method === "GET") {
        return handleHistory();
      }
      if (url.pathname === "/api/models" && req.method === "GET") {
        return await handleModels();
      }
      if (url.pathname === "/api/canvases" && req.method === "GET") {
        return await handleCanvases();
      }
      if (url.pathname === "/api/canvas/open" && req.method === "POST") {
        return await handleCanvasOpen(req);
      }
      if (url.pathname === "/api/context" && req.method === "GET") {
        return handleContext();
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: msg }, 500);
    }
  },
    websocket: {
      open(ws) {
        streamClients.add(ws);
      },
      message(_ws, _message) {
        // Stream WebSocket is server → client only; ignore incoming messages
      },
      close(ws) {
        streamClients.delete(ws);
      },
    },
  };
}

export async function runSidecarServer(): Promise<void> {
  const port = Number(process.env.CLARK_SIDECAR_PORT ?? "3456");
  const serverConfig = await createSidecarServer();
  const server = Bun.serve<StreamSocketData>({
    ...serverConfig,
    port,
  });
  console.log(`Clark sidecar listening on http://localhost:${server.port}`);
  // Write port to stdout for the Tauri process to read
  console.log(`CLARK_SIDECAR_PORT=${server.port}`);
}

if (import.meta.main) {
  await runSidecarServer();
}
