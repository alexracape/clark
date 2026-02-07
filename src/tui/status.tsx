/**
 * Status bar component — shows model, canvas connection, and current state.
 */

import React from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  provider: string;
  model: string;
  canvasConnected: boolean;
  canvasUrl: string;
  isThinking: boolean;
}

export function StatusBar({ provider, model, canvasConnected, canvasUrl, isThinking }: StatusBarProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="row" justifyContent="space-between">
      <Text>
        <Text color="blue">{provider}</Text>
        <Text color="gray">/{model}</Text>
      </Text>

      <Text>
        {canvasConnected ? (
          <Text color="green">canvas: connected</Text>
        ) : (
          <Text color="yellow">canvas: {canvasUrl}</Text>
        )}
      </Text>

      {isThinking && <Text color="cyan">thinking...</Text>}
    </Box>
  );
}
