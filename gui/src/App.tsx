import React, { useState, useEffect, useCallback } from "react";
import { ChatWindow } from "./components/ChatWindow.tsx";
import { Composer } from "./components/Composer.tsx";
import { Titlebar } from "./components/Titlebar.tsx";
import { BottomBar } from "./components/BottomBar.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { CanvasPicker } from "./components/CanvasPicker.tsx";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { Onboarding } from "./components/Onboarding.tsx";
import { Tutorial } from "./components/Tutorial.tsx";
import { invokeCommand, listenEvent } from "./ipc.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  applyFileDropError,
  applySendError,
  dismissIngestion,
  applySlashCommandError,
  applySlashCommandResult,
  applyStreamEvent,
  completeOnboarding,
  createInitialAppState,
  onboardingNextStep,
  onboardingPrevStep,
  onCanvasOpened,
  planFileDrop,
  planSendInput,
  setOnboardingApiKey,
  setOnboardingError,
  setOnboardingOllamaModel,
  setOnboardingOllamaModels,
  setOnboardingProvider,
  setOnboardingStepOllama,
  setOnboardingSubmitting,
  setOnboardingWorkspace,
  setOnboardingWorkspaceIsNew,
  setProviderInfo,
  setShowCanvasPicker,
  setShowContextPanel,
  setShowModelPicker,
  startOnboarding,
  tutorialNextStep,
  completeTutorial,
  type AppState,
  type ControllerEffect,
  type IngestionStatus,
  type SlashCommandResponse,
} from "./app-controller.ts";
import { parseSidecarStreamEvent } from "./stream-events.ts";

export type { Message } from "./app-controller.ts";

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
      {ingestion.stage === "complete" ? (
        <span className="ingest-toast__icon">&#10003;</span>
      ) : ingestion.stage === "error" ? (
        <span className="ingest-toast__icon">&#10007;</span>
      ) : (
        <span className="ingest-toast__spinner" />
      )}
      <div className="ingest-toast__body">
        <span className="ingest-toast__filename">{ingestion.fileName}</span>
        <span className="ingest-toast__stage">
          {ingestion.stage === "error" ? ingestion.message : stageLabel}
        </span>
      </div>
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

  const handleSend = useCallback(
    async (text: string) => {
      const plan = planSendInput(state, text);
      setState(plan.state);
      await runEffects(plan.effects, setState);
    },
    [state],
  );

  const handleFileDrop = useCallback(
    async (path: string) => {
      const plan = planFileDrop(state, path);
      setState(plan.state);
      await runEffects(plan.effects, setState);
    },
    [state],
  );

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
      await invokeCommand("complete_onboarding", {
        provider: ob.selectedProvider,
        apiKey: ob.apiKey || undefined,
        workspaceDir: ob.workspaceDir || undefined,
        model: ob.selectedOllamaModel || undefined,
        workspaceIsNew: ob.workspaceIsNew,
      });
      // Refresh status after onboarding
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
      // User cancelled
      return null;
    }
  }, []);

  const handleRefreshOllamaModels = useCallback(async () => {
    try {
      const data = (await invokeCommand("list_ollama_models", {})) as {
        models: string[];
        status: string;
      };
      setState((prev) => {
        let next = setOnboardingOllamaModels(prev, data.models);
        if (data.status === "not-running") {
          next = setOnboardingError(next, "Ollama is not running. Start it with: ollama serve");
        } else if (data.status === "no-models") {
          next = setOnboardingError(next, "No models found. Pull one with: ollama pull llama3.2");
        } else {
          next = setOnboardingError(next, null);
        }
        return next;
      });
    } catch (err) {
      setState((prev) => setOnboardingError(prev, String(err)));
    }
  }, []);

  const handleOllamaNext = useCallback(async () => {
    setState((prev) => setOnboardingStepOllama(prev));
    // Auto-fetch models when entering the ollama setup step
    try {
      const data = (await invokeCommand("list_ollama_models", {})) as {
        models: string[];
        status: string;
      };
      setState((prev) => {
        let next = setOnboardingOllamaModels(prev, data.models);
        if (data.status === "not-running") {
          next = setOnboardingError(next, "Ollama is not running. Start it with: ollama serve");
        } else if (data.status === "no-models") {
          next = setOnboardingError(next, "No models found. Pull one with: ollama pull llama3.2");
        }
        return next;
      });
    } catch {
      // Will show instructions
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
          onPrev={() => {
            if (state.onboarding?.step === "ollama-setup") {
              // Go back from ollama-setup to provider step
              setState((prev) => prev.onboarding
                ? { ...prev, onboarding: { ...prev.onboarding, step: "provider", error: null } }
                : prev);
            } else {
              setState((prev) => onboardingPrevStep(prev));
            }
          }}
          onSetWorkspace={(dir) => setState((prev) => setOnboardingWorkspace(prev, dir))}
          onSetWorkspaceIsNew={(isNew) => setState((prev) => setOnboardingWorkspaceIsNew(prev, isNew))}
          onPickFolder={handlePickFolder}
          onSetProvider={(p) => setState((prev) => setOnboardingProvider(prev, p))}
          onSetApiKey={(k) => setState((prev) => setOnboardingApiKey(prev, k))}
          onOllamaNext={handleOllamaNext}
          onRefreshOllamaModels={handleRefreshOllamaModels}
          onSelectOllamaModel={(m) => setState((prev) => setOnboardingOllamaModel(prev, m))}
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
      />

      <div className="app-main">
        <Sidebar open={sidebarOpen} invoke={invokeCommand} />

        <div className="chat-window">
          <ChatWindow
            chatItems={state.chatItems}
            pendingToolCalls={state.pendingToolCalls}
            streamingText={state.streamingText}
            streamingThinking={state.streamingThinking}
            isStreaming={state.isStreaming}
          />

          <Composer onSend={handleSend} disabled={state.isStreaming} />
        </div>
      </div>

      <BottomBar />

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

      <IngestToastStack
        ingestions={state.activeIngestions}
        onDismiss={(fileName) => setState((prev) => dismissIngestion(prev, fileName))}
      />

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
