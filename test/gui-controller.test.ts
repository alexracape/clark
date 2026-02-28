import { describe, test, expect } from "bun:test";
import {
  applySendError,
  applySlashCommandError,
  applySlashCommandResult,
  applyStreamEvent,
  createInitialAppState,
  getMessages,
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
    const msgs = getMessages(plan.state);
    expect(msgs.at(-1)).toMatchObject({ role: "user", text: "hello" });
    expect(plan.state.isStreaming).toBe(true);

    const end = runEvents(plan.state, [
      { type: "streaming_text", text: "hel" },
      { type: "streaming_text", text: "hello" },
      { type: "assistant_message", text: "world" },
      { type: "turn_complete" },
    ]);

    const endMsgs = getMessages(end);
    expect(endMsgs.at(-1)).toMatchObject({ role: "assistant", text: "world" });
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

  test("tool calls appear as separate chat items (not attached to messages)", () => {
    const plan = planSendInput(createInitialAppState(), "run tools");

    const end = runEvents(plan.state, [
      { type: "tool_start", name: "search_notes" },
      { type: "tool_start", name: "read_file" },
      { type: "assistant_message", text: "done" },
      { type: "turn_complete" },
    ]);

    // Chat items: user message, tool(search_notes), tool(read_file), assistant message
    expect(end.chatItems).toHaveLength(4);
    expect(end.chatItems[0]).toMatchObject({ type: "message" });
    expect(end.chatItems[1]).toMatchObject({ type: "tool", toolCall: { name: "search_notes" } });
    expect(end.chatItems[2]).toMatchObject({ type: "tool", toolCall: { name: "read_file" } });
    expect(end.chatItems[3]).toMatchObject({ type: "message" });

    // Messages should not have toolCalls field
    const msgs = getMessages(end);
    expect(msgs.at(-1)).toMatchObject({ role: "assistant", text: "done" });
    expect(end.pendingToolCalls).toHaveLength(0);
  });

  test("tool_result event updates pending tool call", () => {
    const plan = planSendInput(createInitialAppState(), "run tools");

    const afterToolStart = applyStreamEvent(plan.state, {
      type: "tool_start",
      name: "read_file",
    });
    expect(afterToolStart.pendingToolCalls).toHaveLength(1);
    expect(afterToolStart.pendingToolCalls[0].result).toBeUndefined();

    const afterToolResult = applyStreamEvent(afterToolStart, {
      type: "tool_result",
      name: "read_file",
      result: "file contents here",
    });
    expect(afterToolResult.pendingToolCalls).toHaveLength(1);
    expect(afterToolResult.pendingToolCalls[0].result).toBe("file contents here");
  });

  test("duplicate send is prevented while streaming", () => {
    const first = planSendInput(createInitialAppState(), "first");
    const second = planSendInput(first.state, "second");

    expect(second.effects).toHaveLength(0);
    expect(second.state.chatItems).toHaveLength(1);
    const msgs = getMessages(second.state);
    expect(msgs[0]?.text).toBe("first");
  });

  test("recoverable errors append system messages and reset streaming", () => {
    const sending = planSendInput(createInitialAppState(), "hello").state;
    const afterSendError = applySendError(sending, new Error("boom"));

    expect(afterSendError.isStreaming).toBe(false);
    const msgs1 = getMessages(afterSendError);
    expect(msgs1.at(-1)).toMatchObject({
      role: "system",
      text: "Failed to send message: Error: boom",
    });

    const afterSlashError = applySlashCommandError(afterSendError, "bad command");
    const msgs2 = getMessages(afterSlashError);
    expect(msgs2.at(-1)).toMatchObject({
      role: "system",
      text: "Command error: bad command",
    });
  });
});
