import React from "react";
import { render } from "ink";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { createTools } from "../mcp/index.ts";
import { Conversation } from "../llm/messages.ts";
import { App } from "../tui/app.tsx";
import { CommandHistory } from "../tui/history.ts";
import { registerCommands } from "../tui/input.tsx";
import { loadSkills } from "../skills.ts";
import { scaffoldLibrary, clarkCanvasDirPath } from "../library.ts";
import { loadConfig, saveConfig } from "../config.ts";
import type { ClarkConfig } from "../config.ts";
import type { CliArgs } from "./args.ts";
import { resolveProvider } from "./provider.ts";
import { loadEffectiveSystemPrompt } from "./system-prompt.ts";
import { CanvasSessionManager } from "../app/canvas-session.ts";
import { createSlashCommandHandler } from "../app/command-router.ts";

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
  });

  const conversation = new Conversation();
  const skills = await loadSkills(workspaceDir);
  if (skills.length > 0) {
    registerCommands(skills.map((s) => ({ name: s.slug, description: s.description })));
  }

  const tools = createTools({
    getBroker: () => canvas.broker,
    getVaultDir: () => workspaceDir,
    getExportDir: () => exportDir,
    getSaveCanvas: () => canvas.saveCanvas,
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
    skills,
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
      onSlashCommand,
      onOpenCanvas: async (name: string) => {
        const info = await canvas.open(name);
        return { url: info.url };
      },
      listCanvases: () => canvas.list(),
      getActiveCanvas: () => canvas.activeInfo,
      history,
      skills,
    }),
  );
}
