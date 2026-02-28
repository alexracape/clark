import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";

interface CanvasesResponse {
  canvases: string[];
  active: { name: string; url: string } | null;
  connectionStatus: string;
}

interface CanvasPickerProps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  onOpen: (info: { name: string; url: string }) => void;
  onClose: () => void;
}

export function CanvasPicker({ invoke, onOpen, onClose }: CanvasPickerProps) {
  const [canvases, setCanvases] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke("list_canvases", {})
      .then((res) => {
        const d = res as CanvasesResponse;
        setCanvases(d.canvases);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [invoke]);

  const filtered = useMemo(() => {
    if (!filter) return canvases;
    const lower = filter.toLowerCase();
    return canvases.filter((name) => name.toLowerCase().includes(lower));
  }, [filter, canvases]);

  const isCreateMode = filter.trim() !== "" && filtered.length === 0;

  const handleOpen = useCallback(
    async (name: string) => {
      try {
        const info = (await invoke("open_canvas", { name })) as { name: string; url: string };
        onOpen(info);
      } catch (err) {
        setError(String(err));
      }
    },
    [invoke, onOpen],
  );

  const handleSubmit = useCallback(() => {
    if (isCreateMode) {
      handleOpen(filter.trim());
    } else if (filtered.length > 0) {
      handleOpen(filtered[selectedIndex]!);
    }
  }, [isCreateMode, filter, filtered, selectedIndex, handleOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        handleSubmit();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, selectedIndex, handleSubmit, onClose]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (loading) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">Open Canvas</div>
          <div className="modal__body" style={{ padding: "24px", color: "var(--patina)" }}>
            Loading canvases...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span>Open Canvas</span>
          <button className="modal__close" onClick={onClose}>Esc</button>
        </div>

        <div className="modal__body">
          <div style={{ padding: "12px 16px 8px" }}>
            <input
              ref={inputRef}
              className="modal__input"
              placeholder="Filter or type a new canvas name..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="picker-list">
            {filtered.length > 0 ? (
              filtered.map((name, i) => (
                <div
                  key={name}
                  className={`picker-item ${i === selectedIndex ? "picker-item--selected" : ""}`}
                  onClick={() => handleOpen(name)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="picker-item__label">{name}</span>
                </div>
              ))
            ) : filter.trim() ? (
              <div
                className="picker-item picker-item--selected"
                onClick={() => handleOpen(filter.trim())}
              >
                <span className="picker-item__create">+ Create new canvas: "{filter.trim()}"</span>
              </div>
            ) : (
              <div style={{ padding: "12px 16px", color: "var(--patina)", fontSize: "13px" }}>
                No canvases found. Type a name to create one.
              </div>
            )}
          </div>

          {error && <div className="modal__error" style={{ margin: "8px 16px" }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
