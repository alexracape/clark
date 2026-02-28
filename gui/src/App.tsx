import React, { useState, useEffect, useCallback } from "react";
import { ChatWindow } from "./components/ChatWindow.tsx";
import { Composer } from "./components/Composer.tsx";
import { Titlebar } from "./components/Titlebar.tsx";
import { BottomBar } from "./components/BottomBar.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { CanvasPicker } from "./components/CanvasPicker.tsx";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { invokeCommand, listenEvent } from "./ipc.ts";
import {
  applyFileDropError,
  applyIngestResult,
  applySendError,
  applySlashCommandError,
  applySlashCommandResult,
  applyStreamEvent,
  createInitialAppState,
  onCanvasOpened,
  planFileDrop,
  planSendInput,
  setProviderInfo,
  setShowCanvasPicker,
  setShowContextPanel,
  setShowModelPicker,
  type AppState,
  type ControllerEffect,
  type IngestResponse,
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
        const result = (await invokeCommand(effect.command, effect.args)) as IngestResponse;
        setState((prev) => applyIngestResult(prev, result));
      } catch (err) {
        setState((prev) => applyFileDropError(prev, err));
      }
    }
  }
}

export function App() {
  const [state, setState] = useState<AppState>(() => createInitialAppState());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [clipboardToast, setClipboardToast] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    invokeCommand("get_status", {})
      .then((data) => {
        const status = data as { provider: string; model: string };
        setState((prev) => setProviderInfo(prev, { provider: status.provider, model: status.model }));
      })
      .catch(() => {});
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
          <div className="drag-overlay__text">Drop file to add to workspace</div>
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
    </div>
  );
}
