import React from "react";
import { render } from "ink";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { createTools } from "../../core/mcp/index.ts";
import { Conversation } from "../../core/llm/messages.ts";
import { App } from "../tui/app.tsx";
import { CommandHistory } from "../../core/history.ts";
import { scaffoldLibrary, clarkCanvasDirPath, clarkSessionsDirPath } from "../../core/library.ts";
import { SessionManager } from "../../core/sessions/index.ts";
import type { Message } from "../../core/llm/provider.ts";
import { loadConfig, saveConfig } from "../../core/config.ts";
import type { ClarkConfig } from "../../core/config.ts";
import type { CliArgs } from "./args.ts";
import { resolveProvider } from "./provider.ts";
import { loadEffectiveSystemPrompt } from "./system-prompt.ts";
import { CanvasSessionManager } from "../../core/app/canvas-session.ts";
import { createSlashCommandHandler } from "../../core/app/command-router.ts";
import { VisionOCRProvider } from "../../core/ocr/provider.ts";
import { CloudOCRProvider } from "../../core/ocr/cloud.ts";
import { checkPopplerAvailable, getPopplerInstallInstructions } from "../../core/ocr/pdf-renderer.ts";
import { CloudEmbeddingProvider } from "../../core/embedding/cloud.ts";
import { resolveCloudConfig } from "../../core/config.ts";
import { version } from "../../core/version.ts";
import { getWorkspaceDir } from "../../core/workspace.ts";

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

export async function startClarkApp(activeConfig: ClarkConfig, args: CliArgs): Promise<void> {
  const workspaceDir = getWorkspaceDir();
  await scaffoldLibrary(workspaceDir);

  let exportDir = activeConfig.pdfExportDir ?? workspaceDir;
  const { provider, modelName } = await resolveProvider(activeConfig, args);
  const systemPrompt = await loadEffectiveSystemPrompt(workspaceDir);

  const canvas = new CanvasSessionManager({
    port: args.port,
    canvasDir: clarkCanvasDirPath(workspaceDir),
    getHost: getLanIP,
    bindHost: "0.0.0.0",
  });

  // Resolve cloud config if using clark-cloud provider
  const isCloud = activeConfig.provider === "clark-cloud";
  const cloudConfig = isCloud ? resolveCloudConfig(activeConfig) : undefined;

  // Non-blocking poppler check — only relevant for non-cloud users
  if (!isCloud) {
    checkPopplerAvailable().then((available) => {
      if (!available) {
        console.error(
          `\n⚠  poppler not found — PDF processing will not be available.\n   ${getPopplerInstallInstructions()}\n   See: https://alex.racape.com/clark/dependencies.html#pdf-processing-with-popp\n`,
        );
      }
    });
  }

  const conversation = new Conversation();

  const sessionManager = new SessionManager(
    clarkSessionsDirPath(workspaceDir),
    workspaceDir,
  );
  let currentSessionPath: string | null = await sessionManager.createSession(
    activeConfig.provider ?? "clark-cloud",
    modelName,
  ).catch(() => null);
  let sessionHasMessages = false;

  async function cleanupEmptySession(): Promise<void> {
    if (sessionHasMessages || !currentSessionPath) return;
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(currentSessionPath);
    } catch { /* best-effort */ }
  }

  function onAfterTurn(newMessages: Message[]): void {
    if (!currentSessionPath) return;
    sessionManager.appendMessages(currentSessionPath, newMessages).catch((err) => {
      console.error("[session] Failed to save messages:", err);
    });
    sessionHasMessages = true;
  }

  // Mutable ref for progress callback — set by the App component once mounted
  let progressCallback: ((message: string) => void) | undefined;

  // Mutable ref for current provider — updated when user switches models
  let currentProvider = provider;

  const tools = createTools({
    getBroker: () => canvas.broker,
    getVaultDir: () => workspaceDir,
    getExportDir: () => exportDir,
    getSaveCanvas: () => canvas.saveCanvas,
    onProgress: (msg) => progressCallback?.(msg),
    getOCRProvider: () => {
      if (cloudConfig) {
        return new CloudOCRProvider(cloudConfig.url, cloudConfig.secret, cloudConfig.clientId);
      }
      if (!currentProvider.supportsVision) return null;
      return new VisionOCRProvider(currentProvider);
    },
  });

  const onSlashCommand = createSlashCommandHandler({
    canvas,
    getExportDir: () => exportDir,
    setExportDir: (dir: string) => {
      exportDir = dir;
    },
    persistExportDir: async (dir: string) => {
      const currentConfig = await loadConfig();
      await saveConfig({ ...currentConfig, pdfExportDir: dir });
    },
    conversation,
    getProvider: () => currentProvider,
    cloudConfig,
  });

  const history = new CommandHistory();

  render(
    React.createElement(App, {
      provider,
      model: modelName,
      config: activeConfig,
      conversation,
      systemPrompt,
      tools,
      isCanvasConnected: () => canvas.isConnected,
      getCanvasConnectionStatus: () => canvas.connectionStatus,
      subscribeCanvasConnectionStatus: (listener: Parameters<typeof canvas.subscribeConnectionStatus>[0]) =>
        canvas.subscribeConnectionStatus(listener),
      onSlashCommand,
      onOpenCanvas: async (name: string) => {
        const info = await canvas.open(name);
        return { url: info.url };
      },
      listCanvases: () => canvas.list(),
      getActiveCanvas: () => canvas.activeInfo,
      history,
      workspaceDir,
      onSetProgressCallback: (cb: (message: string) => void) => {
        progressCallback = cb;
      },
      onProviderChange: (newProvider: typeof provider) => {
        currentProvider = newProvider;
      },
      onAfterTurn,
      onListSessions: () => sessionManager.listSessions(),
      onLoadSession: async (path: string) => {
        const result = await sessionManager.loadSession(path);
        await cleanupEmptySession();
        currentSessionPath = path;
        sessionHasMessages = true;
        return result;
      },
    }),
  );

  // Fire-and-forget telemetry ping for cloud users
  if (cloudConfig && process.env.CLARK_TELEMETRY !== "false") {
    fetch(`${cloudConfig.url}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: cloudConfig.clientId,
        version,
        provider: "clark-cloud",
      }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {}); // silent failure
  }
}
