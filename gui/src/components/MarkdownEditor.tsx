import React, { useEffect, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import type { ChatItem, EditorFile, ToolCall } from "../app-controller.ts";
import { ConversationRail } from "./ConversationRail.tsx";

interface MarkdownEditorProps {
  file: EditorFile;
  onSave: (path: string, content: string) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  chatItems: ChatItem[];
  streamingText: string | null;
  isStreaming: boolean;
  pendingToolCalls: ToolCall[];
}

export function MarkdownEditor({ file, onSave, onClose, onDirtyChange, chatItems, streamingText, isStreaming, pendingToolCalls }: MarkdownEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown,
      Placeholder.configure({ placeholder: "Start writing..." }),
    ],
    content: file.content,
    contentType: "markdown",
    onUpdate: () => onDirtyChange(true),
    editorProps: {
      attributes: { class: "markdown-editor__content" },
    },
  });

  // Re-open different file
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(file.content, { contentType: "markdown" });
      onDirtyChange(false);
    }
  }, [file.path]);

  // Cmd+S save
  const handleSave = useCallback(() => {
    if (!editor) return;
    const raw = editor.getMarkdown();
    // tiptap's paragraph extension serializes empty paragraphs as "&nbsp;"
    // which other editors (Obsidian, etc.) render literally. Strip them
    // everywhere: standalone blank lines, trailing on list items, etc.
    const md = raw.replace(/&nbsp;/g, "");
    onSave(file.path, md);
  }, [editor, file.path, onSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleSave]);

  const fileName = (file.path.split("/").pop() ?? file.path).replace(/\.md$/i, "");

  return (
    <div className="markdown-editor">
      <button className="markdown-editor__close" onClick={onClose} title="Close editor">
        &times;
      </button>

      <div className="markdown-editor__body">
        <div className="markdown-editor__title-row">
          <h1 className="markdown-editor__title">{fileName}</h1>
          {file.dirty && <span className="markdown-editor__dirty-dot" />}
        </div>
        <EditorContent editor={editor} />
      </div>

      <ConversationRail chatItems={chatItems} streamingText={streamingText} isStreaming={isStreaming} pendingToolCalls={pendingToolCalls} />
    </div>
  );
}
