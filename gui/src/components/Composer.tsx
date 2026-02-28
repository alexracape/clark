import React, { useState, useRef, useCallback, useEffect } from "react";

interface ComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const SLASH_COMMANDS = [
  { name: "/help", desc: "Show available commands" },
  { name: "/canvas", desc: "Open or switch canvas" },
  { name: "/export", desc: "Export canvas as PDF" },
  { name: "/model", desc: "Switch provider/model" },
  { name: "/context", desc: "Show context usage" },
  { name: "/compact", desc: "Summarize conversation" },
  { name: "/feedback", desc: "Send feedback" },
  { name: "/clear", desc: "Clear history" },
];

export function Composer({ onSend, disabled }: ComposerProps) {
  const [text, setText] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [selectedHint, setSelectedHint] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter slash command hints
  const filteredHints =
    text.startsWith("/")
      ? SLASH_COMMANDS.filter((c) =>
          c.name.startsWith(text.split(/\s/)[0]!.toLowerCase()),
        )
      : [];

  useEffect(() => {
    setShowHints(filteredHints.length > 0 && text.startsWith("/") && !text.includes(" "));
    setSelectedHint(0);
  }, [text]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  const handleSubmit = useCallback(() => {
    if (!text.trim() || disabled) return;

    // If hints are showing and user presses enter, complete the command
    if (showHints && filteredHints.length > 0) {
      setText(filteredHints[selectedHint]!.name + " ");
      setShowHints(false);
      return;
    }

    onSend(text);
    setText("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, disabled, onSend, showHints, filteredHints, selectedHint]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }

      // Navigate hints
      if (showHints) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedHint((v) => Math.min(v + 1, filteredHints.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedHint((v) => Math.max(v - 1, 0));
        } else if (e.key === "Tab") {
          e.preventDefault();
          setText(filteredHints[selectedHint]!.name + " ");
          setShowHints(false);
        } else if (e.key === "Escape") {
          setShowHints(false);
        }
      }
    },
    [handleSubmit, showHints, filteredHints, selectedHint],
  );

  return (
    <div className="composer">
      <div className="composer__inner">
        {showHints && filteredHints.length > 0 && (
          <div className="composer__hints">
            {filteredHints.map((hint, i) => (
              <div
                key={hint.name}
                className={`composer__hint ${i === selectedHint ? "composer__hint--selected" : ""}`}
                onClick={() => {
                  setText(hint.name + " ");
                  setShowHints(false);
                  textareaRef.current?.focus();
                }}
              >
                <span className="composer__hint-name">{hint.name}</span>
                <span className="composer__hint-desc">{hint.desc}</span>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="composer__textarea"
          placeholder={disabled ? "Clark is thinking..." : "Ask Clark anything..."}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />

        <button
          className="composer__send"
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          title="Send message"
        >
          {"\u2191"}
        </button>
      </div>
    </div>
  );
}
