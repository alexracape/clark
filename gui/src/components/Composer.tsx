import React, { useState, useRef, useCallback, useEffect } from "react";

interface ComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

const SLASH_COMMANDS = [
  { name: "/help", desc: "Show available commands", takesArgs: false },
  { name: "/canvas", desc: "Open or switch canvas", takesArgs: true },
  { name: "/export", desc: "Export canvas as PDF", takesArgs: true },
  { name: "/model", desc: "Switch provider/model", takesArgs: true },
  { name: "/context", desc: "Show context usage", takesArgs: false },
  { name: "/compact", desc: "Summarize conversation", takesArgs: false },
  { name: "/feedback", desc: "Send feedback", takesArgs: false },
  { name: "/clear", desc: "Clear history", takesArgs: false },
];

export function Composer({ onSend, disabled }: ComposerProps) {
  const [text, setText] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [selectedHint, setSelectedHint] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevDisabledRef = useRef(disabled);

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

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-focus after streaming ends (disabled: true -> false)
  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  // Auto-focus on window focus
  useEffect(() => {
    const handleWindowFocus = () => textareaRef.current?.focus();
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!text.trim() || disabled) return;

    // If hints are showing, decide based on whether command takes args
    if (showHints && filteredHints.length > 0) {
      const selected = filteredHints[selectedHint]!;
      if (selected.takesArgs) {
        // Autocomplete into textarea, let user type args
        setText(selected.name + " ");
        setShowHints(false);
        return;
      }
      // No args — submit immediately
      onSend(selected.name);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
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
            <div className="composer__hints-list">
              {filteredHints.map((hint, i) => (
                <div
                  key={hint.name}
                  ref={(el) => {
                    if (i === selectedHint && el) {
                      el.scrollIntoView({ block: "nearest" });
                    }
                  }}
                  className={`composer__hint ${i === selectedHint ? "composer__hint--selected" : ""}`}
                  onMouseEnter={() => setSelectedHint(i)}
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
            <div className="composer__hints-footer">
              tab complete &middot; &uarr;&darr; navigate &middot; esc dismiss
            </div>
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
