/**
 * User input component — text input with slash command hints and cursor.
 */

import React, { useState, useRef, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CommandHistory } from "./history.ts";
import { expandPath } from "../library.ts";

export interface InputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  history?: CommandHistory;
}

export interface SlashCommand {
  name: string;
  args: string;
}

export interface CommandEntry {
  name: string;
  description: string;
}

export interface ExportPathSuggestion {
  value: string;
  display: string;
  description: string;
}

/** Built-in commands (always available) */
export const BUILTIN_COMMANDS: CommandEntry[] = [
  { name: "help", description: "Show available commands" },
  { name: "canvas", description: "Open or show active canvas" },
  { name: "export", description: "Export canvas as A4 PDF" },
  { name: "model", description: "Switch model and provider" },
  { name: "context", description: "Show context window usage" },
  { name: "compact", description: "Summarize conversation to save context" },
  { name: "clear", description: "Clear conversation history" },
];

/** All commands including dynamically registered skills */
export let COMMANDS: CommandEntry[] = [...BUILTIN_COMMANDS];

/** Register additional commands (called at startup with skill commands) */
export function registerCommands(commands: CommandEntry[]) {
  COMMANDS = [...BUILTIN_COMMANDS, ...commands];
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

/**
 * Suggest /export path completions based on subdirectories at the current input path.
 */
export function getExportPathSuggestions(
  value: string,
  cwd = process.cwd(),
  maxResults = 8,
): ExportPathSuggestion[] {
  if (!value.startsWith("/export ")) return [];

  const rawArg = value.slice("/export ".length);
  const trimmedArg = rawArg.trimStart();
  const leadingWhitespace = rawArg.slice(0, rawArg.length - trimmedArg.length);

  const pathInput = trimmedArg;
  const lastForward = pathInput.lastIndexOf("/");
  const lastBackward = pathInput.lastIndexOf("\\");
  const lastSep = Math.max(lastForward, lastBackward);
  const hasTrailingSep = /[\\/]$/.test(pathInput);

  let typedBase = "";
  let prefix = "";
  if (hasTrailingSep) {
    typedBase = pathInput;
  } else if (lastSep >= 0) {
    typedBase = pathInput.slice(0, lastSep + 1);
    prefix = pathInput.slice(lastSep + 1);
  } else {
    prefix = pathInput;
  }

  const lookupBase = typedBase === "" ? "." : typedBase;
  const lookupPath = resolve(cwd, expandPath(lookupBase));

  try {
    const dirs = readdirSync(lookupPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, maxResults);

    return dirs.map((dir) => {
      const completedPath = `${leadingWhitespace}${typedBase}${dir}/`;
      return {
        value: `/export ${completedPath}`,
        display: completedPath,
        description: "directory",
      };
    });
  } catch {
    return [];
  }
}

export function Input({ onSubmit, disabled = false, history }: InputProps) {
  // Refs track the "true" value/cursor synchronously so rapid keystrokes
  // between React renders always see the latest state.
  const valueRef = useRef("");
  const cursorRef = useRef(0);
  const [value, _setValue] = useState("");
  const [cursor, _setCursor] = useState(0);
  const [hintIndex, setHintIndex] = useState(0);
  // True while the input was filled by history navigation (suppresses hint UI)
  const browsingHistoryRef = useRef(false);
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

  const exportPathSuggestions = useMemo(() => getExportPathSuggestions(value), [value]);

  const hintMode = useMemo<"commands" | "path" | null>(() => {
    if (matchingCommands.length > 0) return "commands";
    if (exportPathSuggestions.length > 0) return "path";
    return null;
  }, [matchingCommands, exportPathSuggestions]);

  const showHints = hintMode !== null && !disabled && !browsingHistoryRef.current;
  const hintItems = useMemo(() => {
    if (hintMode === "commands") {
      return matchingCommands.map((cmd) => ({
        key: `cmd:${cmd.name}`,
        label: `/${cmd.name}`,
        description: cmd.description,
        completion: `/${cmd.name}`,
      }));
    }
    if (hintMode === "path") {
      return exportPathSuggestions.map((hint) => ({
        key: `path:${hint.display}`,
        label: hint.display,
        description: hint.description,
        completion: hint.value,
      }));
    }
    return [];
  }, [hintMode, matchingCommands, exportPathSuggestions]);

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
      const selected = hintItems[hintIndex];
      if (selected) {
        setValue(selected.completion);
        setCursor(selected.completion.length);
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
      setHintIndex((i) => Math.min(hintItems.length - 1, i + 1));
      return;
    }

    // Up/Down for command history (when hints are not showing)
    if (!showHints && key.upArrow && history) {
      const entry = history.up(val);
      if (entry !== null) {
        browsingHistoryRef.current = true;
        setValue(entry);
        setCursor(entry.length);
      }
      return;
    }
    if (!showHints && key.downArrow && history) {
      const entry = history.down();
      if (entry !== null) {
        browsingHistoryRef.current = true;
        setValue(entry);
        setCursor(entry.length);
      }
      return;
    }

    if (key.return) {
      // If hints are showing, submit the highlighted command
      if (showHints && hintMode === "commands" && !val.includes(" ")) {
        const selected = matchingCommands[hintIndex];
        if (selected) {
          const cmd = "/" + selected.name;
          history?.push(cmd);
          browsingHistoryRef.current = false;
          onSubmit(cmd);
          setValue("");
          setCursor(0);
          setHintIndex(0);
          return;
        }
      }
      if (val.trim()) {
        history?.push(val);
        browsingHistoryRef.current = false;
        onSubmit(val);
        setValue("");
        setCursor(0);
        setHintIndex(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      browsingHistoryRef.current = false;
      if (cur > 0) {
        setValue(val.slice(0, cur - 1) + val.slice(cur));
        setCursor(cur - 1);
        setHintIndex(0);
      } else if (cur < val.length) {
        setValue(val.slice(0, cur) + val.slice(cur + 1));
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
      browsingHistoryRef.current = false;
      setValue("");
      setCursor(0);
      setHintIndex(0);
      return;
    }

    // Escape to dismiss hints / clear browsing state
    if (key.escape) {
      browsingHistoryRef.current = false;
      if (val.startsWith("/") && !val.includes(" ")) {
        setValue("");
        setCursor(0);
        setHintIndex(0);
      }
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      browsingHistoryRef.current = false;
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
          {hintItems.map((hint, i) => (
            <Box key={hint.key}>
              <Text color={i === hintIndex ? "blue" : "gray"} bold={i === hintIndex}>
                {i === hintIndex ? "> " : "  "}
              </Text>
              <Text color={i === hintIndex ? "yellow" : "gray"} bold={i === hintIndex}>
                {hint.label}
              </Text>
              <Text color="gray" dimColor>
                {"  "}{hint.description}
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
