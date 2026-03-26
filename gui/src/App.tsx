import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChatWindow } from "./components/ChatWindow.tsx";
import { Composer } from "./components/Composer.tsx";
import { Titlebar } from "./components/Titlebar.tsx";

import { Sidebar } from "./components/Sidebar.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { CanvasPicker } from "./components/CanvasPicker.tsx";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { Settings } from "./components/Settings.tsx";
import { Onboarding } from "./components/Onboarding.tsx";
import { Tutorial } from "./components/Tutorial.tsx";
import { MarkdownEditor } from "./components/MarkdownEditor.tsx";
import { SessionPicker } from "./components/SessionPicker.tsx";
import { invokeCommand, listenEvent } from "./ipc.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  applyFileDropError,
  applySendError,
  closeEditorFile,
  dismissIngestion,
  applySlashCommandError,
  applySlashCommandResult,
  applyStreamEvent,
  completeOnboarding,
  createInitialAppState,
  markEditorDirty,
  openEditorFile,
  renameEditorFile,
  updateEditorDraft,
  updateEditorContent,
  onboardingNextStep,
  onboardingPrevStep,
  onCanvasOpened,
  planFileDrop,
  planSendInput,
  setOnboardingBetaCode,
  setOnboardingWorkspace,
  setOnboardingWorkspaceIsNew,
  setOnboardingError,
  setOnboardingSubmitting,
  setProviderInfo,
  setShowCanvasPicker,
  setShowContextPanel,
  setShowModelPicker,
  setShowSettings,
  setShowSessionPicker,
  setSessionList,
  applyRestoredSession,
  startOnboarding,
  tutorialNextStep,
  completeTutorial,
  type AppState,
  type ControllerEffect,
  type IngestionStatus,
  type SlashCommandResponse,
  type SessionInfo,
  type LLMMessage,
} from "./app-controller.ts";
import { parseSidecarStreamEvent } from "./stream-events.ts";
import {
  collectWikilinkTargets,
  type FileListEntry,
  type WikilinkTarget,
} from "./note-paths.ts";

export type { Message } from "./app-controller.ts";

type FileListResponse = {
  files?: FileListEntry[];
};

async function loadWikiLinkTargets(rootPath = ""): Promise<WikilinkTarget[]> {
  const seen = new Map<string, FileListEntry>();

  async function visit(path: string): Promise<void> {
    const command = path ? "list_files_at" : "list_files";
    const args = path ? { path } : {};
    const res = (await invokeCommand(command, args)) as FileListResponse;
    const files = res.files ?? [];

    for (const file of files) {
      if (file.type === "file") {
        seen.set(file.path, file);
      }
    }

    for (const file of files) {
      if (file.type === "directory") {
        await visit(file.path);
      }
    }
  }

  await visit(rootPath);
  return collectWikilinkTargets(Array.from(seen.values()));
}

async function runEffects(
  effects: ControllerEffect[],
  setState: React.Dispatch<React.SetStateAction<AppState>>,
): Promise<void> {
  for (const effect of effects) {
    if (effect.type !== "invoke") continue;

    if (effect.command === "slash_command") {
      try {
        const result = (await invokeCommand(effect.command, effect.args)) as SlashCommandResponse;
        setState((prev) => applySlashCommandResult(prev, result));
      } catch (err) {
        setState((prev) => applySlashCommandError(prev, err));
      }
      continue;
    }

    if (effect.command === "send_message") {
      try {
        await invokeCommand(effect.command, effect.args);
      } catch (err) {
        setState((prev) => applySendError(prev, err));
      }
      continue;
    }

    if (effect.command === "ingest_file") {
      try {
        // Response returns immediately after file copy; background pipeline
        // broadcasts ingest_start/progress/complete events via WebSocket.
        await invokeCommand(effect.command, effect.args);
      } catch (err) {
        setState((prev) => applyFileDropError(prev, err));
      }
    }
  }
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function IngestToastStack({
  ingestions,
  onDismiss,
}: {
  ingestions: Record<string, IngestionStatus>;
  onDismiss: (fileName: string) => void;
}) {
  const entries = Object.values(ingestions);
  if (entries.length === 0) return null;

  return (
    <div className="ingest-toast-stack">
      {entries.map((ing) => (
        <IngestToastItem key={ing.fileName} ingestion={ing} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function IngestToastItem({
  ingestion,
  onDismiss,
}: {
  ingestion: IngestionStatus;
  onDismiss: (fileName: string) => void;
}) {
  useEffect(() => {
    if (ingestion.stage === "complete" || ingestion.stage === "error") {
      const timer = setTimeout(() => onDismiss(ingestion.fileName), 3000);
      return () => clearTimeout(timer);
    }
  }, [ingestion.stage, ingestion.fileName, onDismiss]);

  const stageLabel =
    ingestion.stage === "copying" ? "Organizing..."
    : ingestion.stage === "transcribing" ? "Transcribing..."
    : ingestion.stage === "linking" ? "Linking..."
    : ingestion.stage === "complete" ? "Done"
    : "Error";

  const className = `ingest-toast${
    ingestion.stage === "complete" ? " ingest-toast--complete"
    : ingestion.stage === "error" ? " ingest-toast--error"
    : ""
  }`;

  return (
    <div className={className}>
      <div className="ingest-toast__status" aria-hidden="true">
        {ingestion.stage === "complete" ? (
          <span className="ingest-toast__icon">&#10003;</span>
        ) : ingestion.stage === "error" ? (
          <span className="ingest-toast__icon">&#10007;</span>
        ) : (
          <span className="ingest-toast__spinner" />
        )}
      </div>
      <div className="ingest-toast__body">
        <span className="ingest-toast__filename">{ingestion.fileName}</span>
        <span className="ingest-toast__stage">
          {ingestion.stage === "error" ? ingestion.message : stageLabel}
        </span>
      </div>
      <button
        type="button"
        className="ingest-toast__close"
        onClick={() => onDismiss(ingestion.fileName)}
        aria-label={`Dismiss ${ingestion.fileName} notification`}
        title="Dismiss notification"
      >
        &#10005;
      </button>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<AppState>(() => createInitialAppState());
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [clipboardToast, setClipboardToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [noteNames, setNoteNames] = useState<WikilinkTarget[]>([]);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Check onboarding + status on mount before revealing the UI
  useEffect(() => {
    Promise.all([
      invokeCommand("get_onboarding_status", {}).catch(() => ({ needsOnboarding: false })),
      invokeCommand("get_status", {}).catch(() => ({ provider: "", model: "" })),
    ]).then(([obData, statusData]) => {
      const obResult = obData as { needsOnboarding: boolean };
      const status = statusData as { provider: string; model: string };
      setState((prev) => {
        let next = setProviderInfo(prev, { provider: status.provider, model: status.model });
        if (obResult.needsOnboarding) {
          next = startOnboarding(next);
        }
        return next;
      });
      setReady(true);
    });
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    listenEvent("sidecar:event", (e) => {
      const event = parseSidecarStreamEvent(e.payload);
      if (!event) return;
      setState((prev) => applyStreamEvent(prev, event));
    }).then((unsub) => {
      cleanup = unsub;
    });

    return () => cleanup?.();
  }, []);

  const handleResume = useCallback(async () => {
    try {
      const res = (await invokeCommand("list_sessions", {})) as { sessions: SessionInfo[] };
      const sessions = res.sessions ?? [];
      if (sessions.length === 0) {
        setState((prev) => {
          const id = String(prev.nextMessageId + 1);
          return {
            ...prev,
            nextMessageId: prev.nextMessageId + 1,
            chatItems: [...prev.chatItems, { type: "message", message: { id, role: "system", text: "No saved sessions found." } }],
          };
        });
        return;
      }
      setState((prev) => {
        let next = setSessionList(prev, sessions);
        next = setShowSessionPicker(next, true);
        return next;
      });
    } catch (err) {
      setState((prev) => {
        const id = String(prev.nextMessageId + 1);
        return {
          ...prev,
          nextMessageId: prev.nextMessageId + 1,
          chatItems: [...prev.chatItems, { type: "message", message: { id, role: "system", text: `Failed to list sessions: ${String(err)}` } }],
        };
      });
    }
  }, []);

  const handleSessionSelect = useCallback(async (session: SessionInfo) => {
    setState((prev) => setShowSessionPicker(prev, false));
    try {
      const res = (await invokeCommand("load_session", { path: session.path })) as {
        messages: LLMMessage[];
        date: string;
      };
      setState((prev) => applyRestoredSession(prev, res.messages, session.date));
    } catch (err) {
      setState((prev) => {
        const id = String(prev.nextMessageId + 1);
        return {
          ...prev,
          nextMessageId: prev.nextMessageId + 1,
          chatItems: [...prev.chatItems, { type: "message", message: { id, role: "system", text: `Failed to load session: ${String(err)}` } }],
        };
      });
    }
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      if (text.trim() === "/note") {
        await handleNewNote();
        return;
      }
      if (text.trim() === "/resume") {
        await handleResume();
        return;
      }
      const plan = planSendInput(state, text);
      setState(plan.state);
      await runEffects(plan.effects, setState);
    },
    // handleNewNote and handleResume are useCallback([]) — stable across renders, safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );

  const handleFileDrop = useCallback(
    async (path: string) => {
      const plan = planFileDrop(stateRef.current, path);
      setState(plan.state);
      await runEffects(plan.effects, setState);
    },
    [],
  );

  const handleFileSelect = useCallback(
    async (path: string) => {
      if (!path.endsWith(".md")) return;
      try {
        const data = (await invokeCommand("read_file_content", { path })) as {
          path: string;
          content: string;
        };
        setState((prev) => openEditorFile(prev, data.path, data.content));
      } catch (err) {
        setState((prev) => applySendError(prev, err));
      }
    },
    [],
  );

  // Load flat list of note names for wiki-link autocomplete whenever the editor opens
  useEffect(() => {
    if (!state.editorFile) return;
    loadWikiLinkTargets()
      .then(setNoteNames)
      .catch(() => {});
  }, [state.editorFile?.path]);

  // Open a note by name from a wiki link click.
  // Resolves the bare name to a full workspace-relative path via the server,
  // falling back to creating a new note in the notes directory.
  const handleOpenNote = useCallback(
    async (noteName: string) => {
      // Don't handle non-markdown file references (e.g. PDFs, images)
      // — those are embedded assets, not notes to open
      if (/\.(pdf|png|jpe?g|gif|svg|webp|bmp|tiff?)$/i.test(noteName)) return;

      try {
        const res = (await invokeCommand("resolve_note", { name: noteName })) as {
          name: string;
          path: string | null;
        };
        if (res.path) {
          handleFileSelect(res.path);
          return;
        }
      } catch {
        // Resolution failed — fall through to create
      }

      // Note doesn't exist — create in the notes directory (use config)
      let notesDir = "Notes";
      try {
        const settings = (await invokeCommand("get_settings", {})) as {
          fileRouting: { notes?: string };
        };
        notesDir = settings.fileRouting?.notes || "Notes";
      } catch { /* use default */ }
      const newPath = `${notesDir}/${noteName}.md`;
      try {
        await invokeCommand("write_file_content", { path: newPath, content: "" });
        setState((prev) => openEditorFile(prev, newPath, ""));
      } catch (err) {
        setState((prev) => applySendError(prev, err));
      }
    },
    [handleFileSelect],
  );

  const handleEditorSave = useCallback(
    async (path: string, content: string) => {
      try {
        await invokeCommand("write_file_content", { path, content });
        setState((prev) => updateEditorContent(prev, content));
      } catch (err) {
        setState((prev) => applySendError(prev, err));
      }
    },
    [],
  );

  const handleRenameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      try {
        await invokeCommand("rename_file", { oldPath, newPath });
        setState((prev) => renameEditorFile(prev, newPath));
        setSidebarRefreshKey((k) => k + 1);
        loadWikiLinkTargets().then(setNoteNames).catch(() => {});
        return true;
      } catch (err) {
        setState((prev) => applySendError(prev, err));
        return false;
      }
    },
    [],
  );

  const handleNewNote = useCallback(async () => {
    try {
      // Fetch settings to get the notes directory from fileRouting config
      const settings = (await invokeCommand("get_settings", {})) as {
        fileRouting: { notes?: string };
      };
      const notesDir = settings.fileRouting?.notes || "Notes";

      // List existing files in the notes directory to find next counter
      let existingFiles: string[] = [];
      try {
        const res = (await invokeCommand("list_files_at", { path: notesDir })) as {
          files?: { name: string }[];
        };
        existingFiles = (res.files ?? []).map((f) => f.name);
      } catch {
        // Directory may not exist yet — that's fine
      }

      // Find next available "Untitled N" name
      let newName = "Untitled";
      if (existingFiles.includes("Untitled.md")) {
        let counter = 2;
        while (existingFiles.includes(`Untitled ${counter}.md`)) {
          counter++;
        }
        newName = `Untitled ${counter}`;
      }

      const newPath = `${notesDir}/${newName}.md`;
      await invokeCommand("write_file_content", { path: newPath, content: "" });
      setState((prev) => openEditorFile(prev, newPath, ""));
      setSidebarRefreshKey((k) => k + 1);
      loadWikiLinkTargets().then(setNoteNames).catch(() => {});
    } catch (err) {
      setState((prev) => applySendError(prev, err));
    }
  }, []);

  useEffect(() => {
    if (isTauri) {
      // Tauri v2: use native window drag-drop events (browser DOM events don't
      // fire for OS-level file drops in Tauri).
      let unlisten: (() => void) | undefined;
      getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragging(true);
        } else if (payload.type === "drop") {
          setIsDragging(false);
          for (const path of payload.paths) {
            void handleFileDrop(path);
          }
        } else if (payload.type === "leave") {
          setIsDragging(false);
        }
      }).then((fn) => { unlisten = fn; });
      return () => unlisten?.();
    }

    // Non-Tauri fallback (browser dev mode): use DOM drag events.
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (e.relatedTarget === null) setIsDragging(false);
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer?.files;
      if (files?.[0]) {
        const file = files[0];
        if ("path" in file && typeof (file as { path: string }).path === "string") {
          void handleFileDrop((file as { path: string }).path);
        }
      }
    };
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleFileDrop]);

  useEffect(() => {
    if (!clipboardToast) return;
    const timer = setTimeout(() => setClipboardToast(null), 2200);
    return () => clearTimeout(timer);
  }, [clipboardToast]);

  const handleOnboardingComplete = useCallback(async () => {
    const ob = state.onboarding;
    if (!ob) return;
    setState((prev) => setOnboardingSubmitting(prev, true));
    try {
      // Redeem beta code if provided
      if (ob.betaCode.trim()) {
        const result = (await invokeCommand("redeem_beta", {
          code: ob.betaCode.trim(),
        })) as { success?: boolean; error?: string };
        if (!result.success) {
          throw new Error(result.error ?? "Invalid beta code");
        }
      }

      await invokeCommand("complete_onboarding", {
        workspaceDir: ob.workspaceDir || undefined,
        workspaceIsNew: ob.workspaceIsNew,
      });
      const data = (await invokeCommand("get_status", {})) as { provider: string; model: string };
      setState((prev) => {
        let next = completeOnboarding(prev);
        next = setProviderInfo(next, { provider: data.provider, model: data.model });
        return next;
      });
    } catch (err) {
      setState((prev) => {
        let next = setOnboardingSubmitting(prev, false);
        next = setOnboardingError(next, String(err));
        return next;
      });
    }
  }, [state.onboarding]);

  const handlePickFolder = useCallback(async (): Promise<string | null> => {
    try {
      return (await invokeCommand("pick_folder", {})) as string | null;
    } catch {
      return null;
    }
  }, []);

  // Show blank parchment until we know whether to show onboarding or main UI
  if (!ready) {
    return <div className="app-layout" />;
  }

  if (state.onboarding) {
    return (
      <div className="app-layout">
        <Onboarding
          state={state.onboarding}
          isTauri={isTauri}
          onNext={() => setState((prev) => onboardingNextStep(prev))}
          onPrev={() => setState((prev) => onboardingPrevStep(prev))}
          onSetBetaCode={(code) => setState((prev) => setOnboardingBetaCode(prev, code))}
          onSetWorkspace={(dir) => setState((prev) => setOnboardingWorkspace(prev, dir))}
          onSetWorkspaceIsNew={(isNew) => setState((prev) => setOnboardingWorkspaceIsNew(prev, isNew))}
          onPickFolder={handlePickFolder}
          onComplete={handleOnboardingComplete}
        />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Titlebar
        provider={state.providerInfo.provider}
        model={state.providerInfo.model}
        canvasStatus={state.canvasStatus}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onModelClick={() => setState((prev) => setShowModelPicker(prev, true))}
        onCanvasClick={() => setState((prev) => setShowCanvasPicker(prev, true))}
        onSettingsClick={() => setState((prev) => setShowSettings(prev, true))}
      />

      <div className="app-main">
        <Sidebar open={sidebarOpen} invoke={invokeCommand} onFileSelect={handleFileSelect} onNewNote={handleNewNote} refreshKey={sidebarRefreshKey} />

        <div className="chat-window">
          {state.editorFile ? (
            <MarkdownEditor
              file={state.editorFile}
              onSave={handleEditorSave}
              onClose={() => setState((prev) => closeEditorFile(prev))}
              onDirtyChange={(dirty, content) => setState((prev) => {
                if (typeof content === "string") {
                  if (!dirty) {
                    return updateEditorContent(prev, content);
                  }
                  return updateEditorDraft(prev, content);
                }
                return markEditorDirty(prev, dirty);
              })}
              onOpenNote={handleOpenNote}
              onRename={handleRenameFile}
              onNewNote={handleNewNote}
              noteNames={noteNames}
              chatItems={state.chatItems}
              streamingText={state.streamingText}
              isStreaming={state.isStreaming}
              pendingToolCalls={state.pendingToolCalls}
            />
          ) : (
            <ChatWindow
              chatItems={state.chatItems}
              pendingToolCalls={state.pendingToolCalls}
              streamingText={state.streamingText}
              streamingThinking={state.streamingThinking}
              isStreaming={state.isStreaming}
            />
          )}

          <IngestToastStack
            ingestions={state.activeIngestions}
            onDismiss={(fileName) => setState((prev) => dismissIngestion(prev, fileName))}
          />

          <Composer onSend={handleSend} disabled={state.isStreaming} />
        </div>
      </div>

      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay__icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div className="drag-overlay__text">Drop to import</div>
        </div>
      )}

      {state.showModelPicker && (
        <ModelPicker
          invoke={invokeCommand}
          onSelect={(provider, model) => {
            setState((prev) => {
              let next = setProviderInfo(prev, { provider, model });
              next = setShowModelPicker(next, false);
              return next;
            });
          }}
          onClose={() => setState((prev) => setShowModelPicker(prev, false))}
        />
      )}

      {state.showCanvasPicker && (
        <CanvasPicker
          invoke={invokeCommand}
          onOpen={(info) => setState((prev) => onCanvasOpened(prev, info))}
          onClose={() => setState((prev) => setShowCanvasPicker(prev, false))}
          onClipboardNotice={(notice) => setClipboardToast(notice)}
        />
      )}

      {clipboardToast && (
        <div className={`app-toast app-toast--${clipboardToast.kind}`}>
          {clipboardToast.text}
        </div>
      )}

      {state.showContextPanel && (
        <ContextPanel
          invoke={invokeCommand}
          onClose={() => setState((prev) => setShowContextPanel(prev, false))}
        />
      )}

      {state.showSessionPicker && (
        <SessionPicker
          sessions={state.sessionList}
          onSelect={handleSessionSelect}
          onClose={() => setState((prev) => setShowSessionPicker(prev, false))}
        />
      )}

      {state.showSettings && (
        <Settings
          invoke={invokeCommand}
          onClose={() => setState((prev) => setShowSettings(prev, false))}
          onSaved={() => {
            invokeCommand("get_status", {})
              .then((data) => {
                const status = data as { provider: string; model: string };
                setState((prev) => setProviderInfo(prev, { provider: status.provider, model: status.model }));
              })
              .catch(() => {});
          }}
        />
      )}

      {state.tutorial && (
        <Tutorial
          step={state.tutorial.step}
          onNext={() => setState((prev) => tutorialNextStep(prev))}
          onSkip={() => setState((prev) => completeTutorial(prev))}
        />
      )}
    </div>
  );
}
