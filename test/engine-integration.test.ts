/**
 * Engine integration tests with real tool handlers.
 *
 * Unlike engine.test.ts (which uses toy echo/screenshot tools), these tests
 * wire ConversationEngine to real tools from createTools() scoped to test_vault.
 * MockProvider is still used for the LLM, but tool dispatch goes through real
 * file I/O handlers — catching bugs at the engine ↔ tool boundary.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { resolve } from "node:path";
import { ConversationEngine, toLLMTools } from "../core/engine.ts";
import { Conversation } from "../core/llm/messages.ts";
import { MockProvider } from "../core/llm/mock.ts";
import { createTools } from "../core/mcp/tools.ts";
import type { TurnCallbacks } from "../core/engine.ts";

const TEST_VAULT = resolve(import.meta.dir, "test_vault");

const tools = createTools({
  getBroker: () => null,
  vaultDir: TEST_VAULT,
  getSaveCanvas: () => null,
});

/** Collect callback events with ordering info */
function trackCallbacks() {
  const events: Array<{ type: string; value?: string; order: number }> = [];
  let counter = 0;
  const callbacks: TurnCallbacks = {
    onStreamingText: (t) => events.push({ type: "streaming_text", value: t, order: counter++ }),
    onStreamingThinking: (t) => events.push({ type: "streaming_thinking", value: t, order: counter++ }),
    onStreamingDone: () => events.push({ type: "streaming_done", order: counter++ }),
    onAssistantMessage: (t) => events.push({ type: "assistant", value: t, order: counter++ }),
    onToolStart: (name) => events.push({ type: "tool_start", value: name, order: counter++ }),
    onToolResult: (name, result) => events.push({ type: "tool_result", value: name, order: counter++ }),
    onSystemMessage: (msg) => events.push({ type: "system", value: msg, order: counter++ }),
  };
  return { events, callbacks };
}

/** Assert that event types appear in the given relative order */
function assertEventOrder(
  events: Array<{ type: string; order: number }>,
  expectedOrder: string[],
) {
  const positions = expectedOrder.map((type) => {
    const event = events.find((e) => e.type === type);
    if (!event) throw new Error(`Expected event "${type}" not found. Got: ${events.map(e => e.type).join(", ")}`);
    return { type, order: event.order };
  });

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1]!;
    const curr = positions[i]!;
    if (prev.order >= curr.order) {
      throw new Error(
        `Event "${prev.type}" (order ${prev.order}) should come before "${curr.type}" (order ${curr.order})`,
      );
    }
  }
}

describe("Engine Integration with Real Tools", () => {
  let conversation: Conversation;
  let engine: ConversationEngine;

  beforeEach(() => {
    conversation = new Conversation();
    engine = new ConversationEngine({
      conversation,
      tools,
      systemPrompt: "You are a helpful tutor.",
    });
  });

  test("full read_file loop with real file content", async () => {
    // MockProvider: first call returns tool call to read GRPO.md, second returns text
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "tc1", name: "read_file", input: { path: "Notes/GRPO.md" } },
        ],
      },
      { text: "That note is about GRPO." },
    ]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("What does GRPO stand for?");
    await engine.runTurn(provider, callbacks);

    // Provider should be called twice: initial + after tool result
    expect(provider.calls).toHaveLength(2);

    // The tool result sent back to the LLM should contain actual file content
    const secondCallMessages = provider.calls[1]!.messages;
    const toolResultMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
    const toolResultContent = toolResultMsg!.content.find((c) => c.type === "tool_result");
    expect(toolResultContent).toBeDefined();
    if (toolResultContent?.type === "tool_result") {
      expect(typeof toolResultContent.content).toBe("string");
      expect((toolResultContent.content as string)).toContain("Group relative policy optimization");
    }

    // Final assistant message should be present
    expect(events.some((e) => e.type === "assistant" && e.value === "That note is about GRPO.")).toBe(true);

    // Conversation state: user → assistant (tool_use) → tool (result) → assistant (text)
    const messages = conversation.getMessages();
    expect(messages).toHaveLength(4);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[2]!.role).toBe("tool");
    expect(messages[3]!.role).toBe("assistant");
  });

  test("tool error for nonexistent file is handled gracefully", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "tc1", name: "read_file", input: { path: "Notes/DoesNotExist.md" } },
        ],
      },
      { text: "That file doesn't seem to exist." },
    ]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("Read a nonexistent file");
    await engine.runTurn(provider, callbacks);

    // Provider called twice — second time with the error result
    expect(provider.calls).toHaveLength(2);

    // Tool result should indicate an error
    const secondCallMessages = provider.calls[1]!.messages;
    const toolResultMsg = secondCallMessages.find((m) => m.role === "tool");
    const toolResultContent = toolResultMsg!.content.find((c) => c.type === "tool_result");
    if (toolResultContent?.type === "tool_result") {
      // The error flag should be set (real read_file sets isError on ENOENT)
      expect(toolResultContent.isError).toBe(true);
    }

    // Engine should still complete without throwing
    expect(events.some((e) => e.type === "assistant")).toBe(true);
  });

  test("callback ordering is correct for tool-using turn", async () => {
    const provider = new MockProvider([
      {
        text: "Let me look that up.",
        toolCalls: [
          { id: "tc1", name: "read_file", input: { path: "Notes/GRPO.md" } },
        ],
        stopReason: "tool_use",
      },
      { text: "Here is what I found." },
    ]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("What is GRPO?");
    await engine.runTurn(provider, callbacks);

    // Verify strict ordering:
    // 1. First streaming round: text → done → assistant (pre-tool text)
    // 2. Tool dispatch: tool_start
    // 3. Second streaming round ends with final assistant
    assertEventOrder(events, [
      "streaming_done",     // first round complete
      "tool_start",         // tool dispatch
    ]);

    // Should have two assistant events (pre-tool text + final text)
    const assistantEvents = events.filter((e) => e.type === "assistant");
    expect(assistantEvents).toHaveLength(2);
  });

  test("maxToolCallsPerTurn enforced with real tools", async () => {
    const limitedEngine = new ConversationEngine({
      conversation,
      tools,
      systemPrompt: "test",
      maxToolCallsPerTurn: 1,
    });

    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "tc1", name: "read_file", input: { path: "Notes/GRPO.md" } },
        ],
      },
      // After first tool result, tries another tool call
      {
        toolCalls: [
          { id: "tc2", name: "read_file", input: { path: "Notes/RLHF.md" } },
        ],
      },
    ]);
    const { events, callbacks } = trackCallbacks();

    conversation.addUserMessage("Read two files");
    await limitedEngine.runTurn(provider, callbacks);

    // Should hit the tool call limit and emit a system message
    expect(events.some((e) => e.type === "system" && e.value?.includes("max tool calls"))).toBe(true);
    // Should have dispatched only 1 tool (the first one succeeded)
    expect(provider.calls).toHaveLength(2);
  });

  test("conversation state is correct after multi-turn with tools", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "tc1", name: "read_file", input: { path: "Notes/GRPO.md" } },
        ],
      },
      { text: "GRPO is about group relative policy optimization." },
    ]);

    conversation.addUserMessage("Tell me about GRPO");
    await engine.runTurn(provider, {});

    const messages = conversation.getMessages();

    // Verify message structure
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
    // Assistant message should contain tool_use
    expect(messages[1]!.content.some((c) => c.type === "tool_use")).toBe(true);
    expect(messages[2]!.role).toBe("tool");
    expect(messages[3]!.role).toBe("assistant");
    // Final assistant message should contain text
    expect(messages[3]!.content.some((c) => c.type === "text")).toBe(true);
  });

  test("path traversal is rejected by real tool handler", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "tc1", name: "read_file", input: { path: "../../etc/passwd" } },
        ],
      },
      { text: "I couldn't read that file." },
    ]);

    conversation.addUserMessage("Read /etc/passwd");
    await engine.runTurn(provider, {});

    // The tool result should be an error about path traversal
    const secondCallMessages = provider.calls[1]!.messages;
    const toolResultMsg = secondCallMessages.find((m) => m.role === "tool");
    const toolResultContent = toolResultMsg!.content.find((c) => c.type === "tool_result");
    if (toolResultContent?.type === "tool_result") {
      expect(toolResultContent.isError).toBe(true);
      expect((toolResultContent.content as string)).toMatch(/outside|vault/i);
    }
  });
});
