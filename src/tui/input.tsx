/**
 * User input component — text input with slash command hints and cursor.
 */

import React, { useState, useRef, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";

export interface InputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export interface SlashCommand {
  name: string;
  args: string;
}

/** All available slash commands with descriptions */
export const COMMANDS = [
  { name: "help", description: "Show available commands" },
  { name: "canvas", description: "Show canvas URL for iPad" },
  { name: "export", description: "Export canvas as A4 PDF" },
  { name: "save", description: "Save canvas state to disk" },
  { name: "notes", description: "Set notes directory" },
  { name: "model", description: "Switch model and provider" },
  { name: "context", description: "Show context window usage" },
  { name: "compact", description: "Summarize conversation to save context" },
  { name: "clear", description: "Clear conversation history" },
] as const;

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

export function Input({ onSubmit, disabled = false }: InputProps) {
  // Refs track the "true" value/cursor synchronously so rapid keystrokes
  // between React renders always see the latest state.
  const valueRef = useRef("");
  const cursorRef = useRef(0);
  const [value, _setValue] = useState("");
  const [cursor, _setCursor] = useState(0);
  const [hintIndex, setHintIndex] = useState(0);
  const { exit } = useApp();

  /** Update value — keeps ref and state in sync. */
  const setValue = (v: string) => {
    valueRef.current = v;
    _setValue(v);
  };

  /** Update cursor — keeps ref and state in sync. */
  const setCursor = (c: number) => {
    cursorRef.current = c;
    _setCursor(c);
  };

  // Filter commands based on what the user has typed after "/"
  const matchingCommands = useMemo(() => {
    if (!value.startsWith("/")) return [];
    const partial = value.slice(1);
    // Don't show hints if they've already typed a space (entering args)
    if (partial.includes(" ")) return [];
    if (partial === "") return [...COMMANDS];
    return COMMANDS.filter((c) => c.name.startsWith(partial));
  }, [value]);

  const showHints = matchingCommands.length > 0 && !disabled;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (disabled) return;

    // Read current state from refs (always up-to-date between renders)
    const val = valueRef.current;
    const cur = cursorRef.current;

    // Tab completion — fill in the selected hint
    if (key.tab && showHints) {
      const selected = matchingCommands[hintIndex];
      if (selected) {
        const completed = "/" + selected.name;
        setValue(completed);
        setCursor(completed.length);
        setHintIndex(0);
      }
      return;
    }

    // Up/Down to navigate hints when showing
    if (showHints && key.upArrow) {
      setHintIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (showHints && key.downArrow) {
      setHintIndex((i) => Math.min(matchingCommands.length - 1, i + 1));
      return;
    }

    if (key.return) {
      // If hints are showing, submit the highlighted command
      if (showHints && !val.includes(" ")) {
        const selected = matchingCommands[hintIndex];
        if (selected) {
          onSubmit("/" + selected.name);
          setValue("");
          setCursor(0);
          setHintIndex(0);
          return;
        }
      }
      if (val.trim()) {
        onSubmit(val);
        setValue("");
        setCursor(0);
        setHintIndex(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cur > 0) {
        setValue(val.slice(0, cur - 1) + val.slice(cur));
        setCursor(cur - 1);
        setHintIndex(0);
      }
      return;
    }

    if (key.leftArrow) {
      setCursor(Math.max(0, cur - 1));
      return;
    }

    if (key.rightArrow) {
      setCursor(Math.min(val.length, cur + 1));
      return;
    }

    if (key.ctrl && input === "a") {
      setCursor(0);
      return;
    }
    if (key.ctrl && input === "e") {
      setCursor(val.length);
      return;
    }
    if (key.ctrl && input === "u") {
      setValue("");
      setCursor(0);
      setHintIndex(0);
      return;
    }

    // Escape to dismiss hints
    if (key.escape) {
      if (val.startsWith("/") && !val.includes(" ")) {
        setValue("");
        setCursor(0);
        setHintIndex(0);
      }
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setValue(val.slice(0, cur) + input + val.slice(cur));
      setCursor(cur + input.length);
      setHintIndex(0);
    }
  });

  // Render
  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  const isSlashCommand = value.startsWith("/");

  if (disabled) {
    return (
      <Box flexDirection="column">
        <Box paddingX={1}>
          <Text color="gray" dimColor>{"  "}waiting for response...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {showHints && (
        <Box flexDirection="column" paddingX={3} marginBottom={0}>
          {matchingCommands.map((cmd, i) => (
            <Box key={cmd.name}>
              <Text color={i === hintIndex ? "blue" : "gray"} bold={i === hintIndex}>
                {i === hintIndex ? "> " : "  "}
              </Text>
              <Text color={i === hintIndex ? "yellow" : "gray"} bold={i === hintIndex}>
                {"/"}{cmd.name}
              </Text>
              <Text color="gray" dimColor>
                {"  "}{cmd.description}
              </Text>
            </Box>
          ))}
          <Box>
            <Text color="gray" dimColor>
              {"  "}
              <Text color="gray">tab</Text> complete  <Text color="gray">↑↓</Text> navigate  <Text color="gray">esc</Text> dismiss
            </Text>
          </Box>
        </Box>
      )}
      <Box paddingX={1}>
        <Text color="green" bold>{"> "}</Text>
        <Text color={isSlashCommand ? "yellow" : "white"}>
          {before}
        </Text>
        <Text inverse>{cursorChar}</Text>
        <Text color={isSlashCommand ? "yellow" : "white"}>
          {after}
        </Text>
      </Box>
    </Box>
  );
}
