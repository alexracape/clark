import React, { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble.tsx";
import type { Message } from "../App.tsx";

interface ChatWindowProps {
  messages: Message[];
  streamingText: string | null;
  streamingThinking: string | null;
  isStreaming: boolean;
}

export function ChatWindow({
  messages,
  streamingText,
  streamingThinking,
  isStreaming,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, streamingThinking]);

  if (messages.length === 0 && !isStreaming) {
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
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Thinking indicator */}
        {streamingThinking && (
          <div className="thinking-indicator">
            <div className="thinking-dots">
              <span />
              <span />
              <span />
            </div>
            <span>Thinking...</span>
          </div>
        )}

        {/* Streaming assistant response */}
        {streamingText !== null && streamingText !== "" && (
          <div className="message message--assistant">
            <div className="message__bubble">
              <div className="message__label">clark</div>
              <div
                className="message__content"
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

/** Simple markdown rendering (no external dependency) */
function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Code blocks (must come before inline code)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, _lang, code) => `<pre><code>${code}</code></pre>`,
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  // Single newlines → <br>
  html = html.replace(/\n/g, "<br>");

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, "");

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
