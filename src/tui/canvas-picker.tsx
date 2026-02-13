/**
 * Interactive canvas picker — shown when the user types /canvas.
 *
 * Lists existing .tldr canvases from the workspace, with text filtering
 * and the ability to create a new canvas by typing a name that
 * doesn't match any existing one.
 */

import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useLineEditor } from "./primitives/use-line-editor.ts";
import { useSelectableList } from "./primitives/use-selectable-list.ts";

export interface CanvasPickerProps {
  existingCanvases: string[];
  onSelect: (name: string) => void;
  onCancel: () => void;
}

export function CanvasPicker({ existingCanvases, onSelect, onCancel }: CanvasPickerProps) {
  const editor = useLineEditor("");

  const matchingCanvases = useMemo(() => {
    if (!editor.value) return existingCanvases;
    const lower = editor.value.toLowerCase();
    return existingCanvases.filter((name) => name.toLowerCase().includes(lower));
  }, [editor.value, existingCanvases]);

  const list = useSelectableList(matchingCanvases.length);

  useInput((input, key) => {
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

    if (key.tab && matchingCanvases.length > 0) {
      const match = matchingCanvases[list.selected];
      if (match) {
        editor.setValueSync(match);
        editor.setCursorSync(match.length);
      }
      return;
    }

    if (key.return) {
      const trimmed = editor.valueRef.current.trim();
      if (!trimmed && matchingCanvases.length > 0) {
        onSelect(matchingCanvases[list.selected]!);
      } else if (trimmed) {
        if (matchingCanvases.length > 0) {
          onSelect(matchingCanvases[list.selected]!);
        } else {
          onSelect(trimmed);
        }
      }
      return;
    }

    if (key.backspace || key.delete) {
      editor.backspaceOrDelete();
      list.reset();
      return;
    }

    if (key.leftArrow) {
      editor.moveLeft();
      return;
    }

    if (key.rightArrow) {
      editor.moveRight();
      return;
    }

    if (key.ctrl && input === "u") {
      editor.clear();
      list.reset();
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      editor.insert(input);
      list.reset();
    }
  });

  const before = editor.value.slice(0, editor.cursor);
  const cursorChar = editor.value[editor.cursor] ?? " ";
  const after = editor.value.slice(editor.cursor + 1);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Open canvas:</Text>
      <Text> </Text>

      {matchingCanvases.length > 0 ? (
        matchingCanvases.map((name, i) => (
          <Box key={name} paddingLeft={2}>
            <Text color={i === list.selected ? "blue" : "gray"}>{i === list.selected ? "> " : "  "}</Text>
            <Text bold={i === list.selected} color={i === list.selected ? "white" : "gray"}>{name}</Text>
          </Box>
        ))
      ) : editor.value.trim() ? (
        <Box paddingLeft={2}>
          <Text color="yellow">+ Create new canvas: &quot;{editor.value.trim()}&quot;</Text>
        </Box>
      ) : (
        <Box paddingLeft={2}>
          <Text color="gray" dimColor>No canvases found. Type a name to create one.</Text>
        </Box>
      )}

      <Text> </Text>
      <Box paddingLeft={2}>
        <Text color="green" bold>{"name: "}</Text>
        <Text color="yellow">{before}</Text>
        <Text inverse>{cursorChar}</Text>
        <Text color="yellow">{after}</Text>
      </Box>
      <Text> </Text>
      <Text color="gray">
        {"  "}<Text color="gray">tab</Text> complete  <Text color="gray">{"↑↓"}</Text> navigate  <Text color="gray">enter</Text> open  <Text color="gray">esc</Text> cancel
      </Text>
    </Box>
  );
}
