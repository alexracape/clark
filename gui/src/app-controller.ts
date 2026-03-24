import type { SidecarStreamEvent, IngestStartEvent, IngestProgressEvent, IngestCompleteEvent, IngestErrorEvent } from "./stream-events.ts";

// --- Tutorial State ---

export type TutorialStep =
  | "intro"
  | "asking-questions"
  | "slash-commands"
  | "file-context"
  | "canvas-intro"
  | "completion";

export interface TutorialState {
  step: TutorialStep;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  "intro",
  "asking-questions",
  "slash-commands",
  "file-context",
  "canvas-intro",
  "completion",
];

// --- Onboarding State ---

export type OnboardingStep = "welcome" | "workspace" | "provider" | "api-key" | "ollama-setup";

export interface OnboardingState {
  step: OnboardingStep;
  workspaceDir: string;
  workspaceIsNew: boolean;
  selectedProvider: string;
  apiKey: string;
  ollamaModels: string[];
  selectedOllamaModel: string;
  error: string | null;
  isSubmitting: boolean;
}

export interface ToolCall {
  name: string;
  result?: string;
  expanded?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export type ChatItem =
  | { type: "message"; message: Message }
  | { type: "tool"; toolCall: ToolCall };

export interface ProviderInfo {
  provider: string;
  model: string;
}

export interface CanvasStatus {
  status: string;
  canvasName?: string;
  canvasUrl?: string;
}

export interface IngestionStatus {
  fileName: string;
  stage: "copying" | "transcribing" | "linking" | "complete" | "error";
  message: string;
}

export interface EditorFile {
  path: string;
  content: string;
  dirty: boolean;
}

export interface SessionInfo {
  path: string;
  filename: string;
  date: string;
  sessionId: string;
  provider: string;
  model: string;
  firstUserMessage: string;
}

export interface AppState {
  chatItems: ChatItem[];
  streamingText: string | null;
  streamingThinking: string | null;
  isStreaming: boolean;
  currentTool: string | null;
  providerInfo: ProviderInfo;
  showModelPicker: boolean;
  showCanvasPicker: boolean;
  showContextPanel: boolean;
  showSettings: boolean;
  showSessionPicker: boolean;
  sessionList: SessionInfo[];
  canvasStatus: CanvasStatus | null;
  pendingToolCalls: ToolCall[];
  nextMessageId: number;
  onboarding: OnboardingState | null;
  tutorial: TutorialState | null;
  activeIngestions: Record<string, IngestionStatus>;
  editorFile: EditorFile | null;
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
    chatItems: [],
    streamingText: null,
    streamingThinking: null,
    isStreaming: false,
    currentTool: null,
    providerInfo: { provider: "", model: "" },
    showModelPicker: false,
    showCanvasPicker: false,
    showContextPanel: false,
    showSettings: false,
    showSessionPicker: false,
    sessionList: [],
    canvasStatus: null,
    pendingToolCalls: [],
    nextMessageId: 0,
    onboarding: null,
    tutorial: null,
    activeIngestions: {},
    editorFile: null,
  };
}

export function setShowSessionPicker(state: AppState, open: boolean): AppState {
  return { ...state, showSessionPicker: open };
}

export function setSessionList(state: AppState, sessions: SessionInfo[]): AppState {
  return { ...state, sessionList: sessions };
}

// ---------------------------------------------------------------------------
// Session resume: convert LLM messages → ChatItems
// ---------------------------------------------------------------------------

interface LLMMessagePart {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
}

export interface LLMMessage {
  role: "user" | "assistant" | "tool";
  content: LLMMessagePart[];
}

/**
 * Convert LLM messages (user/assistant/tool) returned by load_session into
 * ChatItem[] for the React UI. Returns items and the next message ID to use.
 */
export function messagesToChatItems(
  messages: LLMMessage[],
  startId: number,
): { items: ChatItem[]; nextId: number } {
  // Pre-build tool result map so each tool_use can show its result inline
  const toolResults = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type === "tool_result" && part.toolUseId) {
          toolResults.set(
            part.toolUseId,
            typeof part.content === "string" ? part.content : "[image]",
          );
        }
      }
    }
  }

  const items: ChatItem[] = [];
  let id = startId;

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = msg.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n")
        .trim();
      if (text) {
        items.push({
          type: "message",
          message: { id: String(id++), role: "user", text },
        });
      }
    } else if (msg.role === "assistant") {
      // Tool calls appear before the assistant text (matches streaming order)
      for (const part of msg.content) {
        if (part.type === "tool_use" && part.id && part.name) {
          items.push({
            type: "tool",
            toolCall: { name: part.name, result: toolResults.get(part.id) },
          });
        }
      }
      const textPart = msg.content.find((c) => c.type === "text" && c.text?.trim());
      if (textPart?.text?.trim()) {
        items.push({
          type: "message",
          message: { id: String(id++), role: "assistant", text: textPart.text },
        });
      }
    }
    // tool messages are consumed via toolResults map above
  }

  return { items, nextId: id };
}

export function applyRestoredSession(
  state: AppState,
  messages: LLMMessage[],
  date: string,
): AppState {
  const { items, nextId } = messagesToChatItems(messages, state.nextMessageId + 1);
  const systemMessage: ChatItem = {
    type: "message",
    message: {
      id: String(nextId),
      role: "system",
      text: `Session from ${date} resumed. Continuing conversation below.`,
    },
  };
  return {
    ...state,
    chatItems: [...items, systemMessage],
    nextMessageId: nextId,
  };
}

/** Helper: get messages from chat items (for backwards compat) */
export function getMessages(state: AppState): Message[] {
  return state.chatItems
    .filter((item): item is { type: "message"; message: Message } => item.type === "message")
    .map((item) => item.message);
}

function appendMessage(
  state: AppState,
  role: Message["role"],
  text: string,
): AppState {
  const id = String(state.nextMessageId + 1);
  return {
    ...state,
    nextMessageId: state.nextMessageId + 1,
    chatItems: [
      ...state.chatItems,
      { type: "message", message: { id, role, text } },
    ],
  };
}

function appendToolCall(state: AppState, toolCall: ToolCall): AppState {
  return {
    ...state,
    chatItems: [...state.chatItems, { type: "tool", toolCall }],
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

export function setShowSettings(state: AppState, open: boolean): AppState {
  return { ...state, showSettings: open };
}

export function onCanvasOpened(
  state: AppState,
  info: { name: string; url: string },
): AppState {
  return {
    ...state,
    canvasStatus: { status: "connecting", canvasName: info.name, canvasUrl: info.url },
    showCanvasPicker: false,
  };
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
      // Flush pending tool calls as inline chat items, then append message
      let next = state;
      for (const tc of state.pendingToolCalls) {
        next = appendToolCall(next, tc);
      }
      next = appendMessage(next, "assistant", event.text);
      return {
        ...next,
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
    case "tool_result": {
      // Update the last pending tool call with matching name
      const updated = [...state.pendingToolCalls];
      for (let i = updated.length - 1; i >= 0; i--) {
        if (updated[i].name === event.name && !updated[i].result) {
          updated[i] = { ...updated[i], result: event.result };
          break;
        }
      }
      return { ...state, pendingToolCalls: updated };
    }
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
    case "ingest_start":
      return applyIngestStart(state, event as IngestStartEvent);
    case "ingest_progress":
      return applyIngestProgress(state, event as IngestProgressEvent);
    case "ingest_complete":
      return applyIngestComplete(state, event as IngestCompleteEvent);
    case "ingest_error":
      return applyIngestError(state, event as IngestErrorEvent);
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

  const textWithContext =
    state.editorFile
      ? `${trimmed}\n\n---\nOpen file: ${state.editorFile.path}\n\`\`\`markdown\n${state.editorFile.content}\n\`\`\``
      : trimmed;

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
    effects: [{ type: "invoke", command: "send_message", args: { text: textWithContext } }],
  };
}

export function startTutorial(state: AppState): AppState {
  return { ...state, tutorial: { step: "intro" } };
}

export function tutorialNextStep(state: AppState): AppState {
  if (!state.tutorial) return state;
  const idx = TUTORIAL_STEPS.indexOf(state.tutorial.step);
  if (idx < 0 || idx >= TUTORIAL_STEPS.length - 1) {
    return { ...state, tutorial: null };
  }
  return { ...state, tutorial: { step: TUTORIAL_STEPS[idx + 1] } };
}

export function completeTutorial(state: AppState): AppState {
  return { ...state, tutorial: null };
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
  if (result.uiAction === "settings") {
    return { ...state, showSettings: true };
  }
  if (result.uiAction === "tutorial") {
    return startTutorial(state);
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

// --- Ingestion toast reducers ---

function applyIngestStart(state: AppState, event: IngestStartEvent): AppState {
  return {
    ...state,
    activeIngestions: {
      ...state.activeIngestions,
      [event.fileName]: {
        fileName: event.fileName,
        stage: "copying",
        message: `Organizing file...`,
      },
    },
  };
}

function applyIngestProgress(state: AppState, event: IngestProgressEvent): AppState {
  const existing = state.activeIngestions[event.fileName];
  if (!existing) return state;
  return {
    ...state,
    activeIngestions: {
      ...state.activeIngestions,
      [event.fileName]: {
        ...existing,
        stage: event.stage,
        message: event.message,
      },
    },
  };
}

function applyIngestComplete(state: AppState, event: IngestCompleteEvent): AppState {
  const existing = state.activeIngestions[event.fileName];
  if (!existing) return state;
  return {
    ...state,
    activeIngestions: {
      ...state.activeIngestions,
      [event.fileName]: {
        ...existing,
        stage: "complete",
        message: event.summary,
      },
    },
  };
}

function applyIngestError(state: AppState, event: IngestErrorEvent): AppState {
  const existing = state.activeIngestions[event.fileName];
  if (!existing) return state;
  return {
    ...state,
    activeIngestions: {
      ...state.activeIngestions,
      [event.fileName]: {
        ...existing,
        stage: "error",
        message: event.error,
      },
    },
  };
}

export function dismissIngestion(state: AppState, fileName: string): AppState {
  const { [fileName]: _, ...rest } = state.activeIngestions;
  return { ...state, activeIngestions: rest };
}

// --- Editor file pure functions ---

export function openEditorFile(state: AppState, path: string, content: string): AppState {
  return { ...state, editorFile: { path, content, dirty: false } };
}

export function closeEditorFile(state: AppState): AppState {
  return { ...state, editorFile: null };
}

export function markEditorDirty(state: AppState, dirty: boolean): AppState {
  if (!state.editorFile) return state;
  return { ...state, editorFile: { ...state.editorFile, dirty } };
}

export function updateEditorDraft(state: AppState, content: string): AppState {
  if (!state.editorFile) return state;
  return { ...state, editorFile: { ...state.editorFile, content, dirty: true } };
}

export function updateEditorContent(state: AppState, content: string): AppState {
  if (!state.editorFile) return state;
  return { ...state, editorFile: { ...state.editorFile, content, dirty: false } };
}

export function renameEditorFile(state: AppState, newPath: string): AppState {
  if (!state.editorFile) return state;
  return { ...state, editorFile: { ...state.editorFile, path: newPath } };
}

// --- Onboarding pure functions ---

const STEP_ORDER: OnboardingStep[] = ["welcome", "workspace", "provider", "api-key"];

function createOnboardingState(): OnboardingState {
  return {
    step: "welcome",
    workspaceDir: "",
    workspaceIsNew: false,
    selectedProvider: "",
    apiKey: "",
    ollamaModels: [],
    selectedOllamaModel: "",
    error: null,
    isSubmitting: false,
  };
}

export function startOnboarding(state: AppState): AppState {
  return { ...state, onboarding: createOnboardingState() };
}

export function onboardingNextStep(state: AppState): AppState {
  if (!state.onboarding) return state;
  const idx = STEP_ORDER.indexOf(state.onboarding.step);
  if (idx < 0 || idx >= STEP_ORDER.length - 1) return state;
  return {
    ...state,
    onboarding: { ...state.onboarding, step: STEP_ORDER[idx + 1], error: null },
  };
}

export function onboardingPrevStep(state: AppState): AppState {
  if (!state.onboarding) return state;
  const idx = STEP_ORDER.indexOf(state.onboarding.step);
  if (idx <= 0) return state;
  return {
    ...state,
    onboarding: { ...state.onboarding, step: STEP_ORDER[idx - 1], error: null },
  };
}

export function setOnboardingWorkspace(state: AppState, dir: string): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, workspaceDir: dir } };
}

export function setOnboardingProvider(state: AppState, provider: string): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, selectedProvider: provider } };
}

export function setOnboardingApiKey(state: AppState, apiKey: string): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, apiKey } };
}

export function setOnboardingError(state: AppState, error: string | null): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, error } };
}

export function setOnboardingSubmitting(state: AppState, isSubmitting: boolean): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, isSubmitting } };
}

export function completeOnboarding(state: AppState): AppState {
  return { ...state, onboarding: null };
}

export function setOnboardingWorkspaceIsNew(state: AppState, isNew: boolean): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, workspaceIsNew: isNew } };
}

export function setOnboardingOllamaModels(state: AppState, models: string[]): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, ollamaModels: models } };
}

export function setOnboardingOllamaModel(state: AppState, model: string): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, selectedOllamaModel: model } };
}

export function setOnboardingStepOllama(state: AppState): AppState {
  if (!state.onboarding) return state;
  return { ...state, onboarding: { ...state.onboarding, step: "ollama-setup", error: null } };
}
