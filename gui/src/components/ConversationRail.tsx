import React, { useState, useEffect, useRef, useCallback } from "react";
import type { ChatItem, ToolCall } from "../app-controller.ts";
import { renderMarkdown } from "../markdown.ts";

interface ConversationRailProps {
  chatItems: ChatItem[];
  streamingText: string | null;
  isStreaming: boolean;
  pendingToolCalls: ToolCall[];
}

interface QAPair {
  id: string;
  question: string;
  answer: string;
  /** Tool calls that occurred between the user message and the assistant response */
  toolCalls: ToolCall[];
}

/** Friendly labels for tool names (mirrors ToolCard.tsx) */
const TOOL_LABELS: Record<string, string> = {
  read_file: "Read file",
  create_file: "Create file",
  list_directory: "List directory",
  transcribe_pdf: "Transcribe PDF",
  export_canvas: "Export canvas",
  search_files: "Search files",
  get_canvas_snapshot: "Canvas snapshot",
};

function extractQAPairs(chatItems: ChatItem[]): QAPair[] {
  const pairs: QAPair[] = [];
  for (let i = 0; i < chatItems.length; i++) {
    const item = chatItems[i];
    if (item.type !== "message" || item.message.role !== "user") continue;
    const toolCalls: ToolCall[] = [];
    for (let j = i + 1; j < chatItems.length; j++) {
      const next = chatItems[j];
      if (next.type === "tool") {
        toolCalls.push(next.toolCall);
        continue;
      }
      if (next.type === "message" && next.message.role === "assistant") {
        pairs.push({
          id: item.message.id,
          question: item.message.text,
          answer: next.message.text,
          toolCalls,
        });
        break;
      }
      if (next.type === "message" && next.message.role === "user") break;
    }
  }
  return pairs;
}

/** Check if the last chatItem is a user message with no assistant reply yet */
function hasStreamingPair(chatItems: ChatItem[]): { streaming: boolean; question: string; id: string } {
  for (let i = chatItems.length - 1; i >= 0; i--) {
    const item = chatItems[i];
    if (item.type !== "message") continue;
    if (item.message.role === "user") {
      return { streaming: true, question: item.message.text, id: item.message.id };
    }
    if (item.message.role === "assistant") break;
  }
  return { streaming: false, question: "", id: "" };
}

export function ConversationRail({ chatItems, streamingText, isStreaming, pendingToolCalls }: ConversationRailProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStreamingRef = useRef(isStreaming);
  const interactedRef = useRef(false);

  const pairs = extractQAPairs(chatItems);
  const streamingPair = isStreaming ? hasStreamingPair(chatItems) : { streaming: false, question: "", id: "" };

  // Auto-expand the streaming bar
  useEffect(() => {
    if (isStreaming && streamingPair.streaming) {
      setExpandedId(streamingPair.id);
      interactedRef.current = false;
    }
  }, [isStreaming, streamingPair.id]);

  // Auto-collapse after streaming completes
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && expandedId && !interactedRef.current) {
      autoCollapseTimerRef.current = setTimeout(() => {
        setExpandedId((current) => {
          if (current === expandedId) {
            setUnreadIds((prev) => new Set(prev).add(expandedId));
            return null;
          }
          return current;
        });
      }, 5000);
    }
    prevStreamingRef.current = isStreaming;
    return () => {
      if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
    };
  }, [isStreaming, expandedId]);

  // Clear unread after 3s
  useEffect(() => {
    if (unreadIds.size === 0) return;
    const timer = setTimeout(() => setUnreadIds(new Set()), 3000);
    return () => clearTimeout(timer);
  }, [unreadIds.size]);

  const handleBarClick = useCallback((id: string) => {
    interactedRef.current = true;
    if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredId(null);
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleBarMouseEnter = useCallback((id: string) => {
    hoverTimerRef.current = setTimeout(() => setHoveredId(id), 150);
  }, []);

  const handleBarMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoveredId(null);
  }, []);

  const handleCardInteraction = useCallback(() => {
    interactedRef.current = true;
    if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
  }, []);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedId(null);
    setHoveredId(null);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }, []);

  const allBars = [
    ...pairs.map((p) => ({ ...p, type: "complete" as const })),
    ...(isStreaming && streamingPair.streaming
      ? [{
          id: streamingPair.id,
          question: streamingPair.question,
          answer: streamingText ?? "",
          toolCalls: pendingToolCalls,
          type: "streaming" as const,
        }]
      : []),
  ];

  // Dim older bars when there are many
  const getBarOpacityStyle = (index: number, total: number) => {
    if (total <= 10) return undefined;
    const fadeStart = total - 10;
    if (index >= fadeStart) return undefined;
    return { opacity: 0.2 } as React.CSSProperties;
  };

  return (
    <div className="conv-rail">
      {allBars.map((bar, i) => {
        const isExpanded = expandedId === bar.id;
        const isHovered = hoveredId === bar.id && !isExpanded;
        const isUnread = unreadIds.has(bar.id);
        const isStreamingBar = bar.type === "streaming";

        let barClass = "conv-rail__bar";
        if (isExpanded) barClass += " conv-rail__bar--active";
        else if (isStreamingBar) barClass += " conv-rail__bar--streaming";
        else if (isUnread) barClass += " conv-rail__bar--unread";
        else if (isHovered) barClass += " conv-rail__bar--hover";

        return (
          <div
            key={bar.id}
            className={barClass}
            style={!isExpanded && !isStreamingBar && !isUnread ? getBarOpacityStyle(i, allBars.length) : undefined}
            onClick={() => handleBarClick(bar.id)}
            onMouseEnter={() => handleBarMouseEnter(bar.id)}
            onMouseLeave={handleBarMouseLeave}
          >
            {/* Hover tooltip */}
            {isHovered && (
              <div className="conv-rail__tooltip">
                <span className="conv-rail__tooltip-text">{truncateLines(bar.question, 3)}</span>
              </div>
            )}

            {/* Expanded card */}
            {isExpanded && (
              <div
                className={`conv-rail__card${isStreamingBar ? " conv-rail__card--streaming" : ""}`}
                onMouseEnter={handleCardInteraction}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Tool call activity — only shown during streaming */}
                {isStreamingBar && bar.toolCalls.length > 0 && (
                  <div className="conv-rail__tools">
                    {bar.toolCalls.map((tc, j) => (
                      <div key={j} className={`conv-rail__tool${!tc.result ? " conv-rail__tool--pending" : ""}`}>
                        {!tc.result && <span className="conv-rail__tool-spinner" />}
                        <span className="conv-rail__tool-name">{TOOL_LABELS[tc.name] ?? tc.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Thinking indicator when streaming but no text/tools yet */}
                {isStreamingBar && !bar.answer && bar.toolCalls.length === 0 && (
                  <div className="conv-rail__thinking">
                    <span className="conv-rail__tool-spinner" />
                    <span className="conv-rail__tool-name">Thinking...</span>
                  </div>
                )}

                {/* Response body */}
                {bar.answer && (
                  <div
                    className="conv-rail__card-response message__content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(bar.answer) }}
                  />
                )}
                {isStreamingBar && bar.answer && <span className="conv-rail__streaming-cursor" />}
                {!isStreamingBar && (
                  <button className="conv-rail__card-dismiss" onClick={handleDismiss}>
                    Dismiss
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n").slice(0, maxLines);
  let result = lines.join("\n");
  if (result.length > 120) result = result.slice(0, 120) + "...";
  else if (text.split("\n").length > maxLines) result += "...";
  return result;
}
