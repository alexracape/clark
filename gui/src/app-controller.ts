import type { SidecarStreamEvent } from "./stream-events.ts";

export interface ToolCall {
  name: string;
  result?: string;
  expanded?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  toolCalls?: ToolCall[];
}

export interface ProviderInfo {
  provider: string;
  model: string;
}

export interface CanvasStatus {
  status: string;
  canvasName?: string;
  canvasUrl?: string;
}

export interface AppState {
  messages: Message[];
  streamingText: string | null;
  streamingThinking: string | null;
  isStreaming: boolean;
  currentTool: string | null;
  providerInfo: ProviderInfo;
  showModelPicker: boolean;
  showCanvasPicker: boolean;
  showContextPanel: boolean;
  canvasStatus: CanvasStatus | null;
  pendingToolCalls: ToolCall[];
  nextMessageId: number;
}

export type ControllerEffect = {
  type: "invoke";
  command: "send_message" | "slash_command" | "ingest_file";
  args: Record<string, unknown>;
};

export interface ControllerPlan {
  state: AppState;
  effects: ControllerEffect[];
}

export interface SlashCommandResponse {
  result?: unknown;
  uiAction?: string;
  exit?: boolean;
}

export interface IngestResponse {
  summary?: string;
  error?: string;
}

export function createInitialAppState(): AppState {
  return {
    messages: [],
    streamingText: null,
    streamingThinking: null,
    isStreaming: false,
    currentTool: null,
    providerInfo: { provider: "", model: "" },
    showModelPicker: false,
    showCanvasPicker: false,
    showContextPanel: false,
    canvasStatus: null,
    pendingToolCalls: [],
    nextMessageId: 0,
  };
}

function appendMessage(
  state: AppState,
  role: Message["role"],
  text: string,
  toolCalls?: ToolCall[],
): AppState {
  const id = String(state.nextMessageId + 1);
  return {
    ...state,
    nextMessageId: state.nextMessageId + 1,
    messages: [
      ...state.messages,
      {
        id,
        role,
        text,
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      },
    ],
  };
}

export function setProviderInfo(state: AppState, providerInfo: ProviderInfo): AppState {
  return { ...state, providerInfo };
}

export function setShowModelPicker(state: AppState, open: boolean): AppState {
  return { ...state, showModelPicker: open };
}

export function setShowCanvasPicker(state: AppState, open: boolean): AppState {
  return { ...state, showCanvasPicker: open };
}

export function setShowContextPanel(state: AppState, open: boolean): AppState {
  return { ...state, showContextPanel: open };
}

export function onCanvasOpened(
  state: AppState,
  info: { name: string; url: string },
): AppState {
  const next = {
    ...state,
    canvasStatus: { status: "connecting", canvasName: info.name, canvasUrl: info.url },
    showCanvasPicker: false,
  };
  return appendMessage(next, "system", `Canvas "${info.name}" opened at ${info.url}`);
}

export function applyStreamEvent(state: AppState, event: SidecarStreamEvent): AppState {
  switch (event.type) {
    case "streaming_text":
      return { ...state, streamingText: event.text, streamingThinking: null };
    case "streaming_thinking":
      return { ...state, streamingThinking: event.text };
    case "streaming_done":
      return state;
    case "assistant_message": {
      const withMessage = appendMessage(
        state,
        "assistant",
        event.text,
        state.pendingToolCalls.length > 0 ? [...state.pendingToolCalls] : undefined,
      );
      return {
        ...withMessage,
        streamingText: null,
        streamingThinking: null,
        pendingToolCalls: [],
      };
    }
    case "tool_start":
      return {
        ...state,
        currentTool: event.name,
        pendingToolCalls: [...state.pendingToolCalls, { name: event.name }],
      };
    case "system_message":
      return appendMessage(state, "system", event.text);
    case "status_update":
      return {
        ...state,
        providerInfo: { provider: event.provider, model: event.model },
      };
    case "canvas_status":
      return {
        ...state,
        canvasStatus: {
          status: event.status,
          canvasName: event.canvasName,
          canvasUrl: event.canvasUrl,
        },
      };
    case "turn_complete":
      return {
        ...state,
        isStreaming: false,
        streamingText: null,
        streamingThinking: null,
        currentTool: null,
        pendingToolCalls: [],
      };
    default:
      return state;
  }
}

export function planSendInput(state: AppState, text: string): ControllerPlan {
  const trimmed = text.trim();
  if (!trimmed || state.isStreaming) {
    return { state, effects: [] };
  }

  if (trimmed.startsWith("/")) {
    const [command, ...rest] = trimmed.slice(1).split(/\s+/);
    return {
      state,
      effects: [{ type: "invoke", command: "slash_command", args: { command, args: rest.join(" ") } }],
    };
  }

  const withUserMessage = appendMessage(state, "user", trimmed);
  return {
    state: {
      ...withUserMessage,
      isStreaming: true,
      streamingText: "",
      streamingThinking: null,
      currentTool: null,
      pendingToolCalls: [],
    },
    effects: [{ type: "invoke", command: "send_message", args: { text: trimmed } }],
  };
}

export function applySlashCommandResult(state: AppState, result: SlashCommandResponse): AppState {
  if (result.uiAction === "model") {
    return { ...state, showModelPicker: true };
  }
  if (result.uiAction === "canvas") {
    return { ...state, showCanvasPicker: true };
  }
  if (result.uiAction === "context") {
    return { ...state, showContextPanel: true };
  }
  if (result.result != null) {
    return appendMessage(state, "system", String(result.result));
  }
  return state;
}

export function applySlashCommandError(state: AppState, err: unknown): AppState {
  return appendMessage(state, "system", `Command error: ${String(err)}`);
}

export function applySendError(state: AppState, err: unknown): AppState {
  const next = {
    ...state,
    isStreaming: false,
    streamingText: null,
    streamingThinking: null,
    currentTool: null,
    pendingToolCalls: [],
  };
  return appendMessage(next, "system", `Failed to send message: ${String(err)}`);
}

export function planFileDrop(state: AppState, path: string): ControllerPlan {
  return {
    state,
    effects: [{ type: "invoke", command: "ingest_file", args: { path } }],
  };
}

export function applyIngestResult(state: AppState, result: IngestResponse): AppState {
  if (result.error) {
    return appendMessage(state, "system", `Ingest error: ${result.error}`);
  }
  if (result.summary) {
    return appendMessage(state, "system", result.summary);
  }
  return state;
}

export function applyFileDropError(state: AppState, err: unknown): AppState {
  return appendMessage(state, "system", `File drop error: ${String(err)}`);
}
