import React from "react";

/** Friendly tool names for the process indicator */
const TOOL_DISPLAY: Record<string, string> = {
  read_file: "Reading file",
  create_file: "Creating file",
  list_directory: "Browsing files",
  transcribe_pdf: "Reading PDF",
  export_canvas: "Exporting canvas",
  search_files: "Searching",
  get_canvas_snapshot: "Capturing canvas",
};

interface BottomBarProps {
  isStreaming: boolean;
  currentTool: string | null;
}

export function BottomBar({ isStreaming, currentTool }: BottomBarProps) {
  const toolLabel = currentTool
    ? TOOL_DISPLAY[currentTool] ?? `Running ${currentTool}`
    : null;

  const showIndicator = isStreaming;

  return (
    <div className="bottombar">
      <div className="bottombar__left">
        {showIndicator && (
          <div className="bottombar__process">
            <div className="bottombar__spinner" />
            <span>{toolLabel ?? "Thinking..."}</span>
          </div>
        )}
      </div>
      <div className="bottombar__right" />
    </div>
  );
}
