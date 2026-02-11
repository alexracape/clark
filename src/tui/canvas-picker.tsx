/**
 * Interactive canvas picker — shown when the user types /canvas.
 *
 * Lists existing .tldr canvases from the vault, with text filtering
 * and the ability to create a new canvas by typing a name that
 * doesn't match any existing one.
 */

import React, { useState, useRef, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";

export interface CanvasPickerProps {
  existingCanvases: string[];
  onSelect: (name: string) => void;
  onCancel: () => void;
}

export function CanvasPicker({ existingCanvases, onSelect, onCancel }: CanvasPickerProps) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const filterRef = useRef("");
  const cursorRef = useRef(0);
  const [cursor, setCursor] = useState(0);

  const setFilterSync = (v: string) => {
    filterRef.current = v;
    setFilter(v);
  };

  const setCursorSync = (c: number) => {
    cursorRef.current = c;
    setCursor(c);
  };

  // Filter existing canvases by typed text
  const matchingCanvases = useMemo(() => {
    if (!filter) return existingCanvases;
    const lower = filter.toLowerCase();
    return existingCanvases.filter((name) =>
      name.toLowerCase().includes(lower),
    );
  }, [filter, existingCanvases]);

  // Is the user's text an exact match to an existing canvas?
  const isExactMatch = existingCanvases.some(
    (name) => name.toLowerCase() === filter.trim().toLowerCase(),
  );

  // Keep selection in bounds when list changes
  useEffect(() => {
    if (selected >= matchingCanvases.length && matchingCanvases.length > 0) {
      setSelected(matchingCanvases.length - 1);
    }
  }, [matchingCanvases.length]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelected((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((i) => Math.min(matchingCanvases.length - 1, i + 1));
      return;
    }

    if (key.tab && matchingCanvases.length > 0) {
      const match = matchingCanvases[selected];
      if (match) {
        setFilterSync(match);
        setCursorSync(match.length);
      }
      return;
    }

    if (key.return) {
      const trimmed = filterRef.current.trim();
      if (!trimmed && matchingCanvases.length > 0) {
        // No text typed — select highlighted canvas
        onSelect(matchingCanvases[selected]!);
      } else if (trimmed) {
        if (matchingCanvases.length > 0) {
          // Select highlighted match
          onSelect(matchingCanvases[selected]!);
        } else {
          // No matches — create new canvas with typed name
          onSelect(trimmed);
        }
      }
      return;
    }

    // Text editing (same ref-based pattern as Input/ModelPicker)
    const val = filterRef.current;
    const cur = cursorRef.current;

    if (key.backspace || key.delete) {
      if (cur > 0) {
        setFilterSync(val.slice(0, cur - 1) + val.slice(cur));
        setCursorSync(cur - 1);
        setSelected(0);
      }
      return;
    }

    if (key.leftArrow) { setCursorSync(Math.max(0, cur - 1)); return; }
    if (key.rightArrow) { setCursorSync(Math.min(val.length, cur + 1)); return; }

    if (key.ctrl && input === "u") {
      setFilterSync("");
      setCursorSync(0);
      setSelected(0);
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setFilterSync(val.slice(0, cur) + input + val.slice(cur));
      setCursorSync(cur + input.length);
      setSelected(0);
    }
  });

  // Render
  const before = filter.slice(0, cursor);
  const cursorChar = filter[cursor] ?? " ";
  const after = filter.slice(cursor + 1);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Open canvas:</Text>
      <Text> </Text>

      {matchingCanvases.length > 0 ? (
        matchingCanvases.map((name, i) => (
          <Box key={name} paddingLeft={2}>
            <Text color={i === selected ? "blue" : "gray"}>
              {i === selected ? "> " : "  "}
            </Text>
            <Text bold={i === selected} color={i === selected ? "white" : "gray"}>
              {name}
            </Text>
          </Box>
        ))
      ) : filter.trim() ? (
        <Box paddingLeft={2}>
          <Text color="yellow">+ Create new canvas: &quot;{filter.trim()}&quot;</Text>
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
