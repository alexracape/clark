/**
 * Status bar component — shows model, canvas connection, and current state.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  provider: string;
  model: string;
  canvasConnected: boolean;
  canvasUrl: string | null;
  canvasName: string | null;
  isThinking: boolean;
}

const SPINNER_FRAMES = [".", "..", "..."];

export function StatusBar({ provider, model, canvasConnected, canvasUrl, canvasName, isThinking }: StatusBarProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isThinking) return;
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 400);
    return () => clearInterval(timer);
  }, [isThinking]);

  return (
    <Box paddingX={1} flexDirection="row" justifyContent="space-between">
      <Text>
        <Text color="blue" bold>{provider}</Text>
        <Text color="gray" dimColor>{"/"}{model}</Text>
      </Text>

      <Box>
        {canvasName ? (
          canvasConnected ? (
            <Text color="green">{"[canvas: "}{canvasName}{" connected]"}</Text>
          ) : (
            <Text color="yellow">{"[canvas: "}{canvasName}{" "}{canvasUrl}{"]"}</Text>
          )
        ) : (
          <Text color="gray" dimColor>{"[no canvas — /canvas to open]"}</Text>
        )}
      </Box>

      <Box width={14}>
        {isThinking && (
          <Text color="cyan">{"thinking"}{SPINNER_FRAMES[frame]}</Text>
        )}
      </Box>
    </Box>
  );
}
