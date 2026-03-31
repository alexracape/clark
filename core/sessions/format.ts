/**
 * Session file format: serialize/deserialize Conversation messages to markdown.
 *
 * Format uses HTML comment markers (invisible in rendered markdown) to delimit
 * messages and embed machine-readable metadata. Content between markers is
 * plain human-readable text.
 *
 * Message marker:   <!-- clark:{"t":"msg","role":"...",...} -->
 * Tool call marker: <!-- clark:{"t":"call","id":"...","name":"...","input":{}} -->
 *
 * Tool call markers appear within an assistant section and have no body text.
 * The section text (stripped of comment lines) becomes the assistant text content.
 *
 * For tool result images: read_file images are stored as ![[wikilink]],
 * read_canvas snapshots are omitted with a note (per user decision), and other
 * images are omitted with a note.
 */

import type {
  Message,
  MessageContent,
  ImageContent,
} from "../llm/provider.ts";

// Regex to match a clark comment line and capture its JSON payload
const CLARK_COMMENT_RE = /^<!-- clark:(.*) -->$/;

// Strip the "Canvas state: ..." prefix injected into every user message before saving.
// Format: "Canvas state: {state}\n\n{text}" or "Canvas state: {state} ({name})\n\n{text}"
const CANVAS_PREFIX_RE = /^Canvas state: [^\n]+\n\n/;

export interface SessionFrontmatter {
  sessionId: string;
  created: string;
  provider: string;
  model: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Encode data as a clark HTML comment. Escapes --> sequences so they can't
 * prematurely close the comment.
 */
function toComment(data: Record<string, unknown>): string {
  const json = JSON.stringify(data).replace(/-->/g, "--\\u003e");
  return `<!-- clark:${json} -->`;
}

/** Build a lookup of toolUseId → { name, input } from all messages. */
function buildToolUseIndex(
  messages: Message[],
): Map<string, { name: string; input: Record<string, unknown> }> {
  const map = new Map<
    string,
    { name: string; input: Record<string, unknown> }
  >();
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part.type === "tool_use") {
        map.set(part.id, { name: part.name, input: part.input });
      }
    }
  }
  return map;
}

/**
 * Serialize a list of messages to markdown text (no frontmatter).
 * Suitable for appending to an existing session file.
 */
export function serializeMessages(
  messages: Message[],
  workspaceDir: string,
): string {
  const toolUseIndex = buildToolUseIndex(messages);
  const out: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // Only serialize text parts — skip re-injected image messages from non-Anthropic providers
      const textParts = msg.content.filter(
        (c): c is { type: "text"; text: string } => c.type === "text",
      );
      if (textParts.length === 0) continue;
      const text = textParts.map((p) => p.text).join("\n").replace(CANVAS_PREFIX_RE, "");
      if (!text.trim()) continue;
      out.push(toComment({ t: "msg", role: "user" }));
      out.push(text);
      out.push("");
    } else if (msg.role === "assistant") {
      out.push(toComment({ t: "msg", role: "assistant" }));
      let textContent = "";
      const callLines: string[] = [];

      for (const part of msg.content) {
        if (part.type === "text") {
          textContent += part.text;
        } else if (part.type === "tool_use") {
          callLines.push(
            toComment({
              t: "call",
              id: part.id,
              name: part.name,
              input: part.input,
            }),
          );
        }
        // Omit thinking content
      }

      if (textContent) out.push(textContent);
      for (const line of callLines) out.push(line);
      out.push("");
    } else if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type !== "tool_result") continue;
        const toolInfo = toolUseIndex.get(part.toolUseId);
        const name = toolInfo?.name ?? "unknown";

        out.push(
          toComment({
            t: "msg",
            role: "tool",
            toolUseId: part.toolUseId,
            name,
            isError: part.isError ?? false,
          }),
        );

        if (typeof part.content === "string") {
          out.push(part.content);
        } else {
          // Image content array
          if (name === "read_file" && toolInfo?.input?.path) {
            out.push(`![[${toolInfo.input.path}]]`);
          } else if (name === "read_canvas") {
            out.push(
              "[canvas snapshot omitted — use read_canvas for current state]",
            );
          } else {
            out.push("[image omitted]");
          }
        }

        out.push("");
      }
    }
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

/** Parse a clark comment line and return its JSON payload, or null. */
function parseComment(line: string): Record<string, unknown> | null {
  const m = line.match(CLARK_COMMENT_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseFrontmatter(text: string): SessionFrontmatter {
  const get = (key: string): string => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m?.[1]?.trim() ?? "";
  };
  return {
    sessionId: get("session-id"),
    created: get("created"),
    provider: get("provider"),
    model: get("model"),
    title: get("title") || undefined,
  };
}

interface Section {
  meta: Record<string, unknown>;
  lines: string[];
}

function parseSections(body: string): Section[] {
  const lines = body.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const meta = parseComment(line);
    if (meta) {
      if (meta.t === "msg") {
        if (current) sections.push(current);
        current = { meta, lines: [] };
      } else if (meta.t === "call" && current) {
        current.lines.push(line);
      }
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function sectionToMessage(section: Section): Message | null {
  const role = section.meta.role as string;

  // Text content = lines that are NOT clark comment lines, trimmed
  const textLines = section.lines.filter((l) => !parseComment(l));
  const text = textLines.join("\n").trim();

  if (role === "user") {
    if (!text) return null;
    return {
      role: "user",
      content: [{ type: "text", text }],
    };
  }

  if (role === "assistant") {
    const content: MessageContent[] = [];
    if (text) content.push({ type: "text", text });

    for (const line of section.lines) {
      const meta = parseComment(line);
      if (meta?.t === "call") {
        content.push({
          type: "tool_use",
          id: meta.id as string,
          name: meta.name as string,
          input: (meta.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    if (content.length === 0) return null;
    return { role: "assistant", content };
  }

  if (role === "tool") {
    const toolUseId = section.meta.toolUseId as string;
    if (!toolUseId) return null;
    return {
      role: "tool",
      content: [
        {
          type: "tool_result",
          toolUseId,
          content: text,
          isError: (section.meta.isError as boolean) ?? false,
        },
      ],
    };
  }

  return null;
}

/**
 * Parse the full session file content into frontmatter + messages.
 */
export function deserializeSession(content: string): {
  frontmatter: SessionFrontmatter;
  messages: Message[];
} {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return {
      frontmatter: { sessionId: "", created: "", provider: "", model: "" },
      messages: [],
    };
  }

  const frontmatter = parseFrontmatter(fmMatch[1]!);
  const body = content.slice(fmMatch[0].length);
  const sections = parseSections(body);
  const messages = sections
    .map(sectionToMessage)
    .filter((m): m is Message => m !== null);

  return { frontmatter, messages };
}

/**
 * Extract the first user message preview from session file content.
 * Used for the session listing UI without full deserialization.
 */
export function parseFirstUserMessage(content: string): string {
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const lines = body.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const meta = parseComment(lines[i]!);
    if (meta?.t === "msg" && meta.role === "user") {
      const textLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (parseComment(lines[j]!)) break;
        const trimmed = lines[j]!.trim();
        if (trimmed) textLines.push(trimmed);
      }
      return textLines.join(" ").slice(0, 80);
    }
  }
  return "";
}
