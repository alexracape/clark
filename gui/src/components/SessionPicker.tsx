import React, { useState, useEffect, useRef } from "react";
import type { SessionInfo } from "../app-controller.ts";

interface SessionPickerProps {
  sessions: SessionInfo[];
  onSelect: (session: SessionInfo) => void;
  onClose: () => void;
}

export function SessionPicker({ sessions, onSelect, onClose }: SessionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, sessions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && sessions.length > 0) {
        e.preventDefault();
        onSelect(sessions[selectedIndex]!);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sessions, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(".picker-item--selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (sessions.length === 0) {
    return (
      <div className="canvas-popover-backdrop" onClick={onClose}>
        <div className="canvas-popover" onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: "16px", color: "var(--patina)", fontSize: "13px" }}>
            No saved sessions found.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-popover-backdrop" onClick={onClose}>
      <div className="canvas-popover" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            padding: "8px 12px 4px",
            fontSize: "11px",
            color: "var(--patina)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          Resume a previous session
        </div>

        <div className="picker-list" ref={listRef}>
          {sessions.map((session, i) => (
            <div
              key={session.path}
              className={`picker-item ${i === selectedIndex ? "picker-item--selected" : ""}`}
              onClick={() => onSelect(session)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span className="picker-item__label">{session.date}</span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--patina)",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    {session.provider}/{session.model}
                  </span>
                </div>
                {session.firstUserMessage && (
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--ink-dim, var(--patina))",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "340px",
                    }}
                  >
                    {session.firstUserMessage}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: "6px 12px",
            fontSize: "11px",
            color: "var(--patina)",
            borderTop: "1px solid var(--border)",
          }}
        >
          ↑↓ navigate · enter select · esc dismiss
        </div>
      </div>
    </div>
  );
}
