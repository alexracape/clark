import React, { useState, useRef, useCallback, useEffect } from "react";

interface ComposerProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  onModelSelect: (provider: string, model: string) => void;
  onCanvasOpen: (info: { name: string; url: string }) => void;
  onClipboardNotice: (notice: { kind: "success" | "error"; text: string }) => void;
}

type SubPicker = "canvas" | "model" | null;

interface SubPickerItem {
  name: string;
  desc: string;
}

const SLASH_COMMANDS = [
  { name: "/help", desc: "Show available commands", takesArgs: false },
  { name: "/tutorial", desc: "Interactive tutorial", takesArgs: false },
  { name: "/note", desc: "Create a new note", takesArgs: false },
  { name: "/canvas", desc: "Open or switch canvas", takesArgs: false, subPicker: "canvas" as const },
  { name: "/export", desc: "Export canvas as PDF", takesArgs: false },
  { name: "/model", desc: "Switch provider/model", takesArgs: false, subPicker: "model" as const },
  { name: "/context", desc: "Show context usage", takesArgs: false },
  { name: "/settings", desc: "Open settings", takesArgs: false },
  { name: "/compact", desc: "Summarize conversation", takesArgs: false },
  { name: "/resume", desc: "Resume a previous session", takesArgs: false },
  { name: "/feedback", desc: "Send feedback", takesArgs: true },
  { name: "/clear", desc: "Clear history", takesArgs: false },
];

export function Composer({ onSend, disabled, invoke, onModelSelect, onCanvasOpen, onClipboardNotice }: ComposerProps) {
  const [text, setText] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [selectedHint, setSelectedHint] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevDisabledRef = useRef(disabled);

  // Sub-picker state (for /canvas, /model)
  const [subPicker, setSubPicker] = useState<SubPicker>(null);
  const [subPickerItems, setSubPickerItems] = useState<SubPickerItem[]>([]);
  const [subPickerSelected, setSubPickerSelected] = useState(0);
  const [subPickerLoading, setSubPickerLoading] = useState(false);
  const [subPickerFilter, setSubPickerFilter] = useState("");

  // Filter slash command hints
  const filteredHints =
    text.startsWith("/") && !subPicker
      ? SLASH_COMMANDS.filter((c) =>
          c.name.startsWith(text.split(/\s/)[0]!.toLowerCase()),
        )
      : [];

  useEffect(() => {
    if (!subPicker) {
      setShowHints(filteredHints.length > 0 && text.startsWith("/") && !text.includes(" "));
      setSelectedHint(0);
    }
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

  // Load sub-picker data
  const openSubPicker = useCallback(async (picker: SubPicker) => {
    if (!picker) return;
    setSubPicker(picker);
    setSubPickerFilter("");
    setSubPickerSelected(0);
    setSubPickerLoading(true);
    setShowHints(false);

    try {
      if (picker === "model") {
        const res = (await invoke("list_models", {})) as {
          models: { provider: string; providerLabel: string; model: string; label: string }[];
          providerAvailability: Record<string, boolean>;
        };
        const items: SubPickerItem[] = res.models
          .filter((m) => res.providerAvailability[m.provider] !== false)
          .map((m) => ({
            name: m.label,
            desc: m.providerLabel,
            _provider: m.provider,
            _model: m.model,
          }));
        setSubPickerItems(items);
      } else if (picker === "canvas") {
        const res = (await invoke("list_canvases", {})) as {
          canvases: string[];
          active: { name: string; url: string } | null;
        };
        const items: SubPickerItem[] = res.canvases.map((name) => ({
          name,
          desc: "",
        }));
        setSubPickerItems(items);
      }
    } catch {
      setSubPickerItems([]);
    } finally {
      setSubPickerLoading(false);
    }
  }, [invoke]);

  const closeSubPicker = useCallback(() => {
    setSubPicker(null);
    setSubPickerItems([]);
    setSubPickerFilter("");
    setSubPickerSelected(0);
    setText("");
    textareaRef.current?.focus();
  }, []);

  // Filter sub-picker items by what the user types after the command
  const filteredSubItems = subPickerFilter
    ? subPickerItems.filter((item) =>
        item.name.toLowerCase().includes(subPickerFilter.toLowerCase()),
      )
    : subPickerItems;

  // Handle sub-picker selection
  const handleSubPickerSelect = useCallback(async (item: SubPickerItem) => {
    if (subPicker === "model") {
      const modelItem = item as SubPickerItem & { _provider?: string; _model?: string };
      if (modelItem._provider && modelItem._model) {
        onModelSelect(modelItem._provider, modelItem._model);
      }
    } else if (subPicker === "canvas") {
      // Import openCanvasAndCopy inline to avoid circular deps
      const { openCanvasAndCopy } = await import("./CanvasPicker.tsx");
      const result = await openCanvasAndCopy(invoke, item.name);
      if (result.ok && result.info) {
        onCanvasOpen(result.info);
        onClipboardNotice({ kind: "success", text: `Opened "${item.name}" — URL copied` });
      } else if (!result.ok && result.stage === "open") {
        onClipboardNotice({ kind: "error", text: result.error ?? "Failed to open canvas" });
      } else if (result.info) {
        onCanvasOpen(result.info);
        onClipboardNotice({ kind: "error", text: "Could not copy canvas URL" });
      }
    }
    closeSubPicker();
  }, [subPicker, invoke, onModelSelect, onCanvasOpen, onClipboardNotice, closeSubPicker]);

  // Handle creating a new canvas from the filter text
  const handleCanvasCreate = useCallback(async () => {
    const name = subPickerFilter.trim();
    if (!name) return;
    const { openCanvasAndCopy } = await import("./CanvasPicker.tsx");
    const result = await openCanvasAndCopy(invoke, name);
    if (result.ok && result.info) {
      onCanvasOpen(result.info);
      onClipboardNotice({ kind: "success", text: `Created "${name}" — URL copied` });
    } else if (!result.ok && result.stage === "open") {
      onClipboardNotice({ kind: "error", text: result.error ?? "Failed to create canvas" });
    } else if (result.info) {
      onCanvasOpen(result.info);
      onClipboardNotice({ kind: "error", text: "Could not copy canvas URL" });
    }
    closeSubPicker();
  }, [subPickerFilter, invoke, onCanvasOpen, onClipboardNotice, closeSubPicker]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;

    // Sub-picker mode: select the highlighted item
    if (subPicker) {
      if (subPicker === "canvas" && filteredSubItems.length === 0 && subPickerFilter.trim()) {
        void handleCanvasCreate();
        return;
      }
      if (filteredSubItems.length > 0) {
        const idx = Math.min(subPickerSelected, filteredSubItems.length - 1);
        void handleSubPickerSelect(filteredSubItems[idx]!);
      }
      return;
    }

    if (!text.trim()) return;

    // If hints are showing, decide based on whether command takes args or has sub-picker
    if (showHints && filteredHints.length > 0) {
      const selected = filteredHints[selectedHint]!;
      if (selected.subPicker) {
        setText(selected.name + " ");
        void openSubPicker(selected.subPicker);
        return;
      }
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
  }, [text, disabled, onSend, showHints, filteredHints, selectedHint, subPicker, filteredSubItems, subPickerSelected, subPickerFilter, openSubPicker, handleSubPickerSelect, handleCanvasCreate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Sub-picker navigation
      if (subPicker) {
        if (e.key === "Enter") {
          e.preventDefault();
          handleSubmit();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          const max = subPicker === "canvas" && filteredSubItems.length === 0 && subPickerFilter.trim()
            ? 0
            : filteredSubItems.length - 1;
          setSubPickerSelected((v) => Math.min(v + 1, max));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSubPickerSelected((v) => Math.max(v - 1, 0));
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeSubPicker();
        }
        return;
      }

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
          const selected = filteredHints[selectedHint]!;
          setText(selected.name + " ");
          if (selected.subPicker) {
            void openSubPicker(selected.subPicker);
          } else {
            setShowHints(false);
          }
        } else if (e.key === "Escape") {
          setShowHints(false);
        }
      }
    },
    [handleSubmit, showHints, filteredHints, selectedHint, subPicker, filteredSubItems, subPickerFilter, closeSubPicker, openSubPicker],
  );

  // Update sub-picker filter when text changes in sub-picker mode
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    if (subPicker) {
      // Extract filter text after the command prefix
      const spaceIdx = value.indexOf(" ");
      const filter = spaceIdx >= 0 ? value.slice(spaceIdx + 1) : "";
      setSubPickerFilter(filter);
      setSubPickerSelected(0);
    }
  }, [subPicker]);

  // Determine what to show in the hints popup
  const showSubPickerHints = subPicker && !subPickerLoading;
  const isCanvasCreateMode = subPicker === "canvas" && filteredSubItems.length === 0 && subPickerFilter.trim();

  return (
    <div className="composer">
      <div className="composer__inner">
        {/* Slash command hints */}
        {showHints && filteredHints.length > 0 && !subPicker && (
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
                    if (hint.subPicker) {
                      setText(hint.name + " ");
                      void openSubPicker(hint.subPicker);
                    } else {
                      setText(hint.name + " ");
                      setShowHints(false);
                    }
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

        {/* Sub-picker hints (canvas list, model list) */}
        {showSubPickerHints && (
          <div className="composer__hints">
            <div className="composer__hints-list">
              {filteredSubItems.map((item, i) => (
                <div
                  key={item.name}
                  ref={(el) => {
                    if (i === subPickerSelected && el) {
                      el.scrollIntoView({ block: "nearest" });
                    }
                  }}
                  className={`composer__hint ${i === subPickerSelected ? "composer__hint--selected" : ""}`}
                  onMouseEnter={() => setSubPickerSelected(i)}
                  onClick={() => void handleSubPickerSelect(item)}
                >
                  <span className="composer__hint-name">{item.name}</span>
                  {item.desc && <span className="composer__hint-desc">{item.desc}</span>}
                </div>
              ))}
              {isCanvasCreateMode && (
                <div
                  className="composer__hint composer__hint--selected"
                  onClick={() => void handleCanvasCreate()}
                >
                  <span className="composer__hint-name">+ Create "{subPickerFilter.trim()}"</span>
                </div>
              )}
              {filteredSubItems.length === 0 && !isCanvasCreateMode && (
                <div className="composer__hint">
                  <span className="composer__hint-desc">No matches</span>
                </div>
              )}
            </div>
            <div className="composer__hints-footer">
              {subPicker === "canvas"
                ? "enter select \u00b7 type a new name to create \u00b7 esc dismiss"
                : "enter select \u00b7 \u2191\u2193 navigate \u00b7 esc dismiss"}
            </div>
          </div>
        )}

        {subPickerLoading && (
          <div className="composer__hints">
            <div className="composer__hint">
              <span className="composer__hint-desc">Loading...</span>
            </div>
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="composer__textarea"
          placeholder={disabled ? "Clark is thinking..." : "Ask Clark anything..."}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
        />

        <button
          className="composer__send"
          onClick={handleSubmit}
          disabled={disabled || (!text.trim() && !subPicker)}
          title="Send message"
        >
          {"\u2191"}
        </button>
      </div>
    </div>
  );
}
