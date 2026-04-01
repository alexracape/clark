/**
 * Root TUI application component.
 *
 * Composes the chat, input, and status bar into the full terminal UI.
 * Delegates the conversation turn loop to the shared ConversationEngine.
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text, useApp } from "ink";
import { Chat, type ChatMessage } from "./chat.tsx";
import { Input, parseSlashCommand } from "./input.tsx";
import { StatusBar } from "./status.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { CanvasPicker } from "./canvas-picker.tsx";
import { Tutorial } from "./tutorial.tsx";
import { createProvider } from "../../core/llm/provider.ts";
import { setProviderOptions } from "../../core/llm/provider.ts";
import { formatContextGrid } from "./context.ts";
import type { LLMProvider } from "../../core/llm/provider.ts";
import {
  loadConfig,
  resolveApiKey,
  resolveMaxToolCallsPerTurn,
  saveConfig,
  type ClarkConfig,
} from "../../core/config.ts";
import { Conversation } from "../../core/llm/messages.ts";
import type { ToolDefinition } from "../../core/mcp/tools.ts";
import type { CommandHistory } from "../../core/history.ts";
import { detectFilePath, copyFileToResources } from "../../core/app/ingest.ts";
import type { CanvasConnectionStatus } from "../../core/app/canvas-session.ts";
import { theme } from "./theme.ts";
import { ConversationEngine, type TurnCallbacks } from "../../core/engine.ts";
import { SessionPicker } from "./session-picker.tsx";
import type { SessionInfo } from "../../core/sessions/index.ts";
import type { Message } from "../../core/llm/provider.ts";

export interface AppProps {
  provider: LLMProvider;
  model: string;
  config: ClarkConfig;
  conversation: Conversation;
  systemPrompt: string;
  tools: ToolDefinition[];
  isCanvasConnected: () => boolean;
  getCanvasConnectionStatus?: () => CanvasConnectionStatus;
  subscribeCanvasConnectionStatus?: (
    listener: (status: CanvasConnectionStatus) => void,
  ) => () => void;
  onSlashCommand: (name: string, args: string) => Promise<string | null>;
  onOpenCanvas: (name: string) => Promise<{ url: string }>;
  listCanvases: () => Promise<string[]>;
  getActiveCanvas?: () => { name: string; url: string } | null;
  history: CommandHistory;
  workspaceDir: string;
  /** Called once on mount so tool progress messages appear in the TUI. */
  onSetProgressCallback?: (cb: (message: string) => void) => void;
  /** Called when the user switches providers, so OCR uses the current one. */
  onProviderChange?: (provider: LLMProvider) => void;
  /** Called after each turn with the new messages, for session persistence. */
  onAfterTurn?: (newMessages: Message[]) => void;
  /** List available sessions for /resume. */
  onListSessions?: () => Promise<SessionInfo[]>;
  /** Load a session by file path — returns frontmatter and messages. */
  onLoadSession?: (path: string) => Promise<{ messages: Message[] }>;
}

export function App({
  provider,
  model,
  config,
  conversation,
  systemPrompt,
  tools,
  isCanvasConnected,
  getCanvasConnectionStatus,
  subscribeCanvasConnectionStatus,
  onSlashCommand,
  onOpenCanvas,
  listCanvases,
  getActiveCanvas = () => null,
  history,
  workspaceDir,
  onSetProgressCallback,
  onProviderChange,
  onAfterTurn,
  onListSessions,
  onLoadSession,
}: AppProps) {
  const { exit } = useApp();
  const maxToolCallsPerTurn = resolveMaxToolCallsPerTurn(config);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "system",
      content:
        "Welcome to Clark. I'm here to help you with homework, managing your notes, and learning in general. Type a question, or use /help for commands.",
      timestamp: new Date(),
    },
  ]);
  const [streamingText, setStreamingText] = useState<string | undefined>(
    undefined,
  );
  const [streamingThinking, setStreamingThinking] = useState<
    string | undefined
  >(undefined);
  const [isThinking, setIsThinking] = useState(false);

  // Runtime-switchable provider and model
  const [activeProvider, setActiveProvider] = useState<LLMProvider>(provider);
  const [activeModel, setActiveModel] = useState(model);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Canvas state — starts closed, populated when user opens via /canvas
  const [showCanvasPicker, setShowCanvasPicker] = useState(false);
  const [canvasNames, setCanvasNames] = useState<string[]>([]);
  const [canvasConnectionStatus, setCanvasConnectionStatus] =
    useState<CanvasConnectionStatus | null>(
      getCanvasConnectionStatus ? getCanvasConnectionStatus() : null,
    );

  // Session picker state — shown when user types /resume
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [sessionList, setSessionList] = useState<SessionInfo[]>([]);

  // Conversation engine — shared turn loop logic
  const engine = useMemo(
    () =>
      new ConversationEngine({
        conversation,
        tools,
        systemPrompt,
        maxToolCallsPerTurn,
      }),
    [],
  );

  // Keep engine in sync when tools or system prompt change
  useEffect(() => {
    engine.setTools(tools);
  }, [engine, tools]);

  useEffect(() => {
    engine.setSystemPrompt(systemPrompt);
  }, [engine, systemPrompt]);

  useEffect(() => {
    if (!subscribeCanvasConnectionStatus) return;
    return subscribeCanvasConnectionStatus((status) => {
      setCanvasConnectionStatus(status);
    });
  }, [subscribeCanvasConnectionStatus]);

  const addMessage = useCallback(
    (role: ChatMessage["role"], content: string) => {
      setMessages((prev) => [
        ...prev,
        { role, content, timestamp: new Date() },
      ]);
    },
    [],
  );

  // Wire progress callback so MCP tools can emit inline status messages
  useEffect(() => {
    onSetProgressCallback?.((msg) => addMessage("system", msg));
  }, [addMessage, onSetProgressCallback]);

  /** Build TurnCallbacks that wire engine events to React state */
  const makeTurnCallbacks = useCallback(
    (): TurnCallbacks => ({
      onStreamingText: (t) => setStreamingText(t),
      onStreamingThinking: (t) => setStreamingThinking(t),
      onStreamingDone: () => {
        setStreamingText(undefined);
        setStreamingThinking(undefined);
      },
      onAssistantMessage: (t) => addMessage("assistant", t),
      onToolStart: (name) => addMessage("system", `Using tool: ${name}`),
      onSystemMessage: (msg) => addMessage("system", msg),
    }),
    [addMessage],
  );

  /** Run a conversation turn via the engine, then persist new messages. */
  const runConversationTurn = useCallback(
    async (promptOverride?: string, prevCount = conversation.getMessages().length) => {
      setIsThinking(true);
      try {
        await engine.runTurn(activeProvider, makeTurnCallbacks(), promptOverride);
        const newMessages = conversation.getMessages().slice(prevCount);
        if (newMessages.length > 0) onAfterTurn?.(newMessages);
      } finally {
        setIsThinking(false);
      }
    },
    [engine, activeProvider, makeTurnCallbacks, conversation, onAfterTurn],
  );

  /** Handle model selection from the picker */
  const handleModelSelect = useCallback(
    async (providerName: string, modelName: string) => {
      try {
        let ollamaVision = false;

        // Ollama preflight: verify server is reachable
        if (providerName === "ollama") {
          const { checkModelFits } = await import("../../core/llm/ollama.ts");
          const result = await checkModelFits(modelName);
          ollamaVision = result.supportsVision;
        }

        const currentConfig = await loadConfig();
        const apiKey = await resolveApiKey(providerName, currentConfig);
        if (providerName !== "ollama" && !apiKey) {
          throw new Error(`Missing API key for provider "${providerName}".`);
        }
        setProviderOptions(providerName, {
          ...(apiKey ? { apiKey } : {}),
          ...(currentConfig.maxTokens
            ? { maxTokens: currentConfig.maxTokens }
            : {}),
          ...(providerName === "ollama"
            ? { supportsVision: ollamaVision }
            : {}),
        });
        const newProvider = createProvider(providerName, modelName);
        setActiveProvider(newProvider);
        onProviderChange?.(newProvider);
        setActiveModel(modelName);
        setShowModelPicker(false);
        const note =
          providerName === "ollama"
            ? ` (first message may be slow while Ollama loads the model)`
            : "";
        addMessage("system", `Switched to ${providerName}/${modelName}${note}`);

        // Persist selection so it's the default next launch
        await saveConfig({
          ...currentConfig,
          provider: providerName,
          model: modelName,
        });
      } catch (err) {
        setShowModelPicker(false);
        const msg = err instanceof Error ? err.message : String(err);
        addMessage("system", `Failed to switch model: ${msg}`);
      }
    },
    [addMessage],
  );

  /** Handle session selection from the /resume picker */
  const handleSessionSelect = useCallback(
    async (session: SessionInfo) => {
      setShowSessionPicker(false);
      if (!onLoadSession) return;
      try {
        const { messages } = await onLoadSession(session.path);
        conversation.loadMessages(messages);
        const label = session.title?.trim()
          ? `Resumed session "${session.title}" (${messages.length} messages loaded).`
          : `Resumed session from ${session.date} (${messages.length} messages loaded).`;
        addMessage(
          "system",
          label,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addMessage("system", `Failed to load session: ${msg}`);
      }
    },
    [onLoadSession, conversation, addMessage],
  );

  /** Handle canvas selection from the picker */
  const handleCanvasSelect = useCallback(
    async (name: string) => {
      setShowCanvasPicker(false);
      try {
        const { url } = await onOpenCanvas(name);
        addMessage(
          "system",
          `Canvas "${name}" opened at ${url}\nOpen this on your iPad to start drawing.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addMessage("system", `Failed to open canvas: ${msg}`);
      }
    },
    [onOpenCanvas, addMessage],
  );

  const handleSubmit = useCallback(
    async (text: string) => {
      // Check if the input is a file path first (e.g., dragged from Finder).
      // This runs before slash command parsing because absolute paths like
      // /Users/alex/file.pdf would be misinterpreted as a "/Users" command.
      const filePath = await detectFilePath(text);
      if (filePath) {
        setIsThinking(true);
        try {
          const result = await copyFileToResources(filePath, workspaceDir);
          addMessage("system", result.summary);
          // Let the model decide how to process the file using MCP tools
          const prevCount = conversation.getMessages().length;
          conversation.addUserMessage(
            `I've added a file to my vault: ${result.fileName} (${result.fileSize}, saved to ${result.destPath}). ` +
              `Please check what type of file it is and process it appropriately — ` +
              `use read_file to inspect it, and if it's a scanned PDF with little extractable text, ` +
              `use transcribe_pdf to OCR it. Save any transcripts where they make sense based on my vault structure.`,
          );
          await runConversationTurn(undefined, prevCount);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addMessage("system", `Failed to copy file: ${msg}`);
        } finally {
          setIsThinking(false);
        }
        return;
      }

      // Check for slash command
      const command = parseSlashCommand(text);
      if (command) {
        // Intercept /canvas with no args to show the picker.
        if (command.name === "canvas" && !command.args) {
          const names = await listCanvases();
          setCanvasNames(names);
          setShowCanvasPicker(true);
          return;
        }

        // Intercept /model to show the picker
        if (command.name === "model") {
          setShowModelPicker(true);
          return;
        }

        // Intercept /resume to show the session picker
        if (command.name === "resume") {
          if (!onListSessions) {
            addMessage("system", "Session resumption is not available.");
            return;
          }
          const sessions = await onListSessions();
          if (sessions.length === 0) {
            addMessage("system", "No saved sessions found.");
            return;
          }
          setSessionList(sessions);
          setShowSessionPicker(true);
          return;
        }

        // Intercept /tutorial to show the tutorial modal
        if (command.name === "tutorial") {
          setShowTutorial(true);
          return;
        }

        // Intercept /context — needs activeModel from component state
        if (command.name === "context") {
          addMessage(
            "system",
            formatContextGrid(activeModel, conversation, systemPrompt, tools),
          );
          return;
        }

        const result = await onSlashCommand(command.name, command.args);
        if (result === "__EXIT__") {
          exit();
          return;
        }
        if (result) addMessage("system", result);
        return;
      }

      // Regular message
      addMessage("user", text);
      const canvasState = canvasConnectionStatus?.state ?? "disconnected";
      const activeCanvas = getActiveCanvas();
      const canvasTag = activeCanvas
        ? `Canvas state: ${canvasState} (${activeCanvas.name})`
        : `Canvas state: ${canvasState}`;
      const prevCount = conversation.getMessages().length;
      conversation.addUserMessage(`${canvasTag}\n\n${text}`);
      await runConversationTurn(undefined, prevCount);
    },
    [
      conversation,
      runConversationTurn,
      onSlashCommand,
      addMessage,
      activeModel,
      activeProvider,
      systemPrompt,
      tools,
      listCanvases,
      workspaceDir,
      exit,
      onListSessions,
    ],
  );

  const canvasInfo = getActiveCanvas();
  const canvasConnected = canvasConnectionStatus
    ? canvasConnectionStatus.state === "connected"
    : isCanvasConnected();
  const canvasStatus = canvasConnectionStatus?.state ?? null;

  return (
    <Box flexDirection="column">
      <StatusBar
        provider={activeProvider.name}
        model={activeModel}
        canvasConnected={canvasConnected}
        canvasStatus={canvasStatus}
        canvasUrl={canvasInfo?.url ?? null}
        canvasName={canvasInfo?.name ?? null}
        isThinking={isThinking}
      />

      <Box marginY={1}>
        <Text>{theme.divider("─".repeat(60))}</Text>
      </Box>

      <Chat
        messages={messages}
        streamingText={streamingText}
        streamingThinking={streamingThinking}
      />

      <Box marginTop={1}>
        <Text>{theme.divider("─".repeat(60))}</Text>
      </Box>

      {showSessionPicker ? (
        <SessionPicker
          sessions={sessionList}
          onSelect={handleSessionSelect}
          onCancel={() => setShowSessionPicker(false)}
        />
      ) : showTutorial ? (
        <Tutorial
          onComplete={() => {
            setShowTutorial(false);
            loadConfig().then((cfg) =>
              saveConfig({
                ...cfg,
                tutorialProgress: {
                  completed: true,
                  lastCompletedAt: new Date().toISOString(),
                },
              }),
            );
            addMessage(
              "system",
              "Tutorial complete! Type /help to see all commands.",
            );
          }}
          onSkip={() => {
            setShowTutorial(false);
            addMessage(
              "system",
              "Tutorial skipped. Type /tutorial to restart anytime.",
            );
          }}
        />
      ) : showModelPicker ? (
        <ModelPicker
          currentProvider={activeProvider.name}
          currentModel={activeModel}
          config={config}
          onSelect={handleModelSelect}
          onCancel={() => setShowModelPicker(false)}
        />
      ) : showCanvasPicker ? (
        <CanvasPicker
          existingCanvases={canvasNames}
          onSelect={handleCanvasSelect}
          onCancel={() => setShowCanvasPicker(false)}
        />
      ) : (
        <Input
          onSubmit={handleSubmit}
          disabled={isThinking}
          history={history}
        />
      )}
    </Box>
  );
}
