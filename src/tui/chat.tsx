/**
 * Chat message display component.
 *
 * Renders the conversation as a list of messages with role indicators.
 * Supports a streaming partial message at the end.
 * Uses markdown rendering for assistant messages.
 */

import React from "react";
import { Box, Text } from "ink";
import { Markdown } from "./markdown.tsx";
import { theme } from "./theme.ts";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface ChatProps {
  messages: ChatMessage[];
  /** Partial streaming text from the assistant (shown below messages) */
  streamingText?: string;
  /** Partial streaming thinking/reasoning from the assistant */
  streamingThinking?: string;
}

function RoleLabel({ role }: { role: ChatMessage["role"] }) {
  switch (role) {
    case "user":
      return <Text>{theme.user("you ")}</Text>;
    case "assistant":
      return <Text>{theme.assistant("clark ")}</Text>;
    case "system":
      return <Text>{theme.system("system ")}</Text>;
  }
}

function MessageContent({ role, content }: { role: ChatMessage["role"]; content: string }) {
  // Render markdown for assistant messages, plain text for others
  if (role === "assistant") {
    try {
      return <Markdown>{content}</Markdown>;
    } catch (error) {
      // Fallback to plain text if markdown fails
      return <Text>{theme.message(content)}</Text>;
    }
  }

  return <Text wrap="wrap">{theme.message(content)}</Text>;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <RoleLabel role={message.role} />
      <Box marginLeft={2} flexDirection="column">
        <MessageContent role={message.role} content={message.content} />
      </Box>
    </Box>
  );
}

export function Chat({ messages, streamingText, streamingThinking }: ChatProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}

      {streamingThinking !== undefined && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{theme.thinking("thinking ")}</Text>
          <Box marginLeft={2}>
            <Text wrap="wrap">{theme.dim(streamingThinking)}</Text>
          </Box>
        </Box>
      )}

      {streamingText !== undefined && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{theme.assistant("clark ")}</Text>
          <Box marginLeft={2}>
            <Text wrap="wrap">
              {theme.message(streamingText)}
              {theme.cursor("_")}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
