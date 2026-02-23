/**
 * TUI component tests using ink-testing-library.
 *
 * Renders components in a virtual terminal and asserts on output frames.
 * Uses MockProvider so no real API calls are made.
 */

import React from "react";
import { resolve } from "node:path";
import { test, expect, describe, afterEach } from "bun:test";
import { render, cleanup } from "ink-testing-library";
import { App } from "../src/tui/app.tsx";
import { StatusBar } from "../src/tui/status.tsx";
import { Chat, type ChatMessage } from "../src/tui/chat.tsx";
import { MockProvider } from "../src/llm/mock.ts";
import { Conversation } from "../src/llm/messages.ts";
import { createTools } from "../src/mcp/tools.ts";
import { CanvasBroker } from "../src/canvas/server.ts";
import type { ClarkConfig } from "../src/config.ts";

const TEST_VAULT = resolve(import.meta.dir, "test_vault");

afterEach(() => {
  cleanup();
});

/** Small delay for component mount / async operations */
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("StatusBar", () => {
  test("renders provider and model", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="anthropic"
        model="claude-sonnet"
        canvasConnected={false}
        canvasUrl="http://192.168.1.1:3000"
        isThinking={false}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("anthropic");
    expect(frame).toContain("claude-sonnet");
  });

  test("shows no canvas when none open", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={false}
        canvasUrl={null}
        canvasName={null}
        isThinking={false}
      />,
    );

    expect(lastFrame()!).toContain("no canvas");
  });

  test("shows canvas name and URL when open but disconnected", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={false}
        canvasUrl="http://192.168.1.1:3000"
        canvasName="HW1"
        isThinking={false}
      />,
    );

    expect(lastFrame()!).toContain("HW1");
    expect(lastFrame()!).toContain("http://192.168.1.1:3000");
  });

  test("shows connected status with canvas name", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={true}
        canvasUrl="http://192.168.1.1:3000"
        canvasName="HW1"
        isThinking={false}
      />,
    );

    expect(lastFrame()!).toContain("HW1");
    expect(lastFrame()!).toContain("connected");
  });

  test("shows reconnecting status in the canvas indicator", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={false}
        canvasStatus="reconnecting"
        canvasUrl="http://192.168.1.1:3000"
        canvasName="HW1"
        isThinking={false}
      />,
    );

    expect(lastFrame()!).toContain("reconnecting");
  });

  test("shows failed status in the canvas indicator", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={false}
        canvasStatus="failed"
        canvasUrl="http://192.168.1.1:3000"
        canvasName="HW1"
        isThinking={false}
      />,
    );

    expect(lastFrame()!).toContain("failed");
  });

  test("shows thinking indicator", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={false}
        canvasUrl={null}
        canvasName={null}
        isThinking={true}
      />,
    );

    expect(lastFrame()!).toContain("thinking");
  });
});

describe("Chat", () => {
  test("renders messages with role labels", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello there", timestamp: new Date() },
      { role: "assistant", content: "What are you working on?", timestamp: new Date() },
    ];

    const { lastFrame } = render(<Chat messages={messages} />);
    const frame = lastFrame()!;

    expect(frame).toContain("you");
    expect(frame).toContain("Hello there");
    expect(frame).toContain("clark");
    expect(frame).toContain("What are you working on?");
  });

  test("renders system messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Welcome to Clark.", timestamp: new Date() },
    ];

    const { lastFrame } = render(<Chat messages={messages} />);
    expect(lastFrame()!).toContain("Welcome to Clark.");
  });

  test("renders streaming text with cursor", () => {
    const { lastFrame } = render(
      <Chat messages={[]} streamingText="Partial response so far" />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Partial response so far");
    expect(frame).toContain("clark");
  });

  test("does not show streaming block when undefined", () => {
    const { lastFrame } = render(
      <Chat messages={[{ role: "user", content: "hi", timestamp: new Date() }]} />,
    );

    const frame = lastFrame()!;
    const clarkCount = (frame.match(/clark/g) ?? []).length;
    expect(clarkCount).toBe(0);
  });

  test("renders multiline streaming thinking content", () => {
    const { lastFrame } = render(
      <Chat messages={[]} streamingThinking={"line one\nline two"} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("thinking");
    expect(frame).toContain("line one");
    expect(frame).toContain("line two");
  });

  test("does not leak ANSI fragments in assistant markdown output", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "[arxiv.org](https://arxiv.org) - Search cs.LG",
        timestamp: new Date(),
      },
    ];

    const { lastFrame } = render(<Chat messages={messages} />);
    const frame = lastFrame()!;
    const frameWithoutAnsi = frame.replace(/\u001b\[[0-9;]*m/g, "");

    expect(frame).toContain("arxiv.org (https://arxiv.org)");
    // Broken ANSI leaks show up as orphaned truecolor fragments (missing ESC),
    // e.g. "38;2;232;220;202m" or "[38;2;232;220;202m".
    expect(frameWithoutAnsi).not.toMatch(/\[?38;2;\d+;\d+;\d+m/);
  });
});

describe("App", () => {
  function createAppProps(
    mockResponses: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>; stopReason?: "end_turn" | "tool_use" }> = [],
    configOverride: Partial<ClarkConfig> = {},
  ) {
    const provider = new MockProvider(mockResponses);
    const conversation = new Conversation();
    const broker = new CanvasBroker();
    const tools = createTools({ getBroker: () => broker, vaultDir: TEST_VAULT, getSaveCanvas: () => null });

    return {
      provider,
      conversation,
      broker,
      appProps: {
        provider,
        model: "mock-model",
        config: configOverride,
        conversation,
        systemPrompt: "You are a test tutor.",
        tools,
        isCanvasConnected: () => false,
        onSlashCommand: async (name: string, _args: string) => {
          if (name === "help") return "Help text here";
          if (name === "clear") { conversation.clear(); return "Cleared."; }
          return `Unknown: /${name}`;
        },
        onOpenCanvas: async (name: string) => ({ url: `http://localhost:3000` }),
        listCanvases: async () => [],
        workspaceDir: TEST_VAULT,
      },
    };
  }

  test("renders welcome message on startup", () => {
    const { appProps } = createAppProps();
    const { lastFrame } = render(<App {...appProps} />);

    const frame = lastFrame()!;
    expect(frame).toContain("Welcome to Clark");
    expect(frame).toContain(">");
  });

  test("renders status bar with provider info", () => {
    const { appProps } = createAppProps();
    const { lastFrame } = render(<App {...appProps} />);

    const frame = lastFrame()!;
    expect(frame).toContain("mock");
    expect(frame).toContain("mock-model");
  });

  test("shows no canvas in status when none open", () => {
    const { appProps } = createAppProps();
    const { lastFrame } = render(<App {...appProps} />);

    expect(lastFrame()!).toContain("no canvas");
  });

  test("handles user text input and LLM response", async () => {
    const { appProps, provider } = createAppProps([
      { text: "What problem are you working on?" },
    ]);
    const { lastFrame, stdin } = render(<App {...appProps} />);

    await tick(); // Wait for mount
    // Type message and submit in one write (Ink processes the full buffer)
    for (const ch of "I need help") stdin.write(ch);
    await tick();
    stdin.write("\r");

    await tick(200);

    const frame = lastFrame()!;
    expect(frame).toContain("I need help");
    expect(frame).toContain("What problem are you working on?");
    expect(provider.calls).toHaveLength(1);
  });

  test("handles slash command", async () => {
    const { appProps, provider } = createAppProps();
    const { lastFrame, stdin } = render(<App {...appProps} />);

    await tick();
    for (const ch of "/help") stdin.write(ch);
    await tick();
    stdin.write("\r"); // Enter submits (exact match)

    await tick(100);

    expect(lastFrame()!).toContain("Help text here");
    expect(provider.calls).toHaveLength(0);
  });

  test("LLM receives system prompt", async () => {
    const { appProps, provider } = createAppProps([{ text: "Hi!" }]);
    const { stdin } = render(<App {...appProps} />);

    await tick();
    for (const ch of "hello") stdin.write(ch);
    await tick();
    stdin.write("\r");

    await tick(200);

    expect(provider.calls.length).toBeGreaterThanOrEqual(1);
    expect(provider.lastCall!.systemPrompt).toBe("You are a test tutor.");
  });

  test("tool call flow works end to end", async () => {
    const { appProps, provider } = createAppProps([
      {
        text: "Let me search.",
        toolCalls: [{ id: "tc1", name: "search_notes", input: { query: "test" } }],
        stopReason: "tool_use",
      },
      { text: "No notes found for that query." },
    ]);
    const { lastFrame, stdin } = render(<App {...appProps} />);

    await tick();
    for (const ch of "search notes") stdin.write(ch);
    await tick();
    stdin.write("\r");

    await tick(300);

    const frame = lastFrame()!;
    expect(frame).toContain("search_notes");
    expect(frame).toContain("No notes found for that query.");
    expect(provider.calls).toHaveLength(2);
  });

  test("normalizes tool image mimeType before reinjecting for non-Anthropic providers", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [{ id: "tc1", name: "image_tool", input: {} }],
        stopReason: "tool_use",
      },
      { text: "I can see the image." },
    ]);
    const conversation = new Conversation();
    const broker = new CanvasBroker();
    const tools = [
      ...createTools({ getBroker: () => broker, vaultDir: TEST_VAULT, getSaveCanvas: () => null }),
      {
        name: "image_tool",
        description: "Returns an image payload.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({
          content: [{ type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" }],
          isError: false,
        }),
      },
    ];

    const { stdin } = render(
      <App
        provider={provider}
        model="mock-model"
        config={{}}
        conversation={conversation}
        systemPrompt="You are a test tutor."
        tools={tools}
        isCanvasConnected={() => false}
        onSlashCommand={async () => null}
        onOpenCanvas={async () => ({ url: "http://localhost:3000" })}
        listCanvases={async () => []}
        workspaceDir={TEST_VAULT}
      />,
    );

    await tick();
    for (const ch of "show me image") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(260);

    expect(provider.calls).toHaveLength(2);
    const secondCallMessages = provider.calls[1]!.messages;
    const userImageMessage = secondCallMessages.find((m) =>
      m.role === "user" && m.content.some((c) => c.type === "image")
    );
    expect(userImageMessage).toBeDefined();
    const imagePart = userImageMessage!.content.find((c) => c.type === "image");
    expect(imagePart).toBeDefined();
    if (imagePart?.type === "image") {
      expect(imagePart.mediaType).toBe("image/png");
    }
  });

  test("stops when max tool calls per turn is reached", async () => {
    const { appProps, provider } = createAppProps(
      [
        {
          text: "Step 1",
          toolCalls: [{ id: "tc1", name: "search_notes", input: { query: "one" } }],
          stopReason: "tool_use",
        },
        {
          text: "Step 2",
          toolCalls: [{ id: "tc2", name: "search_notes", input: { query: "two" } }],
          stopReason: "tool_use",
        },
      ],
      { maxToolCallsPerTurn: 1 },
    );

    const { lastFrame, stdin } = render(<App {...appProps} />);
    await tick();
    for (const ch of "loop tools") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(350);

    const frame = lastFrame()!;
    expect(frame).toContain("max tool calls per turn reached (1)");
    expect(provider.calls).toHaveLength(2);
  });

  test("blocks dispatch when a single response exceeds max tool calls", async () => {
    const { appProps, provider } = createAppProps(
      [
        {
          text: "Need tools",
          toolCalls: [
            { id: "tc1", name: "search_notes", input: { query: "one" } },
            { id: "tc2", name: "search_notes", input: { query: "two" } },
          ],
          stopReason: "tool_use",
        },
      ],
      { maxToolCallsPerTurn: 1 },
    );

    const { lastFrame, stdin } = render(<App {...appProps} />);
    await tick();
    for (const ch of "run tools") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(250);

    const frame = lastFrame()!;
    expect(frame).toContain("max tool calls per turn reached (1)");
    expect(frame).not.toContain("Using tool:");
    expect(provider.calls).toHaveLength(1);
  });

  test("surfaces max_tokens truncation to the user", async () => {
    const { appProps } = createAppProps([
      { text: "Partial output", stopReason: "max_tokens" },
    ]);
    const { lastFrame, stdin } = render(<App {...appProps} />);

    await tick();
    for (const ch of "trigger truncation") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(220);

    const frame = lastFrame()!;
    expect(frame).toContain("Partial output");
    expect(frame).toContain("Response was truncated due to max_tokens limit.");
  });

  test("conversation history accumulates across turns", async () => {
    const { appProps, provider } = createAppProps([
      { text: "Response 1" },
      { text: "Response 2" },
    ]);
    const { stdin } = render(<App {...appProps} />);

    // Turn 1
    await tick();
    for (const ch of "message one") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(200);

    // Turn 2
    for (const ch of "message two") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(200);

    // Second call should have full history
    expect(provider.calls).toHaveLength(2);
    const messages = provider.calls[1]!.messages;
    expect(messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  test("/clear resets conversation", async () => {
    const { appProps, provider } = createAppProps([
      { text: "Response 1" },
      { text: "Response after clear" },
    ]);
    const { lastFrame, stdin } = render(<App {...appProps} />);

    // Send a message
    await tick();
    for (const ch of "hello") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(200);

    // Clear
    for (const ch of "/clear") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(100);

    expect(lastFrame()!).toContain("Cleared.");

    // Send another message — conversation should be fresh
    for (const ch of "hello again") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(200);

    // The second LLM call should only have one user message
    expect(provider.calls).toHaveLength(2);
    const messages = provider.calls[1]!.messages;
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  test("LLM error is displayed gracefully", async () => {
    const provider = new MockProvider([]);
    const origChat = provider.chat.bind(provider);
    provider.chat = async function* () {
      throw new Error("API rate limit exceeded");
    };

    const conversation = new Conversation();
    const broker = new CanvasBroker();
    const tools = createTools({ getBroker: () => broker, vaultDir: TEST_VAULT, getSaveCanvas: () => null });

    const { lastFrame, stdin } = render(
      <App
        provider={provider}
        model="mock"
        config={{}}
        conversation={conversation}
        systemPrompt="test"
        tools={tools}
        isCanvasConnected={() => false}
        onSlashCommand={async () => null}
        onOpenCanvas={async (name: string) => ({ url: "http://localhost:3000" })}
        listCanvases={async () => []}
        workspaceDir={TEST_VAULT}
      />,
    );

    await tick();
    for (const ch of "trigger error") stdin.write(ch);
    await tick();
    stdin.write("\r");
    await tick(200);

    const frame = lastFrame()!;
    expect(frame).toContain("API rate limit exceeded");
    // Streaming block should be cleared — no stale "clark _" cursor
    expect(frame).not.toContain("_");
    // Input should be re-enabled (prompt visible, not "waiting for response")
    expect(frame).toContain(">");
    expect(frame).not.toContain("waiting for response");
  });

  test("enter submits highlighted hint command", async () => {
    const { appProps } = createAppProps();
    const { lastFrame, stdin } = render(<App {...appProps} />);

    await tick();
    // Type just "/" — all commands show, /help is first and highlighted
    stdin.write("/");
    await tick();
    // Press Enter — should submit /help (the highlighted command), not "/"
    stdin.write("\r");
    await tick(100);

    expect(lastFrame()!).toContain("Help text here");
  });

});
