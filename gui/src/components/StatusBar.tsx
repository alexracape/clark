import React from "react";

interface CanvasStatus {
  status: string;
  canvasName?: string;
  canvasUrl?: string;
}

interface StatusBarProps {
  provider: string;
  model: string;
  currentTool: string | null;
  isStreaming: boolean;
  canvasStatus: CanvasStatus | null;
  onToggleSidebar: () => void;
  onModelClick: () => void;
  onCanvasClick: () => void;
}

/** Friendly tool names for the process indicator */
const TOOL_DISPLAY: Record<string, string> = {
  read_file: "Reading file...",
  create_file: "Creating file...",
  list_directory: "Browsing files...",
  transcribe_pdf: "Reading PDF...",
  export_canvas: "Exporting canvas...",
  search_files: "Searching...",
  get_canvas_snapshot: "Capturing canvas...",
};

const CANVAS_STATUS_COLORS: Record<string, string> = {
  connected: "#81C784",
  connecting: "#C4A85A",
  reconnecting: "#C4A85A",
  disconnected: "#C47A5A",
  failed: "#C47A5A",
};

export function StatusBar({
  provider,
  model,
  currentTool,
  isStreaming,
  canvasStatus,
  onToggleSidebar,
  onModelClick,
  onCanvasClick,
}: StatusBarProps) {
  const toolLabel = currentTool
    ? TOOL_DISPLAY[currentTool] ?? `Running ${currentTool}...`
    : null;

  const canvasDotColor = canvasStatus
    ? CANVAS_STATUS_COLORS[canvasStatus.status] ?? "#C47A5A"
    : undefined;

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <button
          className="status-bar__sidebar-btn"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontSize: "16px",
            padding: "4px",
            WebkitAppRegion: "no-drag" as unknown as string,
          }}
        >
          {"\u2630"}
        </button>
        <button
          className="status-bar__clickable"
          onClick={onModelClick}
          title="Switch model"
        >
          <span className="status-bar__provider">{provider || "..."}</span>
          {model && <span className="status-bar__model">{model}</span>}
        </button>
      </div>

      <div className="status-bar__right">
        {canvasStatus && (
          <button
            className="status-bar__canvas"
            onClick={onCanvasClick}
            title={canvasStatus.canvasName
              ? `Canvas: ${canvasStatus.canvasName} (${canvasStatus.status})`
              : "Open canvas"}
          >
            <span
              className="status-bar__dot"
              style={{ background: canvasDotColor }}
            />
            {canvasStatus.canvasName && (
              <span>{canvasStatus.canvasName}</span>
            )}
          </button>
        )}

        {isStreaming && toolLabel && (
          <div className="status-bar__process">
            <div className="status-bar__spinner" />
            <span>{toolLabel}</span>
          </div>
        )}
        {isStreaming && !toolLabel && (
          <div className="status-bar__process">
            <div className="status-bar__spinner" />
            <span>Thinking...</span>
          </div>
        )}
      </div>
    </div>
  );
}
