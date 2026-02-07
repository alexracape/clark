/**
 * Chat message display component.
 *
 * Renders the conversation as a list of messages with role indicators.
 * Supports a streaming partial message at the end.
 */

import React from "react";
import { Box, Text, Newline } from "ink";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface ChatProps {
  messages: ChatMessage[];
  /** Partial streaming text from the assistant (shown below messages) */
  streamingText?: string;
}

function RoleLabel({ role }: { role: ChatMessage["role"] }) {
  switch (role) {
    case "user":
      return <Text color="green" bold>{"you "}</Text>;
    case "assistant":
      return <Text color="blue" bold>{"clark "}</Text>;
    case "system":
      return <Text color="gray" dimColor>{"system "}</Text>;
  }
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <RoleLabel role={message.role} />
      <Box marginLeft={2} flexDirection="column">
        <Text wrap="wrap">{message.content}</Text>
      </Box>
    </Box>
  );
}

export function Chat({ messages, streamingText }: ChatProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}

      {streamingText !== undefined && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="blue" bold>{"clark "}</Text>
          <Box marginLeft={2}>
            <Text wrap="wrap">{streamingText}<Text color="cyan">{"_"}</Text></Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
