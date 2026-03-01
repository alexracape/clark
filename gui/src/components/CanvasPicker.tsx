import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";

interface CanvasesResponse {
  canvases: string[];
  active: { name: string; url: string } | null;
  connectionStatus: string;
}

interface CanvasPickerProps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  onOpen: (info: { name: string; url: string }) => void;
  onClose: () => void;
  onClipboardNotice: (notice: {
    kind: "success" | "error";
    text: string;
  }) => void;
}

interface OpenCanvasResult {
  info?: { name: string; url: string };
  stage: "open" | "copy";
  ok: boolean;
  error?: string;
}

async function copyText(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) {
    throw new Error("Clipboard unavailable");
  }
  await clipboard.writeText(text);
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function writeClipboardText(
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  text: string,
): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("write_clipboard_text", { text });
    return;
  }
  await copyText(text);
}

export async function openCanvasAndCopy(
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  name: string,
): Promise<OpenCanvasResult> {
  let info: { name: string; url: string };
  try {
    info = (await invoke("open_canvas", { name })) as {
      name: string;
      url: string;
    };
  } catch (err) {
    return {
      ok: false,
      stage: "open",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await writeClipboardText(invoke, info.url);
    return { ok: true, stage: "copy", info };
  } catch (err) {
    return {
      ok: false,
      stage: "copy",
      info,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function statusDotColor(status: string): string {
  switch (status) {
    case "connected":
      return "var(--sage)";
    case "connecting":
    case "reconnecting":
      return "var(--brass)";
    default:
      return "var(--patina)";
  }
}

export function CanvasPicker({
  invoke,
  onOpen,
  onClose,
  onClipboardNotice,
}: CanvasPickerProps) {
  const [canvases, setCanvases] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeCanvas, setActiveCanvas] = useState<{
    name: string;
    url: string;
  } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("none");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke("list_canvases", {})
      .then((res) => {
        const d = res as CanvasesResponse;
        setCanvases(d.canvases);
        setActiveCanvas(d.active);
        setConnectionStatus(d.connectionStatus);
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
      const hadActiveConnection = Boolean(activeCanvas) && connectionStatus === "connected";
      setError(null);
      const result = await openCanvasAndCopy(invoke, name);
      if (!result.ok) {
        if (result.stage === "open") {
          setError(result.error ?? "Failed to open canvas");
          return;
        }

        if (result.info) {
          setActiveCanvas(result.info);
        }
        onClipboardNotice({
          kind: "error",
          text: "Could not copy canvas URL. Use Copy URL to retry.",
        });
        setError("Could not copy canvas URL automatically.");
        return;
      }

      if (!result.info) {
        setError("Canvas opened but no URL was returned.");
        return;
      }

      setActiveCanvas(result.info);
      if (!hadActiveConnection) {
        onClipboardNotice({
          kind: "success",
          text: "Canvas URL copied. Open it in a browser on your laptop or tablet.",
        });
      }
      onOpen(result.info);
    },
    [invoke, onOpen, onClipboardNotice, activeCanvas, connectionStatus],
  );

  const handleSubmit = useCallback(() => {
    if (isCreateMode) {
      handleOpen(filter.trim());
    } else if (filtered.length > 0) {
      handleOpen(filtered[selectedIndex]!);
    }
  }, [isCreateMode, filter, filtered, selectedIndex, handleOpen]);

  const handleCopyUrl = useCallback(() => {
    if (!activeCanvas?.url) return;
    writeClipboardText(invoke, activeCanvas.url)
      .then(() => {
        setError(null);
        onClipboardNotice({
          kind: "success",
          text: "Canvas URL copied. Paste it in your browser.",
        });
      })
      .catch(() => {
        onClipboardNotice({
          kind: "error",
          text: "Could not copy canvas URL.",
        });
        setError(
          "Clipboard write failed. Copy may be blocked by OS/browser permissions.",
        );
      });
  }, [activeCanvas, invoke, onClipboardNotice]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const len = isCreateMode ? 1 : filtered.length;
        if (len > 0) setSelectedIndex((i) => (i + 1) % len);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const len = isCreateMode ? 1 : filtered.length;
        if (len > 0) setSelectedIndex((i) => (i - 1 + len) % len);
      } else if (e.key === "Enter") {
        handleSubmit();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, selectedIndex, isCreateMode, handleSubmit, onClose]);

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
      <div className="canvas-popover-backdrop" onClick={onClose}>
        <div className="canvas-popover" onClick={(e) => e.stopPropagation()}>
          <div
            style={{
              padding: "16px",
              color: "var(--patina)",
              fontSize: "13px",
            }}
          >
            Loading canvases...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-popover-backdrop" onClick={onClose}>
      <div className="canvas-popover" onClick={(e) => e.stopPropagation()}>
        {activeCanvas && (
          <div className="canvas-popover__active">
            <span
              className="picker-item__dot"
              style={{ background: statusDotColor(connectionStatus) }}
            />
            <span className="canvas-popover__active-name">
              {activeCanvas.name}
            </span>
            <button
              className="canvas-popover__copy-btn"
              onClick={handleCopyUrl}
            >
              Copy URL
            </button>
          </div>
        )}

        <div style={{ padding: "8px 12px 4px" }}>
          <input
            ref={inputRef}
            className="modal__input"
            placeholder="Filter or create canvas..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
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
              <span className="picker-item__create">
                + Create new canvas: "{filter.trim()}"
              </span>
            </div>
          ) : (
            <div
              style={{
                padding: "12px 16px",
                color: "var(--patina)",
                fontSize: "13px",
              }}
            >
              No canvases found. Type a name to create one.
            </div>
          )}
        </div>

        {error && (
          <div className="modal__error" style={{ margin: "4px 12px 8px" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
