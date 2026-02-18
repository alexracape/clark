import React from "react";
import { render } from "ink";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { createTools } from "../mcp/index.ts";
import { Conversation } from "../llm/messages.ts";
import { App } from "../tui/app.tsx";
import { CommandHistory } from "../tui/history.ts";
import { scaffoldLibrary, clarkCanvasDirPath } from "../library.ts";
import { loadConfig, saveConfig } from "../config.ts";
import type { ClarkConfig } from "../config.ts";
import type { CliArgs } from "./args.ts";
import { resolveProvider } from "./provider.ts";
import { loadEffectiveSystemPrompt } from "./system-prompt.ts";
import { CanvasSessionManager } from "../app/canvas-session.ts";
import { createSlashCommandHandler } from "../app/command-router.ts";
import { VisionOCRProvider } from "../ocr/provider.ts";
import { checkPopplerAvailable, getPopplerInstallInstructions } from "../ocr/pdf-renderer.ts";

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
  const workspaceDir = process.cwd();
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

  // Non-blocking poppler check — warn early if PDF OCR won't work
  checkPopplerAvailable().then((available) => {
    if (!available) {
      console.error(
        `\n⚠  pdftoppm (poppler) not found — PDF OCR will not be available.\n   ${getPopplerInstallInstructions()}\n`,
      );
    }
  });

  const conversation = new Conversation();

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
    provider,
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
    }),
  );
}
