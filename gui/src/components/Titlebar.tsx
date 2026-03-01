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
}

const CANVAS_STATUS_COLORS: Record<string, string> = {
  connected: "#81C784",
  connecting: "#C4A85A",
  reconnecting: "#C4A85A",
  disconnected: "#C47A5A",
  failed: "#C47A5A",
};

export function Titlebar({
  provider,
  model,
  canvasStatus,
  onToggleSidebar,
  onModelClick,
  onCanvasClick,
}: TitlebarProps) {
  const canvasDotColor = canvasStatus
    ? CANVAS_STATUS_COLORS[canvasStatus.status] ?? "#C47A5A"
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
      </div>
    </div>
  );
}
