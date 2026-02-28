import { describe, test, expect } from "bun:test";
import {
  applySendError,
  applySlashCommandError,
  applySlashCommandResult,
  applyStreamEvent,
  createInitialAppState,
  planSendInput,
  type AppState,
} from "../gui/src/app-controller.ts";

function runEvents(state: AppState, events: Array<Parameters<typeof applyStreamEvent>[1]>): AppState {
  return events.reduce((s, e) => applyStreamEvent(s, e), state);
}

describe("gui app controller", () => {
  test("message lifecycle: send -> stream -> assistant -> complete", () => {
    const start = createInitialAppState();
    const plan = planSendInput(start, "hello");

    expect(plan.effects).toHaveLength(1);
    expect(plan.effects[0]).toMatchObject({ type: "invoke", command: "send_message" });
    expect(plan.state.messages.at(-1)).toMatchObject({ role: "user", text: "hello" });
    expect(plan.state.isStreaming).toBe(true);

    const end = runEvents(plan.state, [
      { type: "streaming_text", text: "hel" },
      { type: "streaming_text", text: "hello" },
      { type: "assistant_message", text: "world" },
      { type: "turn_complete" },
    ]);

    expect(end.messages.at(-1)).toMatchObject({ role: "assistant", text: "world" });
    expect(end.isStreaming).toBe(false);
    expect(end.streamingText).toBeNull();
    expect(end.pendingToolCalls).toHaveLength(0);
  });

  test("slash command ui actions toggle expected panels", () => {
    const start = createInitialAppState();

    expect(applySlashCommandResult(start, { uiAction: "model" }).showModelPicker).toBe(true);
    expect(applySlashCommandResult(start, { uiAction: "canvas" }).showCanvasPicker).toBe(true);
    expect(applySlashCommandResult(start, { uiAction: "context" }).showContextPanel).toBe(true);
  });

  test("streaming tool accumulation attaches to final assistant message", () => {
    const plan = planSendInput(createInitialAppState(), "run tools");

    const end = runEvents(plan.state, [
      { type: "tool_start", name: "search_notes" },
      { type: "tool_start", name: "read_file" },
      { type: "assistant_message", text: "done" },
      { type: "turn_complete" },
    ]);

    expect(end.messages.at(-1)?.toolCalls?.map((t) => t.name)).toEqual([
      "search_notes",
      "read_file",
    ]);
    expect(end.pendingToolCalls).toHaveLength(0);
  });

  test("duplicate send is prevented while streaming", () => {
    const first = planSendInput(createInitialAppState(), "first");
    const second = planSendInput(first.state, "second");

    expect(second.effects).toHaveLength(0);
    expect(second.state.messages).toHaveLength(1);
    expect(second.state.messages[0]?.text).toBe("first");
  });

  test("recoverable errors append system messages and reset streaming", () => {
    const sending = planSendInput(createInitialAppState(), "hello").state;
    const afterSendError = applySendError(sending, new Error("boom"));

    expect(afterSendError.isStreaming).toBe(false);
    expect(afterSendError.messages.at(-1)).toMatchObject({
      role: "system",
      text: "Failed to send message: Error: boom",
    });

    const afterSlashError = applySlashCommandError(afterSendError, "bad command");
    expect(afterSlashError.messages.at(-1)).toMatchObject({
      role: "system",
      text: "Command error: bad command",
    });
  });
});
