/**
 * Session picker — shown when the user types /resume.
 *
 * Displays past sessions newest-first with date and first-message preview.
 * Up/down to navigate, Enter to load, Escape to cancel.
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { useSelectableList } from "./primitives/use-selectable-list.ts";
import { theme, componentTheme, hex } from "./theme.ts";
import type { SessionInfo } from "../../core/sessions/index.ts";

export interface SessionPickerProps {
  sessions: SessionInfo[];
  onSelect: (session: SessionInfo) => void;
  onCancel: () => void;
}

export function SessionPicker({
  sessions,
  onSelect,
  onCancel,
}: SessionPickerProps) {
  const list = useSelectableList(sessions.length);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      list.moveUp();
      return;
    }
    if (key.downArrow) {
      list.moveDown();
      return;
    }
    if (key.return) {
      const session = sessions[list.selected];
      if (session) onSelect(session);
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Resume session:</Text>
      <Text> </Text>

      {sessions.length === 0 ? (
        <Box paddingLeft={2}>
          <Text>{theme.dim("No saved sessions found.")}</Text>
        </Box>
      ) : (
        sessions.map((session, i) => {
          const selected = i === list.selected;
          const preview = session.firstUserMessage
            ? `"${session.firstUserMessage}${session.firstUserMessage.length >= 80 ? "…" : ""}"`
            : theme.dim("(empty session)");
          return (
            <Box key={session.path} paddingLeft={2} flexDirection="column">
              <Text>
                {selected
                  ? componentTheme.hints.selected("> ")
                  : componentTheme.hints.unselected("  ")}
                {selected
                  ? theme.selectedText(session.date)
                  : theme.dim(session.date)}
                {" "}
                <Text color={hex.dim}>
                  {session.provider}/{session.model}
                </Text>
              </Text>
              {selected && (
                <Box paddingLeft={4}>
                  <Text>{theme.dim(preview)}</Text>
                </Box>
              )}
            </Box>
          );
        })
      )}

      <Text> </Text>
      <Text>
        {theme.dim("  ↑↓")} navigate{"  "}
        {theme.dim("enter")} resume{"  "}
        {theme.dim("esc")} cancel
      </Text>
    </Box>
  );
}
