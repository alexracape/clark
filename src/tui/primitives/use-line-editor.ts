import { useRef, useState, type MutableRefObject } from "react";

export interface LineEditorState {
  value: string;
  cursor: number;
  valueRef: MutableRefObject<string>;
  cursorRef: MutableRefObject<number>;
  setValueSync: (value: string) => void;
  setCursorSync: (cursor: number) => void;
  clear: () => void;
  insert: (text: string) => void;
  backspaceOrDelete: () => void;
  moveLeft: () => void;
  moveRight: () => void;
}

/**
 * Shared single-line input editor for Ink UIs.
 * Keeps refs and state in sync so key handlers always see the latest value.
 */
export function useLineEditor(initialValue = ""): LineEditorState {
  const [value, _setValue] = useState(initialValue);
  const [cursor, _setCursor] = useState(initialValue.length);
  const valueRef = useRef(initialValue);
  const cursorRef = useRef(initialValue.length);

  const setValueSync = (next: string) => {
    valueRef.current = next;
    _setValue(next);
  };

  const setCursorSync = (next: number) => {
    const bounded = Math.max(0, Math.min(next, valueRef.current.length));
    cursorRef.current = bounded;
    _setCursor(bounded);
  };

  const clear = () => {
    setValueSync("");
    setCursorSync(0);
  };

  const insert = (text: string) => {
    const v = valueRef.current;
    const c = cursorRef.current;
    setValueSync(v.slice(0, c) + text + v.slice(c));
    setCursorSync(c + text.length);
  };

  const backspaceOrDelete = () => {
    const v = valueRef.current;
    const c = cursorRef.current;

    if (c > 0) {
      setValueSync(v.slice(0, c - 1) + v.slice(c));
      setCursorSync(c - 1);
      return;
    }

    if (c < v.length) {
      setValueSync(v.slice(0, c) + v.slice(c + 1));
      setCursorSync(c);
    }
  };

  const moveLeft = () => setCursorSync(cursorRef.current - 1);
  const moveRight = () => setCursorSync(cursorRef.current + 1);

  return {
    value,
    cursor,
    valueRef,
    cursorRef,
    setValueSync,
    setCursorSync,
    clear,
    insert,
    backspaceOrDelete,
    moveLeft,
    moveRight,
  };
}
