/**
 * TUI component tests using ink-testing-library.
 *
 * Renders components in a virtual terminal and asserts on output frames.
 * Uses MockProvider so no real API calls are made.
 */

import React from "react";
import { test, expect, describe, afterEach } from "bun:test";
import { render, cleanup } from "ink-testing-library";
import { App } from "../src/tui/app.tsx";
import { StatusBar } from "../src/tui/status.tsx";
import { Chat, type ChatMessage } from "../src/tui/chat.tsx";
import { MockProvider } from "../src/llm/mock.ts";
import { Conversation } from "../src/llm/messages.ts";
import { createTools } from "../src/mcp/tools.ts";
import { CanvasBroker } from "../src/canvas/server.ts";

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

  test("shows canvas URL when disconnected", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={false}
        canvasUrl="http://192.168.1.1:3000"
        isThinking={false}
      />,
    );

    expect(lastFrame()!).toContain("http://192.168.1.1:3000");
  });

  test("shows connected status", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={true}
        canvasUrl="http://192.168.1.1:3000"
        isThinking={false}
      />,
    );

    expect(lastFrame()!).toContain("canvas connected");
  });

  test("shows thinking indicator", () => {
    const { lastFrame } = render(
      <StatusBar
        provider="mock"
        model="test"
        canvasConnected={false}
        canvasUrl="http://localhost:3000"
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
});

describe("App", () => {
  function createAppProps(mockResponses: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>; stopReason?: "end_turn" | "tool_use" }> = []) {
    const provider = new MockProvider(mockResponses);
    const conversation = new Conversation();
    const broker = new CanvasBroker();
    const tools = createTools({ broker });

    return {
      provider,
      conversation,
      broker,
      appProps: {
        provider,
        model: "mock-model",
        conversation,
        systemPrompt: "You are a test tutor.",
        tools,
        canvasUrl: "http://localhost:3000",
        isCanvasConnected: () => false,
        onSlashCommand: async (name: string, _args: string) => {
          if (name === "help") return "Help text here";
          if (name === "clear") { conversation.clear(); return "Cleared."; }
          return `Unknown: /${name}`;
        },
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

  test("shows canvas URL in status", () => {
    const { appProps } = createAppProps();
    const { lastFrame } = render(<App {...appProps} />);

    expect(lastFrame()!).toContain("http://localhost:3000");
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
    const tools = createTools({ broker });

    const { lastFrame, stdin } = render(
      <App
        provider={provider}
        model="mock"
        conversation={conversation}
        systemPrompt="test"
        tools={tools}
        canvasUrl="http://localhost:3000"
        isCanvasConnected={() => false}
        onSlashCommand={async () => null}
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
