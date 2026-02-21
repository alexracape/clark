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
import { validateCanvasName } from "../canvas/name.ts";
import { theme, componentTheme, hex } from "./theme.ts";

export interface CanvasPickerProps {
  existingCanvases: string[];
  onSelect: (name: string) => void;
  onCancel: () => void;
}

export function CanvasPicker({ existingCanvases, onSelect, onCancel }: CanvasPickerProps) {
  const editor = useLineEditor("");
  const [error, setError] = React.useState<string | null>(null);

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
        setError(null);
        onSelect(matchingCanvases[list.selected]!);
      } else if (trimmed) {
        if (matchingCanvases.length > 0) {
          setError(null);
          onSelect(matchingCanvases[list.selected]!);
        } else {
          const validated = validateCanvasName(trimmed);
          if (!validated.ok) {
            setError(validated.error);
            return;
          }
          setError(null);
          onSelect(validated.name);
        }
      }
      return;
    }

    if (key.backspace || key.delete) {
      editor.backspaceOrDelete();
      list.reset();
      setError(null);
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
      setError(null);
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      editor.insert(input);
      list.reset();
      setError(null);
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
            <Text>
              {i === list.selected
                ? componentTheme.hints.selected("> ")
                : componentTheme.hints.unselected("  ")}
              {i === list.selected
                ? theme.selectedText(name)
                : theme.dim(name)}
            </Text>
          </Box>
        ))
      ) : editor.value.trim() ? (
        <Box paddingLeft={2}>
          <Text>{theme.highlight(`+ Create new canvas: "${editor.value.trim()}"`)}</Text>
        </Box>
      ) : (
        <Box paddingLeft={2}>
          <Text>{theme.dim("No canvases found. Type a name to create one.")}</Text>
        </Box>
      )}

      <Text> </Text>
      <Box paddingLeft={2}>
        <Text>
          {theme.user("name: ")}
          {theme.slashCommand(before)}
        </Text>
        <Text inverse>{cursorChar}</Text>
        <Text>{theme.slashCommand(after)}</Text>
      </Box>
      <Text> </Text>
      {error && (
        <Box paddingLeft={2}>
          <Text color={hex.error}>{error}</Text>
        </Box>
      )}
      {error && <Text> </Text>}
      <Text>
        {theme.dim("  tab")} complete  {theme.dim("↑↓")} navigate  {theme.dim("enter")} open  {theme.dim("esc")} cancel
      </Text>
    </Box>
  );
}
