/**
 * SessionManager — create, append, list, and load session files.
 *
 * Sessions are stored as markdown files in <workspace>/Clark/Sessions/.
 * Files are named YYYY-MM-DD.md; multiple sessions on the same day get a
 * numeric suffix: YYYY-MM-DD-2.md, YYYY-MM-DD-3.md, etc.
 *
 * Writes are incremental — new messages are appended to the session file
 * after each turn, so crashes only lose the in-progress turn.
 */

import { mkdir, readdir, appendFile, rename, readFile, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import type { LLMProvider, Message } from "../llm/provider.ts";
import {
  serializeMessages,
  deserializeSession,
  parseFirstUserMessage,
  type SessionFrontmatter,
} from "./format.ts";

/** Load the title generation prompt from core/prompts/title.md */
let titlePromptCache: string | null = null;
async function loadTitlePrompt(): Promise<string> {
  if (titlePromptCache) return titlePromptCache;
  const promptPath = join(import.meta.dir, "..", "prompts", "title.md");
  titlePromptCache = await Bun.file(promptPath).text();
  return titlePromptCache;
}

export interface SessionInfo {
  path: string;
  filename: string;
  /** YYYY-MM-DD */
  date: string;
  sessionId: string;
  provider: string;
  model: string;
  /** LLM-generated session title */
  title?: string;
  /** Preview of the first user message (up to 80 chars) */
  firstUserMessage: string;
}

export class SessionManager {
  constructor(
    private readonly sessionsDir: string,
    private readonly workspaceDir: string,
  ) {}

  /**
   * Create a new session file and return its path.
   * Writes the frontmatter header immediately.
   */
  async createSession(provider: string, model: string): Promise<string> {
    await mkdir(this.sessionsDir, { recursive: true });
    const dateStr = new Date().toISOString().split("T")[0]!;
    const filePath = await this.uniquePath(dateStr);
    const sessionId = Math.random().toString(36).slice(2, 10);
    const header = [
      "---",
      `session-id: ${sessionId}`,
      `created: ${new Date().toISOString()}`,
      `provider: ${provider}`,
      `model: ${model}`,
      "---",
      "",
      "",
    ].join("\n");
    await Bun.write(filePath, header);
    return filePath;
  }

  /**
   * Append new messages to an existing session file.
   * Called after each completed conversation turn.
   */
  async appendMessages(
    filePath: string,
    newMessages: Message[],
  ): Promise<void> {
    if (newMessages.length === 0) return;
    const content = serializeMessages(newMessages, this.workspaceDir);
    if (!content.trim()) return;
    await appendFile(filePath, content);
  }

  /** List all sessions, newest first. */
  async listSessions(): Promise<SessionInfo[]> {
    try {
      const files = await readdir(this.sessionsDir);
      const mdFiles = files
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();

      const sessions: SessionInfo[] = [];
      for (const filename of mdFiles) {
        const filePath = join(this.sessionsDir, filename);
        try {
          const content = await Bun.file(filePath).text();
          const { frontmatter } = deserializeSession(content);
          const firstUserMessage = parseFirstUserMessage(content);
          sessions.push({
            path: filePath,
            filename,
            date: frontmatter.created ? frontmatter.created.split("T")[0]! : filename.replace(/(-\d+)?\.md$/, ""),
            sessionId: frontmatter.sessionId,
            provider: frontmatter.provider,
            model: frontmatter.model,
            title: frontmatter.title,
            firstUserMessage,
          });
        } catch {
          // Skip unreadable or malformed files
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  /** Load messages from a session file. */
  async loadSession(
    filePath: string,
  ): Promise<{ frontmatter: SessionFrontmatter; messages: Message[] }> {
    const content = await Bun.file(filePath).text();
    return deserializeSession(content);
  }

  /**
   * Generate a short title for a session using the LLM provider, then rename
   * the session file and update its frontmatter. Returns the new file path,
   * or the original path if title generation fails.
   */
  async generateTitle(
    filePath: string,
    provider: LLMProvider,
    firstUserMessage: string,
  ): Promise<string> {
    try {
      const systemPrompt = await loadTitlePrompt();
      const messages: Message[] = [
        { role: "user", content: [{ type: "text", text: firstUserMessage }] },
      ];

      let title = "";
      for await (const chunk of provider.chat(messages, [], systemPrompt)) {
        if (chunk.type === "text_delta") title += chunk.text;
      }

      title = title.trim().replace(/[^\w\s'-]/g, "").trim();
      if (!title || title.length > 60) return filePath;

      // Slugify for filename: "Linear Algebra Review" → "Linear-Algebra-Review"
      const slug = title.replace(/\s+/g, "-");
      const dir = dirname(filePath);
      const oldName = basename(filePath, ".md");
      const newName = `${oldName} ${slug}`;
      const newPath = join(dir, `${newName}.md`);

      // Update frontmatter to include title
      const content = await Bun.file(filePath).text();
      const updated = content.replace(
        /^(---\n[\s\S]*?)(---\n)/,
        `$1title: ${title}\n$2`,
      );
      await writeFile(filePath, updated);
      await rename(filePath, newPath);
      return newPath;
    } catch {
      return filePath; // Silently fall back to date-only name
    }
  }

  /** Find the next available session file path for a given date string. */
  private async uniquePath(dateStr: string): Promise<string> {
    const base = join(this.sessionsDir, `${dateStr}.md`);
    if (!(await Bun.file(base).exists())) return base;
    for (let i = 2; i <= 99; i++) {
      const p = join(this.sessionsDir, `${dateStr}-${i}.md`);
      if (!(await Bun.file(p).exists())) return p;
    }
    return base;
  }
}
