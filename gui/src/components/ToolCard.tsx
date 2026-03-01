import React, { useState } from "react";

interface ToolCardProps {
  name: string;
  result?: string;
  pending?: boolean;
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

/** Truncate result to a short summary line */
function summarize(text: string, maxLen = 80): string {
  const first = text.split("\n")[0] ?? "";
  return first.length > maxLen ? `${first.slice(0, maxLen)}...` : first;
}

export function ToolCard({ name, result, pending }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const info = TOOL_LABELS[name] ?? { label: name, icon: "\u2192" };

  return (
    <div className={`tool-card ${expanded ? "tool-card--expanded" : ""}`}>
      <div
        className="tool-card__header"
        onClick={() => result && setExpanded((v) => !v)}
      >
        <span className="tool-card__icon">{info.icon}</span>
        <span className="tool-card__label">{info.label}</span>
        {pending && <span className="tool-card__spinner" />}
        {result && <span className="tool-card__summary">{summarize(result)}</span>}
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
