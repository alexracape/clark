import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChatWindow } from "./components/ChatWindow.tsx";
import { Composer } from "./components/Composer.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { ModelPicker } from "./components/ModelPicker.tsx";
import { CanvasPicker } from "./components/CanvasPicker.tsx";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { invokeCommand, listenEvent } from "./ipc.ts";

// --- Types ---

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  result?: string;
  expanded?: boolean;
}

interface StreamEvent {
  type: string;
  text?: string;
  name?: string;
  provider?: string;
  model?: string;
  status?: string;
  canvasName?: string;
  canvasUrl?: string;
}

// --- App Component ---

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingThinking, setStreamingThinking] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [providerInfo, setProviderInfo] = useState({ provider: "", model: "" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showCanvasPicker, setShowCanvasPicker] = useState(false);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [canvasStatus, setCanvasStatus] = useState<{
    status: string;
    canvasName?: string;
    canvasUrl?: string;
  } | null>(null);

  const toolCallsRef = useRef<ToolCall[]>([]);
  const messageIdRef = useRef(0);

  const nextId = useCallback(() => String(++messageIdRef.current), []);

  // Fetch initial status
  useEffect(() => {
    invokeCommand("get_status", {}).then((data) => {
      const status = data as { provider: string; model: string };
      setProviderInfo({ provider: status.provider, model: status.model });
    }).catch(() => {});
  }, []);

  // Subscribe to sidecar streaming events
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    listenEvent("sidecar:event", (e) => {
      const event: StreamEvent = JSON.parse(e.payload);

      switch (event.type) {
        case "streaming_text":
          setStreamingText(event.text ?? "");
          setStreamingThinking(null);
          break;

        case "streaming_thinking":
          setStreamingThinking(event.text ?? "");
          break;

        case "streaming_done":
          break;

        case "assistant_message":
          // Add the final assistant message
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              text: event.text ?? "",
              toolCalls: toolCallsRef.current.length > 0
                ? [...toolCallsRef.current]
                : undefined,
            },
          ]);
          setStreamingText(null);
          setStreamingThinking(null);
          toolCallsRef.current = [];
          break;

        case "tool_start":
          setCurrentTool(event.name ?? null);
          if (event.name) {
            toolCallsRef.current.push({ name: event.name });
          }
          break;

        case "system_message":
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "system", text: event.text ?? "" },
          ]);
          break;

        case "status_update":
          if (event.provider && event.model) {
            setProviderInfo({ provider: event.provider, model: event.model });
          }
          break;

        case "canvas_status":
          setCanvasStatus({
            status: event.status ?? "disconnected",
            canvasName: event.canvasName,
            canvasUrl: event.canvasUrl,
          });
          break;

        case "turn_complete":
          setIsStreaming(false);
          setStreamingText(null);
          setStreamingThinking(null);
          setCurrentTool(null);
          toolCallsRef.current = [];
          break;
      }
    }).then((unsub) => {
      cleanup = unsub;
    });

    return () => cleanup?.();
  }, [nextId]);

  // Send message handler
  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      // Handle slash commands
      if (trimmed.startsWith("/")) {
        const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
        const args = rest.join(" ");

        try {
          const result = (await invokeCommand("slash_command", {
            command: cmd,
            args,
          })) as { result?: unknown; uiAction?: string; exit?: boolean };

          // Handle UI actions from slash commands
          if (result.uiAction === "model") {
            setShowModelPicker(true);
          } else if (result.uiAction === "canvas") {
            setShowCanvasPicker(true);
          } else if (result.uiAction === "context") {
            setShowContextPanel(true);
          } else if (result.result != null) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "system", text: String(result.result) },
            ]);
          }
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "system",
              text: `Command error: ${err}`,
            },
          ]);
        }
        return;
      }

      // Add user message to display
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed },
      ]);

      // Start streaming state
      setIsStreaming(true);
      setStreamingText("");
      toolCallsRef.current = [];

      // Send to sidecar
      try {
        await invokeCommand("send_message", { text: trimmed });
      } catch (err) {
        setIsStreaming(false);
        setStreamingText(null);
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "system",
            text: `Failed to send message: ${err}`,
          },
        ]);
      }
    },
    [isStreaming, nextId],
  );

  // File drop handler
  const handleFileDrop = useCallback(
    async (path: string) => {
      try {
        const result = (await invokeCommand("ingest_file", { path })) as {
          summary?: string;
          error?: string;
        };
        if (result.error) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "system", text: `Ingest error: ${result.error}` },
          ]);
        } else if (result.summary) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "system", text: result.summary },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "system", text: `File drop error: ${err}` },
        ]);
      }
    },
    [nextId],
  );

  // Drag-and-drop
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
        // In Tauri, we'd get the file path from the drop event
        // For now, use the file name as a path hint
        const file = files[0];
        if ("path" in file && typeof (file as { path: string }).path === "string") {
          handleFileDrop((file as { path: string }).path);
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

  return (
    <div className="app-layout">
      <StatusBar
        provider={providerInfo.provider}
        model={providerInfo.model}
        currentTool={currentTool}
        isStreaming={isStreaming}
        canvasStatus={canvasStatus}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onModelClick={() => setShowModelPicker(true)}
        onCanvasClick={() => setShowCanvasPicker(true)}
      />

      <div className="app-main">
        <Sidebar open={sidebarOpen} invoke={invokeCommand} />

        <div className="chat-window">
          <ChatWindow
            messages={messages}
            streamingText={streamingText}
            streamingThinking={streamingThinking}
            isStreaming={isStreaming}
          />

          <Composer
            onSend={handleSend}
            disabled={isStreaming}
          />
        </div>
      </div>

      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay__text">Drop file to add to workspace</div>
        </div>
      )}

      {showModelPicker && (
        <ModelPicker
          invoke={invokeCommand}
          onSelect={(provider, model) => {
            setProviderInfo({ provider, model });
            setShowModelPicker(false);
          }}
          onClose={() => setShowModelPicker(false)}
        />
      )}

      {showCanvasPicker && (
        <CanvasPicker
          invoke={invokeCommand}
          onOpen={(info) => {
            setCanvasStatus({ status: "connecting", canvasName: info.name, canvasUrl: info.url });
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "system", text: `Canvas "${info.name}" opened at ${info.url}` },
            ]);
            setShowCanvasPicker(false);
          }}
          onClose={() => setShowCanvasPicker(false)}
        />
      )}

      {showContextPanel && (
        <ContextPanel
          invoke={invokeCommand}
          onClose={() => setShowContextPanel(false)}
        />
      )}
    </div>
  );
}
