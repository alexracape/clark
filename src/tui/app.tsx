/**
 * Root TUI application component.
 *
 * Composes the chat, input, and status bar into the full terminal UI.
 * Handles the streaming LLM conversation loop including tool dispatch.
 */

import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { Chat, type ChatMessage } from "./chat.tsx";
import { Input, parseSlashCommand } from "./input.tsx";
import { StatusBar } from "./status.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { CanvasPicker } from "./canvas-picker.tsx";
import { createProvider } from "../llm/provider.ts";
import { setProviderOptions } from "../llm/provider.ts";
import { formatContextGrid } from "./context.ts";
import type { LLMProvider, Tool, StreamChunk } from "../llm/provider.ts";
import { loadConfig, resolveApiKey, resolveMaxToolCallsPerTurn, saveConfig, type ClarkConfig } from "../config.ts";
import { Conversation } from "../llm/messages.ts";
import type { ToolDefinition, ToolResult } from "../mcp/tools.ts";
import type { CommandHistory } from "./history.ts";
import { type Skill, buildSkillPrompt } from "../skills.ts";

export interface AppProps {
  provider: LLMProvider;
  model: string;
  config: ClarkConfig;
  conversation: Conversation;
  systemPrompt: string;
  tools: ToolDefinition[];
  isCanvasConnected: () => boolean;
  onSlashCommand: (name: string, args: string) => Promise<string | null>;
  onOpenCanvas: (name: string) => Promise<{ url: string }>;
  listCanvases: () => Promise<string[]>;
  getActiveCanvas?: () => { name: string; url: string } | null;
  history: CommandHistory;
  skills: Skill[];
}

/** Convert our MCP tool definitions to LLM tool format */
function toLLMTools(tools: ToolDefinition[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(t.inputSchema.properties).map(([key, val]) => [
          key,
          { type: val.type, description: val.description, ...(val.enum ? { enum: val.enum } : {}) },
        ]),
      ),
      required: t.inputSchema.required,
    },
  }));
}

export function App({
  provider,
  model,
  config,
  conversation,
  systemPrompt,
  tools,
  isCanvasConnected,
  onSlashCommand,
  onOpenCanvas,
  listCanvases,
  getActiveCanvas = () => null,
  history,
  skills,
}: AppProps) {
  const maxToolCallsPerTurn = resolveMaxToolCallsPerTurn(config);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "system",
    content: "Welcome to Clark. I'm here to help guide you through your work — not to give you answers. Type a question, or use /help for commands.",
    timestamp: new Date(),
  }]);
  const [streamingText, setStreamingText] = useState<string | undefined>(undefined);
  const [streamingThinking, setStreamingThinking] = useState<string | undefined>(undefined);
  const [isThinking, setIsThinking] = useState(false);

  // Runtime-switchable provider and model
  const [activeProvider, setActiveProvider] = useState<LLMProvider>(provider);
  const [activeModel, setActiveModel] = useState(model);
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Canvas state — starts closed, populated when user opens via /canvas
  const [showCanvasPicker, setShowCanvasPicker] = useState(false);
  const [canvasNames, setCanvasNames] = useState<string[]>([]);

  const addMessage = useCallback((role: ChatMessage["role"], content: string) => {
    setMessages((prev) => [...prev, { role, content, timestamp: new Date() }]);
  }, []);

  /**
   * Run the LLM, streaming text to the UI.
   * Returns the collected chunks and full text when done.
   */
  const streamLLM = useCallback(async (promptOverride?: string): Promise<{ chunks: StreamChunk[]; text: string }> => {
    const llmTools = toLLMTools(tools);
    const chunks: StreamChunk[] = [];
    let text = "";
    let thinking = "";
    const effectivePrompt = promptOverride ?? systemPrompt;

    setStreamingText("");
    setStreamingThinking(undefined);

    for await (const chunk of activeProvider.chat(conversation.getMessages(), llmTools, effectivePrompt)) {
      chunks.push(chunk);
      if (chunk.type === "thinking_delta") {
        thinking += chunk.text;
        setStreamingThinking(thinking);
      } else if (chunk.type === "text_delta") {
        text += chunk.text;
        setStreamingText(text);
      }
    }

    setStreamingText(undefined);
    setStreamingThinking(undefined);
    return { chunks, text };
  }, [activeProvider, conversation, tools, systemPrompt]);

  /**
   * Dispatch a tool call and return the result.
   */
  const dispatchTool = useCallback(async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    return tool.handler(input);
  }, [tools]);

  /**
   * Full conversation turn: stream LLM → handle tool calls → loop until done.
   */
  const runConversationTurn = useCallback(async (promptOverride?: string) => {
    setIsThinking(true);

    try {
      let continueLoop = true;
      let toolCallsUsed = 0;

      while (continueLoop) {
        const { chunks, text } = await streamLLM(promptOverride);
        const stopReason = [...chunks].reverse().find((c) => c.type === "done")?.stopReason;

        // Collect the assistant message content
        const assistantContent = conversation.collectStreamResponse(chunks);
        conversation.addAssistantMessage(assistantContent);

        // Check if there are tool calls
        const toolUses = assistantContent.filter((c) => c.type === "tool_use");

        if (toolUses.length === 0) {
          // No tool calls — show the final text and stop
          if (text) addMessage("assistant", text);
          if (stopReason === "max_tokens") {
            addMessage("system", "Response was truncated due to max_tokens limit. Set \"maxTokens\" in ~/.clark/config.json to increase.");
          }
          continueLoop = false;
        } else {
          // Show any text before tool calls
          if (text) addMessage("assistant", text);

          if (toolCallsUsed + toolUses.length > maxToolCallsPerTurn) {
            const msg = `Stopped: max tool calls per turn reached (${maxToolCallsPerTurn}).`;
            addMessage("system", msg);
            for (const toolUse of toolUses) {
              if (toolUse.type !== "tool_use") continue;
              conversation.addToolResult(toolUse.id, msg, true);
            }
            continueLoop = false;
            continue;
          }

          // Dispatch each tool call
          for (const toolUse of toolUses) {
            if (toolUse.type !== "tool_use") continue;

            addMessage("system", `Using tool: ${toolUse.name}`);

            const result = await dispatchTool(toolUse.name, toolUse.input);
            const resultText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");

            const imageBlocks = result.content.filter(
              (c): c is { type: "image"; data: string; mediaType: "image/png" | "image/jpeg" | "image/webp" } => c.type === "image",
            );

            if (imageBlocks.length > 0 && activeProvider.name === "anthropic") {
              // Anthropic supports images natively in tool results
              conversation.addToolResultWithImage(
                toolUse.id,
                imageBlocks.map((img) => ({ data: img.data, mediaType: img.mediaType })),
              );
            } else {
              // Text-only tool result for all providers
              conversation.addToolResult(toolUse.id, resultText, result.isError);

              // Re-inject images as a follow-up user message for non-Anthropic providers
              if (imageBlocks.length > 0 && activeProvider.name !== "anthropic") {
                for (const img of imageBlocks) {
                  conversation.addUserImageMessage(
                    `[Image from tool: ${toolUse.name}]`,
                    img.data,
                    img.mediaType,
                  );
                }
              }
            }

            toolCallsUsed++;
          }

          // Loop: send tool results back to the LLM
        }
      }
    } catch (err) {
      setStreamingText(undefined);
      const msg = err instanceof Error ? err.message : String(err);
      addMessage("system", `Error: ${msg}`);
    } finally {
      setIsThinking(false);
    }
  }, [streamLLM, conversation, dispatchTool, addMessage, maxToolCallsPerTurn]);

  /** Handle model selection from the picker */
  const handleModelSelect = useCallback(async (providerName: string, modelName: string) => {
    try {
      let ollamaVision = false;

      // Ollama preflight: verify server is reachable
      if (providerName === "ollama") {
        const { checkModelFits } = await import("../llm/ollama.ts");
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
        ...(currentConfig.maxTokens ? { maxTokens: currentConfig.maxTokens } : {}),
        ...(providerName === "ollama" ? { supportsVision: ollamaVision } : {}),
      });
      const newProvider = createProvider(providerName, modelName);
      setActiveProvider(newProvider);
      setActiveModel(modelName);
      setShowModelPicker(false);
      const note = providerName === "ollama"
        ? ` (first message may be slow while Ollama loads the model)`
        : "";
      addMessage("system", `Switched to ${providerName}/${modelName}${note}`);

      // Persist selection so it's the default next launch
      await saveConfig({ ...currentConfig, provider: providerName, model: modelName });
    } catch (err) {
      setShowModelPicker(false);
      const msg = err instanceof Error ? err.message : String(err);
      addMessage("system", `Failed to switch model: ${msg}`);
    }
  }, [addMessage]);

  /** Handle canvas selection from the picker */
  const handleCanvasSelect = useCallback(async (name: string) => {
    setShowCanvasPicker(false);
    try {
      const { url } = await onOpenCanvas(name);
      addMessage("system", `Canvas "${name}" opened at ${url}\nOpen this on your iPad to start drawing.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addMessage("system", `Failed to open canvas: ${msg}`);
    }
  }, [onOpenCanvas, addMessage]);

  const handleSubmit = useCallback(async (text: string) => {
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

      // Intercept /context — needs activeModel from component state
      if (command.name === "context") {
        addMessage("system", formatContextGrid(activeModel, conversation, systemPrompt, tools));
        return;
      }

      // Check if this is a skill command (from Clark/Structures/)
      const matchedSkill = skills.find((s) => s.slug === command.name);
      if (matchedSkill) {
        const display = command.args
          ? `Using skill: ${matchedSkill.displayName} — "${command.args}"`
          : `Using skill: ${matchedSkill.displayName}`;
        addMessage("system", display);

        const userText = command.args
          ? `I want to create a ${matchedSkill.displayName}. Context: ${command.args}`
          : `I want to create a ${matchedSkill.displayName}.`;
        conversation.addUserMessage(userText);

        const skillPrompt = systemPrompt + buildSkillPrompt(matchedSkill, command.args);
        await runConversationTurn(skillPrompt);
        return;
      }

      const result = await onSlashCommand(command.name, command.args);
      if (result) addMessage("system", result);
      return;
    }

    // Regular message
    addMessage("user", text);
    conversation.addUserMessage(text);
    await runConversationTurn();
  }, [conversation, runConversationTurn, onSlashCommand, addMessage, activeModel, systemPrompt, tools, skills, listCanvases]);

  const canvasInfo = getActiveCanvas();

  return (
    <Box flexDirection="column">
      <StatusBar
        provider={activeProvider.name}
        model={activeModel}
        canvasConnected={isCanvasConnected()}
        canvasUrl={canvasInfo?.url ?? null}
        canvasName={canvasInfo?.name ?? null}
        isThinking={isThinking}
      />

      <Box marginY={1}>
        <Text color="gray" dimColor>{"─".repeat(60)}</Text>
      </Box>

      <Chat messages={messages} streamingText={streamingText} streamingThinking={streamingThinking} />

      <Box marginTop={1}>
        <Text color="gray" dimColor>{"─".repeat(60)}</Text>
      </Box>

      {showModelPicker ? (
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
        <Input onSubmit={handleSubmit} disabled={isThinking} history={history} />
      )}
    </Box>
  );
}
