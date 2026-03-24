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

import { readdir, mkdir, rename } from "node:fs/promises";
import { basename, join, dirname, resolve } from "node:path";
import { networkInterfaces } from "node:os";

// macOS GUI apps get a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
// Ensure common Homebrew/system tool paths are available for poppler, etc.
if (process.platform === "darwin") {
  const currentPath = process.env.PATH ?? "";
  const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/sbin"];
  const missing = extraPaths.filter(p => !currentPath.includes(p));
  if (missing.length > 0) {
    process.env.PATH = [...missing, currentPath].join(":");
  }
}

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
import { loadConfig, saveConfig, resolveApiKey, setProviderApiKey, needsOnboarding } from "../core/config.ts";
import type { ClarkConfig } from "../core/config.ts";
import { scaffoldLibrary, clarkCanvasDirPath } from "../core/library.ts";
import { loadEffectiveSystemPrompt } from "../cli/bootstrap/system-prompt.ts";
import { CanvasSessionManager } from "../core/app/canvas-session.ts";
import { createSlashCommandHandler } from "../core/app/command-router.ts";
import { VisionOCRProvider } from "../core/ocr/provider.ts";
import { OllamaEmbeddingProvider, type EmbeddingProvider } from "../core/embedding/provider.ts";
import { EmbeddingIndex } from "../core/embedding/index.ts";
import { SessionManager } from "../core/sessions/index.ts";
import { clarkSessionsDirPath } from "../core/library.ts";
import { detectFilePath, copyFileToResources, runIngestionPipeline } from "../core/app/ingest.ts";
import { getWorkspaceDir } from "../core/workspace.ts";
import { resolveWikilink } from "../core/mcp/vault.ts";
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
let systemPromptText: string;
let progressCallback: ((message: string) => void) | undefined;
let embeddingProvider: EmbeddingProvider | null = null;
let searchIndex: EmbeddingIndex | null = null;
let sessionManager: SessionManager | null = null;
let currentSessionPath: string | null = null;
let sessionHasMessages = false;

/** Connected WebSocket clients for streaming events */
const streamClients = new Set<{ send(data: string): void }>();
const streamListeners = new Set<(event: SidecarStreamEvent) => void>();
const activeIngestions = new Set<string>();

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
  let mName =
    cfg.model
    ?? getDefaultModelForProvider(pName);

  // Ollama has no static default model — pick the first locally available one.
  if (!mName && pName === "ollama") {
    try {
      const { listLocalModels } = await import("../core/llm/ollama.ts");
      const models = await listLocalModels();
      if (models.length > 0) mName = models[0]!.name;
    } catch {
      // Ollama not running — mName stays undefined, will fail below
    }
  }

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
      modelName: mName ?? pName,
      provider: createProvider(pName, mName),
    };
  } catch (err) {
    // If the configured provider cannot be constructed (e.g. missing API key),
    // fall back to a local provider so the GUI can still boot and open /model.
    let fallbackModel: string | undefined;
    try {
      const { listLocalModels } = await import("../core/llm/ollama.ts");
      const models = await listLocalModels();
      if (models.length > 0) fallbackModel = models[0]!.name;
    } catch {
      // Ollama not available
    }

    if (fallbackModel) {
      setProviderOptions("ollama", {
        ...(cfg.maxTokens ? { maxTokens: cfg.maxTokens } : {}),
      });
      try {
        return {
          providerName: "ollama",
          modelName: fallbackModel,
          provider: createProvider("ollama", fallbackModel),
        };
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

/** Set up embedding provider and search index from config. */
function setupEmbedding(cfg: ClarkConfig, wsDir: string): void {
  // Close previous index if any
  searchIndex?.close();
  embeddingProvider = null;
  searchIndex = null;

  if (cfg.embedding?.provider === "ollama" && cfg.embedding.model) {
    try {
      embeddingProvider = new OllamaEmbeddingProvider(cfg.embedding.model);
      searchIndex = new EmbeddingIndex(join(wsDir, "Clark", "search.db"));
    } catch {
      // Embedding setup failed — fall back to keyword search
      embeddingProvider = null;
      searchIndex = null;
    }
  }
}

async function bootstrap(): Promise<void> {
  workspaceDir = getWorkspaceDir();
  config = await loadConfig();

  // Prefer persisted workspace from onboarding over env var / default
  if (config.workspaceDir) {
    workspaceDir = config.workspaceDir;
  }

  await scaffoldLibrary(workspaceDir);
  exportDir = config.pdfExportDir ?? workspaceDir;

  const resolved = await resolveProviderFromConfig(config);
  provider = resolved.provider;
  providerName = resolved.providerName;
  modelName = resolved.modelName;

  setupEmbedding(config, workspaceDir);

  sessionManager = new SessionManager(clarkSessionsDirPath(workspaceDir), workspaceDir);
  currentSessionPath = await sessionManager.createSession(providerName, modelName).catch(() => null);

  systemPromptText = await loadEffectiveSystemPrompt(workspaceDir);
  const systemPrompt = systemPromptText;
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
    getEmbeddingProvider: () => embeddingProvider,
    getSearchIndex: () => searchIndex,
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

  // Capture count before adding user message so it's included in the session append
  const prevCount = conversation.getMessages().length;

  // Check for file path (drag-and-drop or pasted path)
  const filePath = await detectFilePath(body.text);
  if (filePath) {
    try {
      const result = await copyFileToResources(filePath, workspaceDir, config.fileRouting);
      conversation.addUserMessage(
        `I've shared a file: ${result.fileName} (${result.fileSize}). It's now at ${result.destPath}. Please process it.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: `File ingestion failed: ${msg}` }, 500);
    }
  } else {
    const canvasState = canvas.connectionStatus.state;
    const activeCanvas = canvas.activeInfo;
    const canvasTag = activeCanvas
      ? `Canvas state: ${canvasState} (${activeCanvas.name})`
      : `Canvas state: ${canvasState}`;
    conversation.addUserMessage(`${canvasTag}\n\n${body.text}`);
  }

  // Run the turn asynchronously — events stream over WebSocket
  const callbacks = makeStreamCallbacks();
  engine.runTurn(provider, callbacks).then(async () => {
    broadcast({ type: "turn_complete" });
    if (sessionManager && currentSessionPath) {
      const newMessages = conversation.getMessages().slice(prevCount);
      if (newMessages.length > 0) {
        await sessionManager.appendMessages(currentSessionPath, newMessages).catch(() => {});
        sessionHasMessages = true;
      }
    }
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

/** POST /api/ingest — Copy file to workspace Resources/ and run background pipeline */
async function handleIngest(req: Request): Promise<Response> {
  const body = await req.json() as { path: string };
  if (!body.path) {
    return jsonResponse({ error: "Missing 'path' field" }, 400);
  }

  const ingestKey = resolve(body.path);
  if (activeIngestions.has(ingestKey)) {
    return jsonResponse({
      fileName: basename(ingestKey),
      summary: `Already importing ${basename(ingestKey)}.`,
      deduped: true,
    });
  }

  try {
    activeIngestions.add(ingestKey);
    const routing = config.fileRouting;
    const result = await copyFileToResources(body.path, workspaceDir, routing);

    // Broadcast start event immediately
    broadcast({ type: "ingest_start", fileName: result.fileName, destPath: result.destPath });
    console.log(`[ingest] Starting pipeline for ${result.fileName}`);

    // Kick off background pipeline (non-blocking)
    runIngestionInBackground(result.fileName, result.destPath, ingestKey);

    return jsonResponse(result);
  } catch (err) {
    activeIngestions.delete(ingestKey);
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** Run the ingestion pipeline in the background (transcribe + link). */
function runIngestionInBackground(fileName: string, destPath: string, ingestKey: string): void {
  // Gather conversation context from recent messages
  const recentMessages = conversation.getMessages();
  const contextMessages = recentMessages
    .slice(-6)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const textContent = m.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join(" ");
      return `${m.role}: ${textContent.substring(0, 200)}`;
    })
    .join("\n");

  const ocrProvider = provider.supportsVision
    ? new VisionOCRProvider(provider)
    : null;

  runIngestionPipeline({
    filePath: join(workspaceDir, destPath),
    destPath,
    fileName,
    workspaceDir,
    provider,
    tools,
    systemPrompt: systemPromptText,
    conversationContext: contextMessages,
    ocrProvider,
    onProgress: (stage, message) => {
      broadcast({ type: "ingest_progress", fileName, stage, message });
    },
  }).then((result) => {
    // Inject context into main conversation (LLM sees it on next turn)
    const finalName = result.finalFileName;
    const finalDest = result.finalDestPath;
    const baseName = finalName.substring(0, finalName.lastIndexOf(".")) || finalName;
    conversation.addUserMessage(
      `[File imported: ${finalName} → ${finalDest}]\n` +
      `${result.summary}\n` +
      `The transcript is at ${result.transcriptPath ?? `Clark/Transcripts/${baseName}.md`}.`,
    );

    // Show subtle system message in chat
    broadcast({ type: "system_message", text: `Imported ${finalName} → ${finalDest}\n${result.summary}` });

    // Broadcast completion
    broadcast({ type: "ingest_complete", fileName, summary: result.summary });
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    broadcast({ type: "ingest_error", fileName, error: msg });
  }).finally(() => {
    activeIngestions.delete(ingestKey);
  });
}

/** GET /api/resolve-note — Resolve a note name to its workspace-relative path */
async function handleResolveNote(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "";

  if (!name) {
    return jsonResponse({ error: "Missing 'name' parameter" }, 400);
  }

  const resolved = await resolveWikilink(name, workspaceDir);
  return jsonResponse({ name, path: resolved });
}

/** GET /api/asset — Serve workspace binary files (images, etc.) with correct MIME types */
async function handleAsset(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path") ?? "";

  if (!filePath || filePath.includes("..")) {
    return jsonResponse({ error: "Invalid path" }, 400);
  }

  let resolvedPath = filePath;
  let absolutePath = join(workspaceDir, resolvedPath);
  try {
    let file = Bun.file(absolutePath);
    let exists = await file.exists();

    // Support Obsidian-style embeds that use a bare filename instead of a
    // workspace-relative path by resolving against the vault index.
    if (!exists) {
      const wikilinkResolved = await resolveWikilink(filePath, workspaceDir);
      if (!wikilinkResolved) {
        return new Response("Not Found", { status: 404, headers: corsHeaders() });
      }

      resolvedPath = wikilinkResolved;
      absolutePath = join(workspaceDir, resolvedPath);
      file = Bun.file(absolutePath);
      exists = await file.exists();
      if (!exists) {
        return new Response("Not Found", { status: 404, headers: corsHeaders() });
      }
    }

    return new Response(file, {
      headers: {
        "Content-Type": file.type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "max-age=3600",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  }
}

/** GET /api/file-content — Read raw file text */
async function handleFileContent(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path") ?? "";

  if (!filePath || filePath.includes("..")) {
    return jsonResponse({ error: "Invalid path" }, 400);
  }

  const absolutePath = join(workspaceDir, filePath);
  try {
    const content = await Bun.file(absolutePath).text();
    return jsonResponse({ path: filePath, content });
  } catch {
    return jsonResponse({ error: "File not found" }, 404);
  }
}

/** POST /api/file-content — Write file content */
async function handleWriteFileContent(req: Request): Promise<Response> {
  const body = await req.json() as { path: string; content: string };

  if (!body.path || body.path.includes("..")) {
    return jsonResponse({ error: "Invalid path" }, 400);
  }
  if (typeof body.content !== "string") {
    return jsonResponse({ error: "Missing 'content' field" }, 400);
  }

  const absolutePath = join(workspaceDir, body.path);
  try {
    await mkdir(dirname(absolutePath), { recursive: true });
    await Bun.write(absolutePath, body.content);
    return jsonResponse({ ok: true, path: body.path });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** POST /api/rename-file — Rename/move a file within the workspace */
async function handleRenameFile(req: Request): Promise<Response> {
  const body = await req.json() as { oldPath: string; newPath: string };

  if (!body.oldPath || !body.newPath || body.oldPath.includes("..") || body.newPath.includes("..")) {
    return jsonResponse({ error: "Invalid path" }, 400);
  }

  const absoluteOld = join(workspaceDir, body.oldPath);
  const absoluteNew = join(workspaceDir, body.newPath);
  try {
    await mkdir(dirname(absoluteNew), { recursive: true });
    await rename(absoluteOld, absoluteNew);
    return jsonResponse({ ok: true, oldPath: body.oldPath, newPath: body.newPath });
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

    // Re-setup embedding with potentially new config
    setupEmbedding(newConfig, workspaceDir);

    // Rebuild tools with new OCR/embedding providers
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
      getEmbeddingProvider: () => embeddingProvider,
      getSearchIndex: () => searchIndex,
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

/** GET /api/ollama-models — List locally available Ollama models */
async function handleOllamaModels(): Promise<Response> {
  try {
    const { listLocalModels } = await import("../core/llm/ollama.ts");
    const models = await listLocalModels();
    if (models.length === 0) {
      return jsonResponse({ models: [], status: "no-models" });
    }
    return jsonResponse({
      models: models.map((m) => m.name),
      status: "running",
    });
  } catch {
    return jsonResponse({ models: [], status: "not-running" });
  }
}

/** GET /api/settings — Return current settings */
function handleGetSettings(): Response {
  return jsonResponse({
    workspaceDir,
    pdfExportDir: exportDir,
    fileRouting: config.fileRouting ?? {},
    embedding: config.embedding ?? {},
  });
}

/** POST /api/settings — Update settings */
async function handleUpdateSettings(req: Request): Promise<Response> {
  const body = await req.json() as {
    workspaceDir?: string;
    pdfExportDir?: string;
    fileRouting?: { pdf?: string; image?: string; other?: string; notes?: string };
    embedding?: { provider?: string; model?: string };
  };

  try {
    let newConfig = await loadConfig();

    if (body.fileRouting !== undefined) {
      newConfig.fileRouting = body.fileRouting;
    }
    if (body.embedding !== undefined) {
      // Normalize: if provider is empty string, treat as undefined (off)
      const embProvider = body.embedding.provider || undefined;
      const embModel = embProvider ? (body.embedding.model || undefined) : undefined;
      newConfig.embedding = embProvider ? { provider: embProvider as "ollama", model: embModel } : undefined;
    }
    if (body.pdfExportDir !== undefined) {
      newConfig.pdfExportDir = body.pdfExportDir || undefined;
    }
    if (body.workspaceDir !== undefined && body.workspaceDir !== workspaceDir) {
      newConfig.workspaceDir = body.workspaceDir;
      workspaceDir = body.workspaceDir;
      await scaffoldLibrary(workspaceDir);
    }

    await saveConfig(newConfig);
    config = newConfig;

    // Update module-level export dir
    exportDir = newConfig.pdfExportDir ?? workspaceDir;

    // Re-initialize embedding if changed
    if (body.embedding !== undefined) {
      setupEmbedding(newConfig, workspaceDir);
      // Rebuild tools so search_notes picks up new embedding
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
        getEmbeddingProvider: () => embeddingProvider,
        getSearchIndex: () => searchIndex,
      });
      engine.setTools(tools);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** GET /api/sessions — List saved sessions */
async function handleListSessions(): Promise<Response> {
  if (!sessionManager) return jsonResponse({ sessions: [] });
  const sessions = await sessionManager.listSessions();
  return jsonResponse({ sessions });
}

/** POST /api/sessions/load — Load a session into the active conversation */
async function handleLoadSession(req: Request): Promise<Response> {
  if (!sessionManager) return jsonResponse({ error: "Session manager not initialized" }, 500);
  const body = await req.json() as { path: string };
  if (!body.path) return jsonResponse({ error: "Missing 'path' field" }, 400);
  try {
    const { frontmatter, messages } = await sessionManager.loadSession(body.path);
    conversation.loadMessages(messages);

    // Delete the orphaned startup session (if it has no messages) and
    // redirect future appends to the resumed session file.
    await cleanupEmptySession();
    currentSessionPath = body.path;
    sessionHasMessages = true;

    return jsonResponse({ ok: true, messages, date: frontmatter.created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
}

/** GET /api/onboarding-status — Check if onboarding is needed */
async function handleOnboardingStatus(): Promise<Response> {
  const currentConfig = await loadConfig();
  if (currentConfig.hasCompletedOnboarding) {
    return jsonResponse({ needsOnboarding: false });
  }
  const needs = await needsOnboarding(currentConfig);
  return jsonResponse({ needsOnboarding: needs });
}

/** POST /api/complete-onboarding — Save provider, API key, workspace, and mark onboarding done */
async function handleCompleteOnboarding(req: Request): Promise<Response> {
  const body = await req.json() as {
    provider: string;
    apiKey?: string;
    workspaceDir?: string;
    model?: string;
    workspaceIsNew?: boolean;
  };
  if (!body.provider) {
    return jsonResponse({ error: "Missing 'provider' field" }, 400);
  }

  try {
    let newConfig = await loadConfig();

    // Save API key to system secret store (sets secretStoreBackend on config)
    if (body.apiKey && isApiKeyProvider(body.provider)) {
      newConfig = await setProviderApiKey(body.provider, body.apiKey, newConfig);
    }

    // Set provider and model. Use explicit model if provided (e.g. Ollama),
    // otherwise fall back to catalog default.
    newConfig.provider = body.provider;
    newConfig.model = body.model || getDefaultModelForProvider(body.provider);
    newConfig.hasCompletedOnboarding = true;

    // Set pdfExportDir: for new workspaces use Resources/PDFs, otherwise workspace root
    const targetWorkspace = body.workspaceDir || workspaceDir;
    newConfig.workspaceDir = targetWorkspace;
    if (body.workspaceIsNew) {
      newConfig.pdfExportDir = join(targetWorkspace, "Resources", "PDFs");
    } else {
      newConfig.pdfExportDir = newConfig.pdfExportDir ?? targetWorkspace;
    }
    await saveConfig(newConfig);

    // Update module-level state so /api/files reflects the new workspace immediately
    workspaceDir = targetWorkspace;
    exportDir = newConfig.pdfExportDir ?? targetWorkspace;

    // Scaffold workspace
    await scaffoldLibrary(targetWorkspace);

    // Re-resolve provider so the app is ready to use
    const resolved = await resolveProviderFromConfig(newConfig);
    provider = resolved.provider;
    providerName = resolved.providerName;
    modelName = resolved.modelName;

    broadcast({ type: "status_update", provider: providerName, model: modelName });
    return jsonResponse({ ok: true, provider: providerName, model: modelName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
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
      if (url.pathname === "/api/resolve-note" && req.method === "GET") {
        return await handleResolveNote(req);
      }
      if (url.pathname === "/api/asset" && req.method === "GET") {
        return await handleAsset(req);
      }
      if (url.pathname === "/api/file-content" && req.method === "GET") {
        return await handleFileContent(req);
      }
      if (url.pathname === "/api/file-content" && req.method === "POST") {
        return await handleWriteFileContent(req);
      }
      if (url.pathname === "/api/rename-file" && req.method === "POST") {
        return await handleRenameFile(req);
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
      if (url.pathname === "/api/ollama-models" && req.method === "GET") {
        return await handleOllamaModels();
      }
      if (url.pathname === "/api/settings" && req.method === "GET") {
        return handleGetSettings();
      }
      if (url.pathname === "/api/settings" && req.method === "POST") {
        return await handleUpdateSettings(req);
      }
      if (url.pathname === "/api/onboarding-status" && req.method === "GET") {
        return await handleOnboardingStatus();
      }
      if (url.pathname === "/api/complete-onboarding" && req.method === "POST") {
        return await handleCompleteOnboarding(req);
      }
      if (url.pathname === "/api/sessions" && req.method === "GET") {
        return await handleListSessions();
      }
      if (url.pathname === "/api/sessions/load" && req.method === "POST") {
        return await handleLoadSession(req);
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

async function cleanupEmptySession(): Promise<void> {
  if (sessionHasMessages || !currentSessionPath) return;
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(currentSessionPath);
  } catch {
    // Best-effort; ignore errors
  }
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

  // Clean up empty session files when the process exits
  const onExit = () => { void cleanupEmptySession(); };
  process.on("exit", onExit);
  process.on("SIGTERM", () => { void cleanupEmptySession().then(() => process.exit(0)); });
  process.on("SIGINT", () => { void cleanupEmptySession().then(() => process.exit(0)); });
}

if (import.meta.main) {
  await runSidecarServer();
}
