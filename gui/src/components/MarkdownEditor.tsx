import React, { useEffect, useCallback, useRef, useState } from "react";
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
import { InlineMath } from "../extensions/InlineMath.ts";
import { BlockMath } from "../extensions/BlockMath.ts";
import { getSidecarBaseUrl } from "../ipc.ts";
import { normalizeMarkdownEditorContent } from "../editor-content.ts";

interface MarkdownEditorProps {
  file: EditorFile;
  onSave: (path: string, content: string) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean, content?: string) => void;
  onOpenNote: (noteName: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<boolean>;
  onNewNote: () => void;
  noteNames: WikilinkTarget[];
  chatItems: ChatItem[];
  streamingText: string | null;
  isStreaming: boolean;
  pendingToolCalls: ToolCall[];
}

export function MarkdownEditor({ file, onSave, onClose, onDirtyChange, onOpenNote, onRename, onNewNote, noteNames, chatItems, streamingText, isStreaming, pendingToolCalls }: MarkdownEditorProps) {
  const [assetBaseUrl, setAssetBaseUrl] = useState<string>(
    "http://localhost:3456",
  );
  const lastLoadedKeyRef = useRef<string>("");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editable title state
  const fileName = (file.path.split("/").pop() ?? file.path).replace(/\.md$/i, "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(fileName);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const getTitleError = useCallback((rawTitle: string) => {
    const trimmed = rawTitle.trim();
    if (!trimmed) {
      return "File name cannot be empty.";
    }

    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
    const nextPath = `${dir}${trimmed}.md`;
    const hasConflict = noteNames.some((target) => target.path === nextPath && target.path !== file.path);
    if (hasConflict) {
      return "A file with this name already exists.";
    }

    return null;
  }, [file.path, noteNames]);

  const titleError = editingTitle ? getTitleError(titleDraft) : null;

  // Keep draft in sync when file changes externally
  useEffect(() => {
    setTitleDraft(fileName);
    setEditingTitle(false);
  }, [fileName]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const renamePendingRef = useRef(false);

  const commitRename = useCallback(async () => {
    // Guard against double-fire (Enter keyDown + subsequent blur)
    if (renamePendingRef.current) return;
    renamePendingRef.current = true;
    // Read directly from the input DOM element to avoid stale closure
    const trimmed = titleInputRef.current?.value.trim() ?? "";
    if (trimmed === fileName) {
      setEditingTitle(false);
      setTitleDraft(fileName);
      renamePendingRef.current = false;
      return;
    }

    const error = getTitleError(trimmed);
    if (error) {
      renamePendingRef.current = false;
      if (titleInputRef.current) {
        titleInputRef.current.focus();
        titleInputRef.current.select();
      }
      return;
    }

    setEditingTitle(false);
    setTitleDraft(trimmed);
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
    const newPath = `${dir}${trimmed}.md`;
    const ok = await onRename(file.path, newPath);
    if (!ok) {
      setTitleDraft(fileName);
    }
    renamePendingRef.current = false;
  }, [fileName, file.path, getTitleError, onRename]);

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

  const initialContent = normalizeMarkdownEditorContent(file.content);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown,
      Placeholder.configure({
        placeholder: "Start writing...",
        showOnlyWhenEditable: false,
      }),
      WikiLink.configure({ onOpen: onOpenNote }),
      WikiLinkSuggestion.configure({ noteNames }),
      SmartPairs,
      SlashCommands.configure({ noteNames, onNewNote }),
      EmbeddedImage.configure({
        assetBaseUrl,
      }),
      InlineMath,
      BlockMath,
    ],
    content: initialContent,
    contentType: typeof initialContent === "string" ? "markdown" : undefined,
    onUpdate: ({ editor: nextEditor }) => {
      const markdown = nextEditor.getMarkdown().replace(/&nbsp;/g, "");
      onDirtyChange(true, markdown);
    },
    editorProps: {
      attributes: { class: "markdown-editor__content" },
    },
  }, [assetBaseUrl, noteNames, onOpenNote, onNewNote]);

  const focusEditorAtEnd = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.focus("end");
  }, [editor]);

  // Re-open the current file when the file changes or when the asset base URL
  // changes, so embedded image nodes can be normalized against the right sidecar.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      const loadKey = `${file.path}::${assetBaseUrl}`;
      if (!lastLoadedKeyRef.current) {
        lastLoadedKeyRef.current = loadKey;
        onDirtyChange(false, file.content);
        return;
      }
      if (lastLoadedKeyRef.current === loadKey) return;

      const nextContent = normalizeMarkdownEditorContent(file.content);
      if (typeof nextContent === "string") {
        editor.commands.setContent(nextContent, { contentType: "markdown" });
      } else {
        editor.commands.setContent(nextContent);
      }
      onDirtyChange(false, file.content);
      lastLoadedKeyRef.current = loadKey;
    }
  }, [assetBaseUrl, editor, file.content, file.path, onDirtyChange]);

  // Extract markdown from the editor, cleaning up tiptap artifacts
  const getCleanMarkdown = useCallback(() => {
    if (!editor) return "";
    const raw = editor.getMarkdown();
    return raw.replace(/&nbsp;/g, "");
  }, [editor]);

  // Cmd+S immediate save
  const handleSave = useCallback(() => {
    // Clear any pending autosave to avoid double-save
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const md = getCleanMarkdown();
    onSave(file.path, md);
  }, [getCleanMarkdown, file.path, onSave]);

  // Autosave: debounce 1.5s after dirty
  useEffect(() => {
    if (!file.dirty) return;

    autosaveTimerRef.current = setTimeout(() => {
      const md = getCleanMarkdown();
      onSave(file.path, md);
      autosaveTimerRef.current = null;
    }, 1500);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [file.dirty, file.path, getCleanMarkdown, onSave]);

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

  const handleBodyMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest(".markdown-editor__title-block")) return;
    if (target.closest(".ProseMirror")) return;

    e.preventDefault();
    focusEditorAtEnd();
  }, [focusEditorAtEnd]);

  return (
    <div className="markdown-editor">
      <button className="markdown-editor__close" onClick={onClose} title="Close editor">
        &times;
      </button>

      <div className="markdown-editor__body" onMouseDown={handleBodyMouseDown}>
        <div className="markdown-editor__title-block">
          <div className="markdown-editor__title-row">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="markdown-editor__title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => { void commitRename(); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitRename();
                }
                if (e.key === "Escape") {
                  setTitleDraft(fileName);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <h1
              className="markdown-editor__title"
              onClick={() => setEditingTitle(true)}
              title="Click to rename"
            >
              {fileName}
            </h1>
          )}
          {file.dirty && <span className="markdown-editor__dirty-dot" />}
          </div>
          {titleError && <div className="markdown-editor__title-error">{titleError}</div>}
        </div>
        <div className="markdown-editor__content-shell">
          <EditorContent editor={editor} />
        </div>
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
