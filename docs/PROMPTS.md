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

## Auxiliary Prompts

Beyond the main system prompt, Clark uses several smaller LLM prompts for specific tasks. These are single-turn calls (no tools) that handle file processing, naming, and conversation management.

### 5. Ingestion / Linking Prompt

When a file is dropped into the workspace, Clark runs the ingestion pipeline and then uses this prompt to link the new file into existing notes.

**Defined in:** [`core/prompts/ingest.md`](../core/prompts/ingest.md) (with fallback copy in [`core/app/ingest.ts`](../core/app/ingest.ts))

**Template variables:** `{{fileName}}`, `{{destPath}}`, `{{baseName}}`, `{{fileContent}}`, `{{conversationContext}}`

**Behavior:**
1. Uses `search_notes` and `list_files` to find related documents
2. Adds wikilinks (`[[path]]` or `![[path]]`) to relevant class pages or topic notes
3. Returns a brief summary of what was linked

This prompt is sent as a user message to `ConversationEngine.runTurn()` with the full tool set available, so the LLM can call file tools to explore and edit the workspace.

**Called from:** `runIngestionPipeline()` in [`core/app/ingest.ts`](../core/app/ingest.ts)

### 6. OCR Transcription Prompts

Used when transcribing scanned PDFs or images via the LLM's vision API.

**Defined in:** [`core/ocr/provider.ts`](../core/ocr/provider.ts)

**a) Page Transcription** — transcribes a single page image to markdown:
- System: `"You are a document transcription assistant. Output only the transcribed content in markdown format."`
- User: Instructs to preserve structure (headings, bullets), format math as LaTeX, describe diagrams in italics, skip page numbers.

**b) Multi-Page Consolidation** — merges page-by-page transcripts into one document:
- System: `"You are a document consolidation assistant. Your task is to merge multi-page transcriptions into a single coherent document."`
- User: Instructs to remove duplicate headers/footers, merge into cohesive flow, preserve unique content and markdown formatting.

**Called from:** `VisionOCRProvider.transcribeImage()` and `VisionOCRProvider.consolidateTranscript()`

### 7. File Naming Prompt

Suggests a descriptive filename for an ingested document based on its content.

**Defined in:** [`core/app/ingest.ts`](../core/app/ingest.ts) — `suggestFileName()`

- System: `"You suggest concise, descriptive filenames for documents. Output ONLY the filename (no extension, no path, no quotes, no explanation). Use Title Case. Keep it under 60 characters."`
- User: Receives the original filename and first ~2000 characters of content.

### 8. Transcript Cleanup Prompt

Reformats garbled raw text extraction (e.g., from `pdf-parse`) into clean markdown. Only triggered when heuristics detect the extracted text has formatting issues (high tab density or high whitespace ratio).

**Defined in:** [`core/app/ingest.ts`](../core/app/ingest.ts) — `cleanupTranscript()`

- System: `"You are a document formatting assistant. Reformat the raw extracted text into clean, well-structured Markdown. Preserve ALL content — do not summarize or omit anything. Fix spacing/tab issues, add proper heading hierarchy, format lists and tables correctly. Format math as LaTeX. Output ONLY the formatted markdown, no preamble."`
- User: Receives the document filename and raw extracted text (truncated to ~100k chars).

### 9. Conversation Compaction Prompt

Used by the `/compact` slash command to summarize the conversation history before truncating older messages.

**Defined in:** [`core/app/command-router.ts`](../core/app/command-router.ts) — `case "compact"`

- System: `"You are a helpful assistant that summarizes conversations concisely."`
- User: `"Summarize this tutoring conversation in 2-3 concise paragraphs. Focus on the topics discussed, key concepts, and where the student left off:"` followed by up to 8000 characters of conversation text.

The summary is then passed to `Conversation.compact()` which replaces all but the 4 most recent messages with a single summary message.

## Context Window Components

### 10. Tool Definitions

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

### 11. Conversation Messages

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

### 12. Conversation Turn Loop

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

### 13. Provider-Specific Prompt Handling

Each LLM provider receives the system prompt differently.

**Provider interface:** [`core/llm/provider.ts`](../core/llm/provider.ts)

| Provider | System prompt injection | File |
|----------|------------------------|------|
| Clark Cloud | Forwarded to upstream LLM via cloud proxy (handles provider-specific formatting server-side) | [`core/llm/cloud.ts`](../core/llm/cloud.ts) |
| Ollama | Prepended as system message | [`core/llm/ollama.ts`](../core/llm/ollama.ts) |

### 14. Context Window Visualization

The `/context` slash command renders a 10x10 grid showing token usage by category.

**Defined in:** [`cli/tui/context.ts`](../cli/tui/context.ts) — `formatContextGrid()`

Categories tracked:
- System prompt, Tool definitions, User messages, Assistant messages, Tool results, Thinking, Skills (reserved, currently 0), Free space

Context limits by model family:
| Model | Max tokens |
|-------|-----------|
| Clark Cloud (Claude) | 200,000 |
| Ollama | varies by model |
| Default | 128,000 |

## File Index

All files involved in prompt and context management:

| File | Role |
|------|------|
| [`core/prompts/system.md`](../core/prompts/system.md) | Base system prompt text |
| [`core/prompts/ingest.md`](../core/prompts/ingest.md) | Ingestion/linking prompt template |
| [`cli/bootstrap/system-prompt.ts`](../cli/bootstrap/system-prompt.ts) | Assembles system prompt from parts |
| [`core/library.ts`](../core/library.ts) | CLARK.md loading, structure templates, workspace scaffolding |
| [`core/mcp/tools.ts`](../core/mcp/tools.ts) | Tool definitions and handlers |
| [`core/app/ingest.ts`](../core/app/ingest.ts) | Ingestion pipeline, file naming, transcript cleanup prompts |
| [`core/ocr/provider.ts`](../core/ocr/provider.ts) | OCR transcription and consolidation prompts |
| [`core/app/command-router.ts`](../core/app/command-router.ts) | Conversation compaction prompt (`/compact`) |
| [`core/llm/messages.ts`](../core/llm/messages.ts) | Conversation state and message management |
| [`core/llm/provider.ts`](../core/llm/provider.ts) | Provider interface |
| [`core/llm/cloud.ts`](../core/llm/cloud.ts) | Clark Cloud provider (routes through Vercel proxy) |
| [`core/llm/ollama.ts`](../core/llm/ollama.ts) | Ollama provider |
| [`core/engine.ts`](../core/engine.ts) | Conversation turn loop and tool dispatch (UI-agnostic) |
| [`cli/tui/app.tsx`](../cli/tui/app.tsx) | TUI shell — wires engine callbacks to React state |
| [`cli/tui/context.ts`](../cli/tui/context.ts) | Context window visualization |

## Prompt Evaluation Framework

A repeatable eval system for testing how prompt changes affect Clark's behavior on known scenarios.

### Architecture

The eval uses **real LLM calls** (not mocks) because prompt evaluation needs to test how models *interpret* the prompt. A separate **LLM-as-judge** call grades each response against defined criteria.

**Files:**

| File | Role |
|------|------|
| [`eval/cases.ts`](../eval/cases.ts) | Type definitions (EvalCase, EvalCriterion, EvalResult) |
| [`eval/cases/basic-questions.ts`](../eval/cases/basic-questions.ts) | Factual question tests (Socratic vs direct) |
| [`eval/cases/ingestion.ts`](../eval/cases/ingestion.ts) | File organization tests |
| [`eval/cases/help.ts`](../eval/cases/help.ts) | Onboarding/capabilities tests |
| [`eval/cases/tool-use.ts`](../eval/cases/tool-use.ts) | Proactive tool use tests |
| [`eval/harness.ts`](../eval/harness.ts) | Core runner — scaffolds workspace, runs engine, judges |
| [`eval/judge.ts`](../eval/judge.ts) | LLM-as-judge logic |
| [`scripts/eval-prompts.ts`](../scripts/eval-prompts.ts) | CLI entry point |

### Running Evals

```bash
# Run all cases
bun eval

# Filter by category or case ID
bun eval --category basic-question
bun eval --case quadratic-formula

# Use different provider/model
bun eval --provider anthropic --model claude-sonnet-4-6

# A/B test a different system prompt
bun eval --prompt-file core/prompts/system-v2.md

# Machine-readable output
bun eval --json

# Verbose mode (shows tool calls, response snippets, judge reasoning)
bun eval --verbose
```

### Writing New Test Cases

Each eval case specifies:
1. **setup** — user message, optional editor file, optional workspace files to scaffold
2. **criteria** — each with a `judgingPrompt` sent to the judge LLM and a `weight` (0-1)

The harness creates a real temp workspace with the specified files, so tools like `search_notes` and `read_file` return real results. This tests whether the model actually calls tools and uses the results.

```ts
const myCase: EvalCase = {
  id: "my-test",
  name: "Description of what's being tested",
  category: "basic-question",
  setup: {
    userMessage: "The student's question",
    workspaceFiles: { "Notes/example.md": "# Content" },
  },
  criteria: [{
    id: "criterion-id",
    description: "Human-readable description",
    judgingPrompt: "Does the response ...?",
    weight: 1.0,
  }],
};
```
