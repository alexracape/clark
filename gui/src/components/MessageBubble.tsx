import React from "react";
import type { Message } from "../app-controller.ts";
import { renderMarkdown } from "../markdown.ts";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const roleClass = `message message--${message.role}`;

  return (
    <div className={roleClass}>
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
    </div>
  );
}
