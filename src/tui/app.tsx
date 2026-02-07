/**
 * Root TUI application component.
 *
 * Composes the chat, input, and status bar into the full terminal UI.
 * Manages conversation state and dispatches to the LLM + MCP tools.
 */

import React, { useState, useCallback } from "react";
import { Box } from "ink";
import { Chat, type ChatMessage } from "./chat.tsx";
import { Input, parseSlashCommand } from "./input.tsx";
import { StatusBar } from "./status.tsx";

export interface AppProps {
  provider: string;
  model: string;
  canvasUrl: string;
  canvasConnected: boolean;
  onMessage: (text: string) => Promise<string>;
  onSlashCommand: (name: string, args: string) => Promise<string | null>;
}

export function App({
  provider,
  model,
  canvasUrl,
  canvasConnected,
  onMessage,
  onSlashCommand,
}: AppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "system",
      content: "Welcome to Clark! I'm your Socratic tutor. Show me what you're working on and I'll help guide you through it.",
      timestamp: new Date(),
    },
  ]);
  const [isThinking, setIsThinking] = useState(false);

  const handleSubmit = useCallback(
    async (text: string) => {
      // Check for slash command
      const command = parseSlashCommand(text);
      if (command) {
        const result = await onSlashCommand(command.name, command.args);
        if (result) {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: result, timestamp: new Date() },
          ]);
        }
        return;
      }

      // Regular message — send to LLM
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, timestamp: new Date() },
      ]);
      setIsThinking(true);

      try {
        const response = await onMessage(text);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: response, timestamp: new Date() },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsThinking(false);
      }
    },
    [onMessage, onSlashCommand],
  );

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar
        provider={provider}
        model={model}
        canvasConnected={canvasConnected}
        canvasUrl={canvasUrl}
        isThinking={isThinking}
      />

      <Chat messages={messages} />

      <Input onSubmit={handleSubmit} disabled={isThinking} />
    </Box>
  );
}
