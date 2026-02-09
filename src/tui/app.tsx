/**
 * Root TUI application component.
 *
 * Composes the chat, input, and status bar into the full terminal UI.
 * Handles the streaming LLM conversation loop including tool dispatch.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, Newline } from "ink";
import { Chat, type ChatMessage } from "./chat.tsx";
import { Input, parseSlashCommand } from "./input.tsx";
import { StatusBar } from "./status.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { createProvider } from "../llm/provider.ts";
import { formatContextGrid } from "./context.ts";
import type { LLMProvider, Tool, StreamChunk, MessageContent } from "../llm/provider.ts";
import { loadConfig, saveConfig, type ClarkConfig } from "../config.ts";
import { Conversation } from "../llm/messages.ts";
import type { ToolDefinition, ToolResult } from "../mcp/tools.ts";

export interface AppProps {
  provider: LLMProvider;
  model: string;
  config: ClarkConfig;
  conversation: Conversation;
  systemPrompt: string;
  tools: ToolDefinition[];
  canvasUrl: string;
  isCanvasConnected: () => boolean;
  onSlashCommand: (name: string, args: string) => Promise<string | null>;
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
  canvasUrl,
  isCanvasConnected,
  onSlashCommand,
}: AppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "system",
    content: "Welcome to Clark. I'm here to help guide you through your work — not to give you answers. Type a question, or use /help for commands.",
    timestamp: new Date(),
  }]);
  const [streamingText, setStreamingText] = useState<string | undefined>(undefined);
  const [isThinking, setIsThinking] = useState(false);

  // Runtime-switchable provider and model
  const [activeProvider, setActiveProvider] = useState<LLMProvider>(provider);
  const [activeModel, setActiveModel] = useState(model);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const addMessage = useCallback((role: ChatMessage["role"], content: string) => {
    setMessages((prev) => [...prev, { role, content, timestamp: new Date() }]);
  }, []);

  /**
   * Run the LLM, streaming text to the UI.
   * Returns the collected chunks and full text when done.
   */
  const streamLLM = useCallback(async (): Promise<{ chunks: StreamChunk[]; text: string }> => {
    const llmTools = toLLMTools(tools);
    const chunks: StreamChunk[] = [];
    let text = "";

    setStreamingText("");

    for await (const chunk of activeProvider.chat(conversation.getMessages(), llmTools, systemPrompt)) {
      chunks.push(chunk);
      if (chunk.type === "text_delta") {
        text += chunk.text;
        setStreamingText(text);
      }
    }

    setStreamingText(undefined);
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
  const runConversationTurn = useCallback(async () => {
    setIsThinking(true);

    try {
      let continueLoop = true;

      while (continueLoop) {
        const { chunks, text } = await streamLLM();

        // Collect the assistant message content
        const assistantContent = conversation.collectStreamResponse(chunks);
        conversation.addAssistantMessage(assistantContent);

        // Check if there are tool calls
        const toolUses = assistantContent.filter((c) => c.type === "tool_use");

        if (toolUses.length === 0) {
          // No tool calls — show the final text and stop
          if (text) addMessage("assistant", text);
          continueLoop = false;
        } else {
          // Show any text before tool calls
          if (text) addMessage("assistant", text);

          // Dispatch each tool call
          for (const toolUse of toolUses) {
            if (toolUse.type !== "tool_use") continue;

            addMessage("system", `Using tool: ${toolUse.name}`);

            const result = await dispatchTool(toolUse.name, toolUse.input);
            const resultText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");

            conversation.addToolResult(toolUse.id, resultText, result.isError);
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
  }, [streamLLM, conversation, dispatchTool, addMessage]);

  /** Handle model selection from the picker */
  const handleModelSelect = useCallback(async (providerName: string, modelName: string) => {
    try {
      // Ollama preflight: verify server is reachable
      if (providerName === "ollama") {
        const { checkModelFits } = await import("../llm/ollama.ts");
        await checkModelFits(modelName);
      }

      const newProvider = createProvider(providerName, modelName);
      setActiveProvider(newProvider);
      setActiveModel(modelName);
      setShowModelPicker(false);
      const note = providerName === "ollama"
        ? ` (first message may be slow while Ollama loads the model)`
        : "";
      addMessage("system", `Switched to ${providerName}/${modelName}${note}`);

      // Persist selection so it's the default next launch
      const currentConfig = await loadConfig();
      await saveConfig({ ...currentConfig, provider: providerName, model: modelName });
    } catch (err) {
      setShowModelPicker(false);
      const msg = err instanceof Error ? err.message : String(err);
      addMessage("system", `Failed to switch model: ${msg}`);
    }
  }, [addMessage]);

  const handleSubmit = useCallback(async (text: string) => {
    // Check for slash command
    const command = parseSlashCommand(text);
    if (command) {
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

      const result = await onSlashCommand(command.name, command.args);
      if (result) addMessage("system", result);
      return;
    }

    // Regular message
    addMessage("user", text);
    conversation.addUserMessage(text);
    await runConversationTurn();
  }, [conversation, runConversationTurn, onSlashCommand, addMessage, activeModel, systemPrompt, tools]);

  return (
    <Box flexDirection="column">
      <StatusBar
        provider={activeProvider.name}
        model={activeModel}
        canvasConnected={isCanvasConnected()}
        canvasUrl={canvasUrl}
        isThinking={isThinking}
      />

      <Box marginY={1}>
        <Text color="gray" dimColor>{"─".repeat(60)}</Text>
      </Box>

      <Chat messages={messages} streamingText={streamingText} />

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
      ) : (
        <Input onSubmit={handleSubmit} disabled={isThinking} />
      )}
    </Box>
  );
}
