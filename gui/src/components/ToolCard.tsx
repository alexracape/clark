import React, { useState } from "react";

interface ToolCardProps {
  name: string;
  result?: string;
}

/** Map tool names to friendly display names */
const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  read_file: { label: "Read file", icon: "\u2192" },
  create_file: { label: "Create file", icon: "+" },
  list_directory: { label: "List directory", icon: "\u2261" },
  transcribe_pdf: { label: "Transcribe PDF", icon: "\u2192" },
  export_canvas: { label: "Export canvas", icon: "\u2197" },
  search_files: { label: "Search files", icon: "?" },
  get_canvas_snapshot: { label: "Canvas snapshot", icon: "\u25A1" },
};

export function ToolCard({ name, result }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const info = TOOL_LABELS[name] ?? { label: name, icon: "\u2192" };

  return (
    <div className={`tool-card ${expanded ? "tool-card--expanded" : ""}`}>
      <div
        className="tool-card__header"
        onClick={() => result && setExpanded((v) => !v)}
      >
        <span className="tool-card__icon">{info.icon}</span>
        <span>{info.label}</span>
        {result && <span className="tool-card__chevron">{"\u25B6"}</span>}
      </div>

      {expanded && result && (
        <div className="tool-card__body">
          <pre>{result}</pre>
        </div>
      )}
    </div>
  );
}
