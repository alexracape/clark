/**
 * Status bar component — shows model, canvas connection, and current state.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { CanvasConnectionState } from "../app/canvas-session.ts";
import { theme, componentTheme, hex } from "./theme.ts";
import chalk from "chalk";

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

function statusColorHex(status: CanvasConnectionState): string {
  if (status === "connected") return hex.sage;
  if (status === "connecting") return hex.thinkingSpinner;
  if (status === "failed") return hex.error;
  return hex.brass; // Yellow/brass for disconnected
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
        {componentTheme.statusBar.provider(provider)}
        {componentTheme.statusBar.separator(`/${model}`)}
      </Text>

      <Box>
        {canvasName ? (
          effectiveStatus === "connected" ? (
            <Text color={statusColorHex(effectiveStatus)}>
              {"[canvas: "}{canvasName}{" connected]"}
            </Text>
          ) : (
            <Text color={statusColorHex(effectiveStatus)}>
              {"[canvas: "}{canvasName}{" "}{effectiveStatus}
              {canvasUrl ? ` ${canvasUrl}` : ""}
              {"]"}
            </Text>
          )
        ) : (
          <Text>{theme.dim("[no canvas — /canvas to open]")}</Text>
        )}
      </Box>

      <Box width={14}>
        {isThinking && (
          <Text>{theme.spinner(`thinking${SPINNER_FRAMES[frame]}`)}</Text>
        )}
      </Box>
    </Box>
  );
}
