/**
 * Tests for the conversation loop with a mock LLM.
 *
 * Exercises the full flow: user message → LLM streaming → tool dispatch → LLM continues.
 * No UI rendering — tests the core orchestration logic directly.
 */

import { test, expect, describe } from "bun:test";
import { resolve } from "node:path";
import { MockProvider, type MockResponse } from "../src/llm/mock.ts";
import { Conversation } from "../src/llm/messages.ts";
import { createTools, type ToolDefinition } from "../src/mcp/tools.ts";
import { CanvasBroker } from "../src/canvas/server.ts";
import type { StreamChunk, MessageContent } from "../src/llm/provider.ts";

/**
 * Run a single conversation turn (mirrors the logic in app.tsx).
 * Returns the final assistant text and any tool calls that were made.
 */
async function runConversationTurn(
  provider: MockProvider,
  conversation: Conversation,
  tools: ToolDefinition[],
  systemPrompt: string,
): Promise<{ responses: string[]; toolCallNames: string[] }> {
  const responses: string[] = [];
  const toolCallNames: string[] = [];

  const llmTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(t.inputSchema.properties).map(([key, val]) => [
          key,
          { type: val.type, description: val.description },
        ]),
      ),
      required: t.inputSchema.required,
    },
  }));

  let continueLoop = true;

  while (continueLoop) {
    const chunks: StreamChunk[] = [];
    let text = "";

    for await (const chunk of provider.chat(conversation.getMessages(), llmTools, systemPrompt)) {
      chunks.push(chunk);
      if (chunk.type === "text_delta") {
        text += chunk.text;
      }
    }

    const assistantContent = conversation.collectStreamResponse(chunks);
    conversation.addAssistantMessage(assistantContent);

    const toolUses = assistantContent.filter((c) => c.type === "tool_use");

    if (toolUses.length === 0) {
      if (text) responses.push(text);
      continueLoop = false;
    } else {
      if (text) responses.push(text);

      for (const toolUse of toolUses) {
        if (toolUse.type !== "tool_use") continue;
        toolCallNames.push(toolUse.name);

        const tool = tools.find((t) => t.name === toolUse.name);
        if (tool) {
          const result = await tool.handler(toolUse.input);
          const resultText = result.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          conversation.addToolResult(toolUse.id, resultText, result.isError);
        } else {
          conversation.addToolResult(toolUse.id, `Unknown tool: ${toolUse.name}`, true);
        }
      }
    }
  }

  return { responses, toolCallNames };
}

describe("Conversation Loop", () => {
  const systemPrompt = "You are a helpful tutor.";
  const broker = new CanvasBroker();
  const tools = createTools({ getBroker: () => broker, vaultDir: resolve(import.meta.dir, "test_vault"), getSaveCanvas: () => null });

  test("simple text response", async () => {
    const provider = new MockProvider([
      { text: "What are you working on today?" },
    ]);
    const conversation = new Conversation();
    conversation.addUserMessage("Hello");

    const result = await runConversationTurn(provider, conversation, tools, systemPrompt);

    expect(result.responses).toEqual(["What are you working on today?"]);
    expect(result.toolCallNames).toEqual([]);
    expect(provider.calls).toHaveLength(1);
    expect(provider.lastCall!.systemPrompt).toBe(systemPrompt);
  });

  test("provider receives full message history", async () => {
    const provider = new MockProvider([
      { text: "Can you show me your work?" },
    ]);
    const conversation = new Conversation();
    conversation.addUserMessage("I'm stuck on problem 3");

    await runConversationTurn(provider, conversation, tools, systemPrompt);

    const sentMessages = provider.lastCall!.messages;
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    // First message should be the user's
    expect(sentMessages[0]!.role).toBe("user");
    expect(sentMessages[0]!.content[0]).toEqual({ type: "text", text: "I'm stuck on problem 3" });
  });

  test("tool call → tool result → follow-up response", async () => {
    const provider = new MockProvider([
      // First response: call a tool
      {
        text: "Let me check your notes.",
        toolCalls: [{ id: "tc1", name: "search_notes", input: { query: "derivatives" } }],
        stopReason: "tool_use",
      },
      // Second response: after tool result
      { text: "I see you have notes on derivatives. What specifically is confusing?" },
    ]);
    const conversation = new Conversation();
    conversation.addUserMessage("Help me with derivatives");

    const result = await runConversationTurn(provider, conversation, tools, systemPrompt);

    expect(result.toolCallNames).toEqual(["search_notes"]);
    // Should have called chat() twice (initial + after tool result)
    expect(provider.calls).toHaveLength(2);
    // Second call should include the tool result
    const secondCallMessages = provider.calls[1]!.messages;
    const toolResultMsg = secondCallMessages.find((m) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
    // Final response should be the follow-up
    expect(result.responses).toContain("I see you have notes on derivatives. What specifically is confusing?");
  });

  test("multiple tool calls in one turn", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "tc1", name: "list_files", input: { path: "/tmp" } },
          { id: "tc2", name: "list_files", input: { path: "/tmp" } },
        ],
        stopReason: "tool_use",
      },
      { text: "Found some files." },
    ]);
    const conversation = new Conversation();
    conversation.addUserMessage("What files are available?");

    const result = await runConversationTurn(provider, conversation, tools, systemPrompt);

    expect(result.toolCallNames).toEqual(["list_files", "list_files"]);
    expect(provider.calls).toHaveLength(2);
  });

  test("tool error is reported back to LLM", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [{ id: "tc1", name: "read_canvas", input: {} }],
        stopReason: "tool_use",
      },
      { text: "It seems the iPad isn't connected. Can you connect it?" },
    ]);
    const conversation = new Conversation();
    conversation.addUserMessage("Show me what I wrote");

    const result = await runConversationTurn(provider, conversation, tools, systemPrompt);

    // The read_canvas tool should fail (no iPad connected)
    expect(result.toolCallNames).toEqual(["read_canvas"]);
    // LLM should get the error and respond gracefully
    expect(result.responses).toContain("It seems the iPad isn't connected. Can you connect it?");

    // Verify the tool result was marked as error
    const secondCallMessages = provider.calls[1]!.messages;
    const toolResult = secondCallMessages
      .filter((m) => m.role === "tool")
      .flatMap((m) => m.content)
      .find((c) => c.type === "tool_result");
    expect(toolResult).toBeDefined();
    if (toolResult?.type === "tool_result") {
      expect(toolResult.isError).toBe(true);
    }
  });

  test("unknown tool call is handled gracefully", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [{ id: "tc1", name: "nonexistent_tool", input: {} }],
        stopReason: "tool_use",
      },
      { text: "Sorry, I made an error." },
    ]);
    const conversation = new Conversation();
    conversation.addUserMessage("Do something");

    const result = await runConversationTurn(provider, conversation, tools, systemPrompt);

    expect(result.toolCallNames).toEqual(["nonexistent_tool"]);
    expect(provider.calls).toHaveLength(2);
  });

  test("conversation accumulates across multiple turns", async () => {
    const provider = new MockProvider([
      { text: "What problem are you on?" },
      { text: "Good, let's work through it step by step." },
    ]);
    const conversation = new Conversation();

    // Turn 1
    conversation.addUserMessage("I need help with my homework");
    await runConversationTurn(provider, conversation, tools, systemPrompt);

    // Turn 2
    conversation.addUserMessage("Problem 5");
    await runConversationTurn(provider, conversation, tools, systemPrompt);

    // Second call should include full history (user1, assistant1, user2)
    const messages = provider.calls[1]!.messages;
    expect(messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  test("provider receives tools list", async () => {
    const provider = new MockProvider([{ text: "OK" }]);
    const conversation = new Conversation();
    conversation.addUserMessage("hi");

    await runConversationTurn(provider, conversation, tools, systemPrompt);

    const sentTools = provider.lastCall!.tools;
    const toolNames = sentTools.map((t) => t.name);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("search_notes");
    expect(toolNames).toContain("read_canvas");
    expect(toolNames).toContain("export_pdf");
  });

  test("empty response from provider is handled", async () => {
    const provider = new MockProvider([
      { text: "" },
    ]);
    const conversation = new Conversation();
    conversation.addUserMessage("hi");

    const result = await runConversationTurn(provider, conversation, tools, systemPrompt);
    // Empty text should not be added to responses
    expect(result.responses).toEqual([]);
    expect(provider.calls).toHaveLength(1);
  });

  test("multi-step tool sequence: search → read → create", async () => {
    const provider = new MockProvider([
      // Step 1: Search for notes
      {
        text: "Let me search your notes.",
        toolCalls: [{ id: "tc1", name: "search_notes", input: { query: "algorithms" } }],
        stopReason: "tool_use",
      },
      // Step 2: Read a specific file
      {
        text: "I found relevant notes. Let me read them.",
        toolCalls: [{ id: "tc2", name: "read_file", input: { path: "Notes/RLHF.md" } }],
        stopReason: "tool_use",
      },
      // Step 3: Create a summary
      {
        text: "I'll create a summary for you.",
        toolCalls: [{ id: "tc3", name: "create_file", input: { path: "Notes/Summary.md", content: "# Summary\n\nKey points..." } }],
        stopReason: "tool_use",
      },
      // Final response
      { text: "Done! I've created your summary in Notes/Summary.md" },
    ]);

    const conversation = new Conversation();
    conversation.addUserMessage("Help me review my algorithm notes");

    const result = await runConversationTurn(provider, conversation, tools, systemPrompt);

    // All three tools should be called in sequence
    expect(result.toolCallNames).toEqual(["search_notes", "read_file", "create_file"]);
    expect(provider.calls).toHaveLength(4); // One call per tool + final response

    // Verify conversation state
    const messages = conversation.getMessages();
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(4);
    expect(messages.filter((m) => m.role === "tool")).toHaveLength(3);
  });

  test("tool error recovery: read fails → try search instead", async () => {
    const provider = new MockProvider([
      // Step 1: Try to read a nonexistent file
      {
        text: "Let me read that file.",
        toolCalls: [{ id: "tc1", name: "read_file", input: { path: "Notes/Nonexistent.md" } }],
        stopReason: "tool_use",
      },
      // Step 2: File doesn't exist, so search instead
      {
        text: "That file doesn't exist. Let me search your notes instead.",
        toolCalls: [{ id: "tc2", name: "search_notes", input: { query: "algorithms" } }],
        stopReason: "tool_use",
      },
      // Final response
      { text: "Found some related notes!" },
    ]);

    const conversation = new Conversation();
    conversation.addUserMessage("Find my algorithms notes");

    const result = await runConversationTurn(provider, conversation, tools, systemPrompt);

    // Both tools should be called
    expect(result.toolCallNames).toEqual(["read_file", "search_notes"]);

    // Verify first tool result was marked as error
    const messages = conversation.getMessages();
    const toolResults = messages.filter((m) => m.role === "tool");
    expect(toolResults).toHaveLength(2);

    // First tool result should be an error
    const firstToolContent = toolResults[0]!.content.find((c) => c.type === "tool_result");
    if (firstToolContent?.type === "tool_result") {
      expect(firstToolContent.isError).toBe(true);
    }

    // Second tool result should succeed
    const secondToolContent = toolResults[1]!.content.find((c) => c.type === "tool_result");
    if (secondToolContent?.type === "tool_result") {
      expect(secondToolContent.isError).toBe(false);
    }

    // LLM should continue despite the error
    expect(result.responses).toContain("Found some related notes!");
  });

  test("context accumulation across multiple turns", async () => {
    const provider = new MockProvider([
      { text: "Response 1" },
      {
        text: "Let me search.",
        toolCalls: [{ id: "tc1", name: "search_notes", input: { query: "test" } }],
        stopReason: "tool_use",
      },
      { text: "Response 2" },
      { text: "Response 3" },
    ]);

    const conversation = new Conversation();

    // Turn 1
    conversation.addUserMessage("First question");
    await runConversationTurn(provider, conversation, tools, systemPrompt);
    const ctx1 = conversation.estimateContext();

    // Turn 2 (with tool call)
    conversation.addUserMessage("Second question");
    await runConversationTurn(provider, conversation, tools, systemPrompt);
    const ctx2 = conversation.estimateContext();

    // Turn 3
    conversation.addUserMessage("Third question");
    await runConversationTurn(provider, conversation, tools, systemPrompt);
    const ctx3 = conversation.estimateContext();

    // Context should grow with each turn
    expect(ctx2.totalTokens).toBeGreaterThan(ctx1.totalTokens);
    expect(ctx3.totalTokens).toBeGreaterThan(ctx2.totalTokens);

    // Message count should increase
    expect(ctx2.messageCount).toBeGreaterThan(ctx1.messageCount);
    expect(ctx3.messageCount).toBeGreaterThan(ctx2.messageCount);

    // Should have expected number of messages
    const finalMessages = conversation.getMessages();
    expect(finalMessages.length).toBeGreaterThanOrEqual(7); // 3 users + 3 assistants + 1 tool
  });

  test("message ordering validation with interleaved tool calls", async () => {
    const provider = new MockProvider([
      {
        text: "Let me check two things.",
        toolCalls: [
          { id: "tc1", name: "search_notes", input: { query: "test1" } },
          { id: "tc2", name: "search_notes", input: { query: "test2" } },
        ],
        stopReason: "tool_use",
      },
      { text: "Found both!" },
    ]);

    const conversation = new Conversation();
    conversation.addUserMessage("Search for my notes");

    await runConversationTurn(provider, conversation, tools, systemPrompt);

    const messages = conversation.getMessages();

    // Verify strict ordering: user → assistant → tool → tool → assistant
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
    expect(messages[2]!.role).toBe("tool");
    expect(messages[3]!.role).toBe("tool");
    expect(messages[4]!.role).toBe("assistant");

    // Verify content types in assistant message with tool calls
    const firstAssistant = messages[1]!.content;
    expect(firstAssistant.some((c) => c.type === "text")).toBe(true);
    expect(firstAssistant.some((c) => c.type === "tool_use")).toBe(true);

    // Verify tool use count
    const toolUses = firstAssistant.filter((c) => c.type === "tool_use");
    expect(toolUses).toHaveLength(2);
  });

  test("vision content handling in tool results", async () => {
    const provider = new MockProvider([
      {
        text: "Let me read the canvas.",
        toolCalls: [{ id: "tc1", name: "read_canvas", input: {} }],
        stopReason: "tool_use",
      },
      { text: "I can see you've drawn a diagram." },
    ], true); // Enable vision support

    const conversation = new Conversation();
    conversation.addUserMessage("What did I draw?");

    // Mock a connected canvas broker
    const mockBroker = new CanvasBroker();
    let requestSnapshotCalled = false;
    mockBroker.requestSnapshot = async () => {
      requestSnapshotCalled = true;
      // Return a minimal base64 PNG
      return { png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" };
    };

    const visionTools = createTools({
      getBroker: () => mockBroker,
      vaultDir: resolve(import.meta.dir, "test_vault"),
      getSaveCanvas: () => null,
    });

    const result = await runConversationTurn(provider, conversation, visionTools, systemPrompt);

    // read_canvas should have been called
    expect(result.toolCallNames).toEqual(["read_canvas"]);
    expect(requestSnapshotCalled).toBe(true);

    // Verify image content is in the tool result
    const messages = conversation.getMessages();
    const toolResult = messages.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();

    // The tool result contains a tool_result content block
    const toolResultContent = toolResult!.content.find((c) => c.type === "tool_result");
    expect(toolResultContent).toBeDefined();

    // For vision-capable providers, image tools should include image data
    // The image may be in the tool result text or as a separate image block
    // For now, just verify the tool succeeded (no error)
    if (toolResultContent?.type === "tool_result") {
      expect(toolResultContent.isError).toBe(false);
    }
  });
});

describe("MockProvider", () => {
  test("records all calls", async () => {
    const provider = new MockProvider([
      { text: "response 1" },
      { text: "response 2" },
    ]);

    const chunks1: StreamChunk[] = [];
    for await (const c of provider.chat([], [], "system")) chunks1.push(c);

    const chunks2: StreamChunk[] = [];
    for await (const c of provider.chat([], [], "system")) chunks2.push(c);

    expect(provider.calls).toHaveLength(2);
  });

  test("returns fallback when queue is empty", async () => {
    const provider = new MockProvider([]);
    const chunks: StreamChunk[] = [];
    for await (const c of provider.chat([], [], "sys")) chunks.push(c);

    const textChunks = chunks.filter((c) => c.type === "text_delta");
    expect(textChunks.length).toBeGreaterThan(0);
  });

  test("streams text in chunks", async () => {
    const provider = new MockProvider([
      { text: "Hello, how can I help you today?" },
    ]);

    const textParts: string[] = [];
    for await (const chunk of provider.chat([], [], "sys")) {
      if (chunk.type === "text_delta") textParts.push(chunk.text);
    }

    // Should have multiple chunks (streamed)
    expect(textParts.length).toBeGreaterThanOrEqual(1);
    expect(textParts.join("")).toBe("Hello, how can I help you today?");
  });

  test("emits tool calls correctly", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "t1", name: "read_file", input: { path: "/test.md" } },
        ],
      },
    ]);

    const chunks: StreamChunk[] = [];
    for await (const c of provider.chat([], [], "sys")) chunks.push(c);

    const toolStart = chunks.find((c) => c.type === "tool_use_start");
    expect(toolStart).toBeDefined();
    if (toolStart?.type === "tool_use_start") {
      expect(toolStart.name).toBe("read_file");
      expect(toolStart.id).toBe("t1");
    }

    const done = chunks.find((c) => c.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.stopReason).toBe("tool_use");
    }
  });

  test("enqueue adds responses", async () => {
    const provider = new MockProvider([]);
    provider.enqueue({ text: "added later" });

    const chunks: StreamChunk[] = [];
    for await (const c of provider.chat([], [], "sys")) chunks.push(c);

    const text = chunks
      .filter((c): c is { type: "text_delta"; text: string } => c.type === "text_delta")
      .map((c) => c.text)
      .join("");
    expect(text).toBe("added later");
  });

  test("supportsVision is configurable", () => {
    expect(new MockProvider([], true).supportsVision).toBe(true);
    expect(new MockProvider([], false).supportsVision).toBe(false);
  });
});
