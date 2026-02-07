/**
 * User input component — text input with slash command detection.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface InputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export interface SlashCommand {
  name: string;
  args: string;
}

/**
 * Parse a slash command from input text.
 * Returns null if the text is not a slash command.
 */
export function parseSlashCommand(text: string): SlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { name: trimmed.slice(1), args: "" };
  }
  return {
    name: trimmed.slice(1, spaceIndex),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

export function Input({ onSubmit, disabled = false, placeholder = "Type a message..." }: InputProps) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue("");
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box borderStyle="round" borderColor={disabled ? "gray" : "green"} paddingX={1}>
      <Text color={disabled ? "gray" : "white"}>
        {value || (disabled ? "waiting..." : placeholder)}
      </Text>
    </Box>
  );
}
