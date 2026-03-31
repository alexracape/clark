/**
 * Tests for LLM-generated session titles.
 *
 * Exercises title generation, file renaming, frontmatter updates,
 * and fallback behavior when the LLM fails or returns bad output.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "../core/sessions/manager.ts";
import { deserializeSession } from "../core/sessions/format.ts";
import { MockProvider } from "../core/llm/mock.ts";

let tempDir: string;
let sessionsDir: string;
let manager: SessionManager;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "clark-session-title-"));
  sessionsDir = join(tempDir, "Sessions");
  manager = new SessionManager(sessionsDir, tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("generateTitle", () => {
  test("renames session file with slugified title", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    const mock = new MockProvider([{ text: "Linear Algebra Review" }]);

    const newPath = await manager.generateTitle(filePath, mock, "Help me with eigenvalues");

    expect(newPath).not.toBe(filePath);
    expect(newPath).toContain("Linear-Algebra-Review");
    expect(newPath).toEndWith(".md");
    expect(await Bun.file(newPath).exists()).toBe(true);
    expect(await Bun.file(filePath).exists()).toBe(false);
  });

  test("adds title to frontmatter", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    const mock = new MockProvider([{ text: "Calculus Help" }]);

    const newPath = await manager.generateTitle(filePath, mock, "What is a derivative?");

    const content = await Bun.file(newPath).text();
    const { frontmatter } = deserializeSession(content);
    expect(frontmatter.title).toBe("Calculus Help");
  });

  test("sends first user message to provider with title prompt", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    const mock = new MockProvider([{ text: "Physics Momentum" }]);

    await manager.generateTitle(filePath, mock, "Explain conservation of momentum");

    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0]!;
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]!.role).toBe("user");
    expect(call.tools).toHaveLength(0);
    expect(call.systemPrompt).toContain("2-4 word title");
  });

  test("preserves original path when title is empty", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    const mock = new MockProvider([{ text: "   " }]);

    const result = await manager.generateTitle(filePath, mock, "hello");

    expect(result).toBe(filePath);
    expect(await Bun.file(filePath).exists()).toBe(true);
  });

  test("preserves original path when title is too long", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    const longTitle = "A".repeat(61);
    const mock = new MockProvider([{ text: longTitle }]);

    const result = await manager.generateTitle(filePath, mock, "hello");

    expect(result).toBe(filePath);
  });

  test("strips non-alphanumeric characters from title", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    const mock = new MockProvider([{ text: "**Organic Chemistry**" }]);

    const newPath = await manager.generateTitle(filePath, mock, "benzene rings");

    expect(newPath).toContain("Organic-Chemistry");
    expect(newPath).not.toContain("*");
  });

  test("falls back silently when provider throws", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    const failingProvider: MockProvider = new MockProvider([]);
    // Override chat to throw
    failingProvider.chat = async function* () {
      throw new Error("network error");
    };

    const result = await manager.generateTitle(filePath, failingProvider, "hello");

    expect(result).toBe(filePath);
    expect(await Bun.file(filePath).exists()).toBe(true);
  });

  test("title appears in listSessions results", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    // Write a user message so listing has content
    await manager.appendMessages(filePath, [
      { role: "user", content: [{ type: "text", text: "What is a matrix?" }] },
    ]);
    const mock = new MockProvider([{ text: "Matrix Basics" }]);
    await manager.generateTitle(filePath, mock, "What is a matrix?");

    const sessions = await manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.title).toBe("Matrix Basics");
  });

  test("preserves existing session content after rename", async () => {
    const filePath = await manager.createSession("mock", "test-model");
    await manager.appendMessages(filePath, [
      { role: "user", content: [{ type: "text", text: "Help with integrals" }] },
      { role: "assistant", content: [{ type: "text", text: "Sure, let's start." }] },
    ]);
    const mock = new MockProvider([{ text: "Integration Help" }]);

    const newPath = await manager.generateTitle(filePath, mock, "Help with integrals");

    const { frontmatter, messages } = await manager.loadSession(newPath);
    expect(frontmatter.title).toBe("Integration Help");
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
  });
});
