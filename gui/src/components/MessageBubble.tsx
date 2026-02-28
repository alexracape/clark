import React from "react";
import { ToolCard } from "./ToolCard.tsx";
import type { Message } from "../app-controller.ts";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const roleClass = `message message--${message.role}`;

  return (
    <div className={roleClass}>
      <div className="message__bubble">
        {message.role !== "system" && (
          <div className="message__label">
            {message.role === "user" ? "you" : "clark"}
          </div>
        )}

        {message.role === "assistant" ? (
          <div
            className="message__content"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(message.text),
            }}
          />
        ) : (
          <div className="message__content">{message.text}</div>
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="message__tools">
            {message.toolCalls.map((tc, i) => (
              <ToolCard key={i} name={tc.name} result={tc.result} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple markdown rendering */
function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Code blocks
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

  // Lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/\n/g, "<br>");
  html = html.replace(/<p><\/p>/g, "");

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
