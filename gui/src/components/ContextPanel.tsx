import React, { useState, useEffect } from "react";

interface ContextBreakdown {
  userTokens: number;
  assistantTokens: number;
  toolTokens: number;
  thinkingTokens: number;
  imageCount: number;
  totalTokens: number;
  messageCount: number;
}

interface ContextPanelProps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}

const CATEGORIES = [
  { key: "userTokens", label: "User messages", color: "#3D7A5F" },
  { key: "assistantTokens", label: "Assistant responses", color: "#7EB8C9" },
  { key: "toolTokens", label: "Tool results", color: "#C9A84C" },
  { key: "thinkingTokens", label: "Thinking", color: "#6DBFB8" },
] as const;

export function ContextPanel({ invoke, onClose }: ContextPanelProps) {
  const [data, setData] = useState<ContextBreakdown | null>(null);

  useEffect(() => {
    invoke("get_context", {})
      .then((res) => setData(res as ContextBreakdown))
      .catch(() => {});
  }, [invoke]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!data) return null;

  // Assume 200k context window for bar visualization
  const maxTokens = 200_000;
  const usedPercent = Math.min((data.totalTokens / maxTokens) * 100, 100);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span>Context Window</span>
          <button className="modal__close" onClick={onClose}>Esc</button>
        </div>

        <div className="modal__body" style={{ padding: "16px" }}>
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "13px" }}>
              <span style={{ color: "var(--walnut)" }}>
                ~{data.totalTokens.toLocaleString()} tokens used
              </span>
              <span style={{ color: "var(--patina)" }}>
                {usedPercent.toFixed(1)}% of ~{(maxTokens / 1000).toFixed(0)}k
              </span>
            </div>

            {/* Usage bar */}
            <div className="context-bar">
              {CATEGORIES.map(({ key, color }) => {
                const tokens = data[key];
                if (tokens === 0) return null;
                const width = (tokens / maxTokens) * 100;
                return (
                  <div
                    key={key}
                    className="context-bar__segment"
                    style={{ width: `${width}%`, background: color }}
                    title={`${key}: ${tokens.toLocaleString()} tokens`}
                  />
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="context-legend">
            {CATEGORIES.map(({ key, label, color }) => (
              <div key={key} className="context-legend__item">
                <div className="context-legend__swatch" style={{ background: color }} />
                <span className="context-legend__label">{label}</span>
                <span className="context-legend__value">
                  {data[key].toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--patina)" }}>
            {data.messageCount} messages, {data.imageCount} images
          </div>
        </div>
      </div>
    </div>
  );
}
