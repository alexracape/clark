import React from "react";

interface CanvasStatus {
  status: string;
  canvasName?: string;
  canvasUrl?: string;
}

interface TitlebarProps {
  provider: string;
  model: string;
  canvasStatus: CanvasStatus | null;
  onToggleSidebar: () => void;
  onModelClick: () => void;
  onCanvasClick: () => void;
  onSettingsClick: () => void;
}

const CANVAS_STATUS_COLORS: Record<string, string> = {
  connected: "var(--sage)",
  connecting: "var(--warning)",
  reconnecting: "var(--warning)",
  disconnected: "var(--error)",
  failed: "var(--error)",
};

export function Titlebar({
  provider,
  model,
  canvasStatus,
  onToggleSidebar,
  onModelClick,
  onCanvasClick,
  onSettingsClick,
}: TitlebarProps) {
  const canvasDotColor = canvasStatus
    ? CANVAS_STATUS_COLORS[canvasStatus.status] ?? "var(--error)"
    : undefined;

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar__left">
        <button
          className="titlebar__sidebar-btn"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
        >
          {"\u2630"}
        </button>
        <button
          className="titlebar__model-btn"
          onClick={onModelClick}
          title="Switch model"
        >
          <span className="titlebar__provider">{provider || "..."}</span>
          {model && (
            <>
              <span className="titlebar__sep">/</span>
              <span className="titlebar__model">{model}</span>
            </>
          )}
        </button>
      </div>

      <div className="titlebar__right">
        <button
          className="titlebar__canvas-btn"
          onClick={onCanvasClick}
          title={
            canvasStatus?.canvasName
              ? `Canvas: ${canvasStatus.canvasName} (${canvasStatus.status})`
              : "Open canvas"
          }
        >
          {canvasStatus ? (
            <>
              <span
                className="titlebar__dot"
                style={{ background: canvasDotColor }}
              />
              <span>{canvasStatus.canvasName || canvasStatus.status}</span>
            </>
          ) : (
            <span className="titlebar__canvas-dim">No canvas</span>
          )}
        </button>
        <button
          className="titlebar__settings-btn"
          onClick={onSettingsClick}
          title="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
