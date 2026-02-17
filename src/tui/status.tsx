/**
 * Status bar component — shows model, canvas connection, and current state.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { CanvasConnectionState } from "../app/canvas-session.ts";

export interface StatusBarProps {
  provider: string;
  model: string;
  canvasConnected: boolean;
  canvasStatus?: CanvasConnectionState | null;
  canvasUrl: string | null;
  canvasName: string | null;
  isThinking: boolean;
}

const SPINNER_FRAMES = [".", "..", "..."];

function statusColor(status: CanvasConnectionState): "green" | "yellow" | "cyan" | "red" {
  if (status === "connected") return "green";
  if (status === "connecting") return "cyan";
  if (status === "failed") return "red";
  return "yellow";
}

export function StatusBar({ provider, model, canvasConnected, canvasStatus, canvasUrl, canvasName, isThinking }: StatusBarProps) {
  const [frame, setFrame] = useState(0);
  const effectiveStatus = canvasStatus ?? (canvasConnected ? "connected" : "disconnected");

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
          effectiveStatus === "connected" ? (
            <Text color={statusColor(effectiveStatus)}>{"[canvas: "}{canvasName}{" connected]"}</Text>
          ) : (
            <Text color={statusColor(effectiveStatus)}>
              {"[canvas: "}{canvasName}{" "}{effectiveStatus}
              {canvasUrl ? ` ${canvasUrl}` : ""}
              {"]"}
            </Text>
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
