/**
 * Interactive library path picker — shown when the user types /library.
 */

import React, { useState, useRef } from "react";
import { Box, Text, useInput } from "ink";

export interface LibraryPickerProps {
  currentPath: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export function LibraryPicker({ currentPath, onSelect, onCancel }: LibraryPickerProps) {
  const [value, setValue] = useState(currentPath);
  const [cursor, setCursor] = useState(currentPath.length);
  const valueRef = useRef(currentPath);
  const cursorRef = useRef(currentPath.length);

  const setValueSync = (v: string) => {
    valueRef.current = v;
    setValue(v);
  };

  const setCursorSync = (c: number) => {
    cursorRef.current = c;
    setCursor(c);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const trimmed = valueRef.current.trim();
      if (trimmed) onSelect(trimmed);
      return;
    }

    const val = valueRef.current;
    const cur = cursorRef.current;

    if (key.backspace || key.delete) {
      if (cur > 0) {
        setValueSync(val.slice(0, cur - 1) + val.slice(cur));
        setCursorSync(cur - 1);
      } else if (cur < val.length) {
        setValueSync(val.slice(0, cur) + val.slice(cur + 1));
      }
      return;
    }

    if (key.leftArrow) { setCursorSync(Math.max(0, cur - 1)); return; }
    if (key.rightArrow) { setCursorSync(Math.min(val.length, cur + 1)); return; }

    if (key.ctrl && input === "u") {
      setValueSync("");
      setCursorSync(0);
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setValueSync(val.slice(0, cur) + input + val.slice(cur));
      setCursorSync(cur + input.length);
    }
  });

  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Set library path:</Text>
      <Text color="gray" dimColor>{"  "}Use an existing library path or type a new one.</Text>
      <Text> </Text>
      <Box paddingLeft={2}>
        <Text color="cyan">{before}</Text>
        <Text inverse>{cursorChar}</Text>
        <Text color="cyan">{after}</Text>
      </Box>
      <Text> </Text>
      <Text color="gray">
        {"  "}<Text color="gray">enter</Text> save  <Text color="gray">esc</Text> cancel  <Text color="gray">ctrl+u</Text> clear
      </Text>
    </Box>
  );
}
