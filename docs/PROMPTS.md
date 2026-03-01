# Prompt & Context Architecture

How Clark assembles the context window for each LLM conversation.

## Context Window Overview

Every message sent to the LLM includes these components, assembled at different stages:

```
┌─────────────────────────────────────────────────────┐
│                   SYSTEM PROMPT                     │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Base Prompt (system.md)                      │  │
│  │  Socratic tutoring rules, tool guidance       │  │
│  ├───────────────────────────────────────────────┤  │
│  │  Structures Summary                           │  │
│  │  Auto-generated from Clark/Structures/*.md    │  │
│  ├───────────────────────────────────────────────┤  │
│  │  CLARK.md                                     │  │
│  │  User customization (per-workspace)           │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
├─────────────────────────────────────────────────────┤
│                 TOOL DEFINITIONS                    │
│  JSON schemas for all 13 tools                      │
│  (read_file, search_notes, read_canvas, etc.)       │
├─────────────────────────────────────────────────────┤
│              CONVERSATION MESSAGES                  │
│                                                     │
│  User messages        (text, images)                │
│  Assistant messages   (text, thinking, tool calls)  │
│  Tool results         (text, images)                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Component Details

### 1. Base System Prompt

The static core of Clark's personality and behavior.

**Defined in:** [`core/prompts/system.md`](../core/prompts/system.md)

Contains:
- **Identity** — "You are Clark, a Socratic tutoring assistant"
- **7 Core Rules** — Never solve directly, ask one question at a time, reference student work, use their materials, identify misconceptions gently, encourage progress, adapt to level
- **Handwriting guidance** — How to respond when reading canvas snapshots
- **Tool usage guidance** — When to use canvas reading, file tools, search, and PDF export

This file is imported as raw text at build time:
```ts
import baseSystemPrompt from "../prompts/system.md" with { type: "text" };
```

### 2. Structures Summary

Auto-generated section that tells the LLM what note structures are available in the student's workspace.

**Loaded by:** [`cli/bootstrap/system-prompt.ts`](../cli/bootstrap/system-prompt.ts) — `loadStructureSummary()`

**Source files:** `Clark/Structures/*.md` in the student's workspace

At startup, Clark scans the `Clark/Structures/` directory, reads each `.md` file, extracts the first sentence of its `## Purpose` section, and builds a bullet list:

```markdown
## Structures

The student's workspace contains Structure definitions in Clark/Structures/.
When they want to create a new structure, read the full definition file for instructions, then use create_file to make it.

- **Class**: This file tracks the key information associated with a course taken at school
- **Problem Set**: This file represents a problem set that is being submitted for a class
- **Idea**: This is an atomic unit and each idea should have its own file
- **Paper**: This file corresponds to an academic paper that I read
- **Quote**: (template-only, no Purpose section)
- **Resource**: These are raw documents that are not in markdown format
```

**Default structure templates defined in:** [`core/library.ts`](../core/library.ts) (lines 188–263)

### 3. CLARK.md (User Customization)

A per-workspace file where students can add custom instructions that get injected into the system prompt.

**Loaded by:** [`core/library.ts`](../core/library.ts) — `loadClarkContext()`

**File location:** `Clark/CLARK.md` in the student's workspace

If the file exists, its contents are appended to the system prompt under a `## CLARK.md` header. This lets students configure behavior like:
- How Clark should address them
- How the library of documents should be organized
- How to use their defined structures 

A default `CLARK.md` is scaffolded when a workspace is first initialized.

### 4. System Prompt Assembly

All three sections above are combined into one string.

**Assembled by:** [`cli/bootstrap/system-prompt.ts`](../cli/bootstrap/system-prompt.ts) — `loadEffectiveSystemPrompt()`

```
{base system prompt}

---
{structures summary}

---
## CLARK.md
{clark.md content}
```

Sections are separated by `\n\n---\n` and only included if non-empty.

### 5. Tool Definitions

Clark exposes 13 tools to the LLM via JSON schemas. These are serialized and sent alongside each request.

**Defined in:** [`core/mcp/tools.ts`](../core/mcp/tools.ts) — `createTools()`

**Converted to LLM format in:** [`cli/tui/app.tsx`](../cli/tui/app.tsx) — `toLLMTools()` (line 51)

| Tool | Description |
|------|-------------|
| `read_file` | Read markdown, PDF, or image files from the vault |
| `search_notes` | Keyword search across markdown files |
| `list_files` | List files with optional filtering |
| `create_file` | Create new files in the vault |
| `edit_file` | Find/replace in existing files |
| `rename_file` | Rename or move files |
| `delete_file` | Delete files (with confirmation) |
| `read_canvas` | Capture PNG snapshot of a canvas page |
| `export_pdf` | Export canvas pages as A4 PDF |
| `save_canvas` | Persist canvas state to disk |
| `search_by_tag` | Search by Obsidian-style tags (#class, #paper) |
| `websearch` | Web search via DuckDuckGo |
| `transcribe_pdf` | OCR scanned PDFs using vision models |

Each tool definition includes a `name`, `description`, `inputSchema` (JSON Schema), and a `handler` function. Only the schema is sent to the LLM; the handler runs locally.

### 6. Conversation Messages

The running message history managed by the `Conversation` class.

**Defined in:** [`core/llm/messages.ts`](../core/llm/messages.ts)

Message types in the conversation:
- **User text** — typed input from the student
- **User images** — canvas snapshots or ingested image files (base64-encoded)
- **Assistant text** — Clark's responses
- **Assistant thinking** — extended thinking content (filtered before re-sending to LLM)
- **Tool use** — tool call requests from the LLM
- **Tool results** — text or image results returned from tool execution

Images are estimated at 1,600 tokens each. Text tokens are estimated at 4 characters per token.

### 7. Conversation Turn Loop

The agentic loop that handles multi-step tool use.

**Orchestrated in:** [`core/engine.ts`](../core/engine.ts) — `ConversationEngine.runTurn()`

The `ConversationEngine` class owns the turn loop and is UI-agnostic. Both the CLI (`cli/tui/app.tsx`) and GUI (Tauri sidecar) drive it via `TurnCallbacks`.

```
User sends message
  └─> engine.runTurn(provider, callbacks)
       └─> streamLLM() — send messages + tools + system prompt to provider
            └─> Provider returns response (text, tool calls, or both)
                 ├─> If no tool calls → callbacks.onAssistantMessage(), done
                 └─> If tool calls → dispatchTool() for each
                      ├─> Add tool results to conversation
                      └─> Loop back to streamLLM() with updated messages
                           (up to maxToolCallsPerTurn, default 8)
```

### 8. Provider-Specific Prompt Handling

Each LLM provider receives the system prompt differently.

**Provider interface:** [`core/llm/provider.ts`](../core/llm/provider.ts)

| Provider | System prompt injection | File |
|----------|------------------------|------|
| Anthropic | `system` parameter (native) | [`core/llm/anthropic.ts`](../core/llm/anthropic.ts) |
| OpenAI | First message with `role: "system"` | [`core/llm/openai.ts`](../core/llm/openai.ts) |
| Gemini | `systemInstruction` parameter | [`core/llm/gemini.ts`](../core/llm/gemini.ts) |
| Ollama | Prepended as system message | [`core/llm/ollama.ts`](../core/llm/ollama.ts) |

### 9. Context Window Visualization

The `/context` slash command renders a 10x10 grid showing token usage by category.

**Defined in:** [`cli/tui/context.ts`](../cli/tui/context.ts) — `formatContextGrid()`

Categories tracked:
- System prompt, Tool definitions, User messages, Assistant messages, Tool results, Thinking, Skills (reserved, currently 0), Free space

Context limits by model family:
| Model | Max tokens |
|-------|-----------|
| Claude | 200,000 |
| GPT-4o | 128,000 |
| Gemini | 1,048,576 |
| Default | 128,000 |

## File Index

All files involved in prompt and context management:

| File | Role |
|------|------|
| [`core/prompts/system.md`](../core/prompts/system.md) | Base system prompt text |
| [`cli/bootstrap/system-prompt.ts`](../cli/bootstrap/system-prompt.ts) | Assembles system prompt from parts |
| [`core/library.ts`](../core/library.ts) | CLARK.md loading, structure templates, workspace scaffolding |
| [`core/mcp/tools.ts`](../core/mcp/tools.ts) | Tool definitions and handlers |
| [`core/llm/messages.ts`](../core/llm/messages.ts) | Conversation state and message management |
| [`core/llm/provider.ts`](../core/llm/provider.ts) | Provider interface |
| [`core/llm/anthropic.ts`](../core/llm/anthropic.ts) | Anthropic provider (Claude) |
| [`core/llm/openai.ts`](../core/llm/openai.ts) | OpenAI provider |
| [`core/llm/gemini.ts`](../core/llm/gemini.ts) | Gemini provider |
| [`core/llm/ollama.ts`](../core/llm/ollama.ts) | Ollama provider |
| [`core/engine.ts`](../core/engine.ts) | Conversation turn loop and tool dispatch (UI-agnostic) |
| [`cli/tui/app.tsx`](../cli/tui/app.tsx) | TUI shell — wires engine callbacks to React state |
| [`cli/tui/context.ts`](../cli/tui/context.ts) | Context window visualization |
