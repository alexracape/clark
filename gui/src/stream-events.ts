export type StreamingTextEvent = { type: "streaming_text"; text: string };
export type StreamingThinkingEvent = { type: "streaming_thinking"; text: string };
export type StreamingDoneEvent = { type: "streaming_done" };
export type AssistantMessageEvent = { type: "assistant_message"; text: string };
export type ToolStartEvent = { type: "tool_start"; name: string };
export type SystemMessageEvent = { type: "system_message"; text: string };
export type StatusUpdateEvent = { type: "status_update"; provider: string; model: string };
export type TurnCompleteEvent = { type: "turn_complete" };
export type CanvasStatusEvent = {
  type: "canvas_status";
  status: string;
  canvasName?: string;
  canvasUrl?: string;
};

export type SidecarStreamEvent =
  | StreamingTextEvent
  | StreamingThinkingEvent
  | StreamingDoneEvent
  | AssistantMessageEvent
  | ToolStartEvent
  | SystemMessageEvent
  | StatusUpdateEvent
  | TurnCompleteEvent
  | CanvasStatusEvent;

function hasString(v: unknown, key: string): boolean {
  return typeof v === "object" && v !== null && typeof (v as Record<string, unknown>)[key] === "string";
}

export function isSidecarStreamEvent(value: unknown): value is SidecarStreamEvent {
  if (typeof value !== "object" || value === null) return false;
  const t = (value as Record<string, unknown>).type;
  if (typeof t !== "string") return false;

  switch (t) {
    case "streaming_text":
    case "streaming_thinking":
    case "assistant_message":
    case "system_message":
      return hasString(value, "text");
    case "tool_start":
      return hasString(value, "name");
    case "status_update":
      return hasString(value, "provider") && hasString(value, "model");
    case "canvas_status":
      return hasString(value, "status");
    case "streaming_done":
    case "turn_complete":
      return true;
    default:
      return false;
  }
}

export function parseSidecarStreamEvent(payload: string): SidecarStreamEvent | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return isSidecarStreamEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
