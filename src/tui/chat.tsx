/**
 * Chat message display component.
 *
 * Renders the conversation as a scrollable list of messages
 * with role indicators and basic markdown formatting.
 */

import React from "react";
import { Box, Text } from "ink";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface ChatProps {
  messages: ChatMessage[];
}

function RoleLabel({ role }: { role: ChatMessage["role"] }) {
  switch (role) {
    case "user":
      return <Text color="green" bold>you: </Text>;
    case "assistant":
      return <Text color="blue" bold>clark: </Text>;
    case "system":
      return <Text color="gray" bold>system: </Text>;
  }
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <Box flexDirection="row" marginBottom={1}>
      <RoleLabel role={message.role} />
      <Box flexShrink={1}>
        <Text wrap="wrap">{message.content}</Text>
      </Box>
    </Box>
  );
}

export function Chat({ messages }: ChatProps) {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
    </Box>
  );
}
