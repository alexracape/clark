import React, { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble.tsx";
import { ToolCard } from "./ToolCard.tsx";
import type { ChatItem, ToolCall } from "../app-controller.ts";
import { renderMarkdown } from "../markdown.ts";

interface ChatWindowProps {
  chatItems: ChatItem[];
  pendingToolCalls: ToolCall[];
  streamingText: string | null;
  streamingThinking: string | null;
  isStreaming: boolean;
}

export function ChatWindow({
  chatItems,
  pendingToolCalls,
  streamingText,
  streamingThinking,
  isStreaming,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatItems, streamingText, streamingThinking, pendingToolCalls]);

  if (chatItems.length === 0 && !isStreaming) {
    return (
      <div className="chat-messages">
        <div className="empty-state">
          <div className="empty-state__title">Clark</div>
          <div className="empty-state__subtitle">
            Your AI study companion. Ask a question, drop in a file, or type /help to get started.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-messages" ref={scrollRef}>
      <div className="chat-messages__inner">
        {chatItems.map((item, i) => {
          if (item.type === "message") {
            return <MessageBubble key={item.message.id} message={item.message} />;
          }
          return <ToolCard key={`tool-${i}`} name={item.toolCall.name} result={item.toolCall.result} />;
        })}

        {/* Pending tool calls (during streaming, before flushed) */}
        {pendingToolCalls.map((tc, i) => (
          <ToolCard key={`pending-${i}`} name={tc.name} result={tc.result} pending={!tc.result} />
        ))}

        {/* Thinking indicator */}
        {streamingThinking && (
          <div className="thinking-indicator">
            <div className="thinking-indicator__header">
              <div className="thinking-dots">
                <span />
                <span />
                <span />
              </div>
              <span>Thinking...</span>
            </div>
            <div
              className="thinking-indicator__content"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(streamingThinking),
              }}
            />
          </div>
        )}

        {/* Streaming assistant response */}
        {streamingText !== null && streamingText !== "" && (
          <div className="message message--assistant">
            <div className="message__content">
              <div
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(streamingText),
                }}
              />
              <span className="streaming-cursor" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
