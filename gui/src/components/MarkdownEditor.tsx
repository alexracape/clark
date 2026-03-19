import React, { useEffect, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import type { ChatItem, EditorFile, ToolCall } from "../app-controller.ts";
import type { WikilinkTarget } from "../note-paths.ts";
import { ConversationRail } from "./ConversationRail.tsx";
import { WikiLink } from "../extensions/WikiLink.ts";
import { WikiLinkSuggestion } from "../extensions/WikiLinkSuggestion.ts";
import { SmartPairs } from "../extensions/SmartPairs.ts";
import { SlashCommands } from "../extensions/SlashCommands.ts";
import { EmbeddedImage } from "../extensions/EmbeddedImage.ts";
import { getSidecarBaseUrl } from "../ipc.ts";

interface MarkdownEditorProps {
  file: EditorFile;
  onSave: (path: string, content: string) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onOpenNote: (noteName: string) => void;
  noteNames: WikilinkTarget[];
  chatItems: ChatItem[];
  streamingText: string | null;
  isStreaming: boolean;
  pendingToolCalls: ToolCall[];
}

export function MarkdownEditor({ file, onSave, onClose, onDirtyChange, onOpenNote, noteNames, chatItems, streamingText, isStreaming, pendingToolCalls }: MarkdownEditorProps) {
  const [assetBaseUrl, setAssetBaseUrl] = React.useState<string>(
    "http://localhost:3456",
  );
  const lastLoadedKeyRef = React.useRef<string>("");

  useEffect(() => {
    let cancelled = false;

    getSidecarBaseUrl()
      .then((url) => {
        if (!cancelled) setAssetBaseUrl(url);
      })
      .catch(() => {
        if (!cancelled) setAssetBaseUrl("http://localhost:3456");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown,
      Placeholder.configure({ placeholder: "Start writing..." }),
      WikiLink.configure({ onOpen: onOpenNote }),
      WikiLinkSuggestion.configure({ noteNames }),
      SmartPairs,
      SlashCommands.configure({ noteNames }),
      EmbeddedImage.configure({
        assetBaseUrl,
      }),
    ],
    content: file.content,
    contentType: "markdown",
    onUpdate: () => onDirtyChange(true),
    editorProps: {
      attributes: { class: "markdown-editor__content" },
    },
  }, [assetBaseUrl, noteNames, onOpenNote]);

  // Re-open the current file when the file changes or when the asset base URL
  // changes, so embedded image nodes can be normalized against the right sidecar.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      const loadKey = `${file.path}::${assetBaseUrl}`;
      if (lastLoadedKeyRef.current === loadKey) return;

      editor.commands.setContent(file.content, { contentType: "markdown" });
      onDirtyChange(false);
      lastLoadedKeyRef.current = loadKey;
    }
  }, [assetBaseUrl, editor, file.content, file.path, onDirtyChange]);

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

      <ConversationRail
        chatItems={chatItems}
        streamingText={streamingText}
        isStreaming={isStreaming}
        pendingToolCalls={pendingToolCalls}
        onExpandToChat={onClose}
      />
    </div>
  );
}
