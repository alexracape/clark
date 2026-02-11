# Clark — Socratic Tutoring Assistant

## Overview

Clark is a terminal-based Socratic tutoring assistant that helps students work through homework and problem sets. Instead of giving answers, Clark asks guiding questions — like a good TA would. Its key differentiator is seamless support for **handwritten work**: students write on an iPad via a shared tldraw canvas while Clark reads and responds to their progress from the TUI on their Mac.

## Design Principles

- **Socratic first.** Clark never solves problems. It asks questions, surfaces relevant context, and nudges the student toward understanding.
- **Handwriting is a first-class input.** Students shouldn't have to transcribe their work. Clark sees what they write.
- **Local and private.** All data stays on the student's machine. No cloud storage, no telemetry.
- **Hackable.** Simple architecture, few abstractions, easy to extend.

## Architecture

```
┌─────────────────┐         ┌─────────────────────────────────────────────┐
│   iPad (Safari)  │◄──WS──►│              Mac (Bun process)              │
│                  │         │                                             │
│  ┌─────────────┐ │         │  ┌──────────────┐    ┌──────────────────┐  │
│  │  tldraw app │ │         │  │ tldraw server│    │    TUI (Ink)     │  │
│  │  + agent    │ │         │  │ Bun.serve +  │    │    chat + input  │  │
│  │  context    │ │         │  │ TLSocketRoom │    │                  │  │
│  │  extraction │ │         │  └──────┬───────┘    └────────┬─────────┘  │
│  └─────────────┘ │         │         │                     │            │
└─────────────────┘         │         │    ┌─────────────┐  │            │
                             │         └───►│  MCP Server │◄─┘            │
                             │              │  (tools)    │               │
                             │              └─────────────┘               │
                             └─────────────────────────────────────────────┘
```

The main process (`index.ts`) starts three components in a single Bun process:

1. **tldraw server** — `Bun.serve()` hosts the tldraw app and manages sync via `TLSocketRoom` from `@tldraw/sync-core`. The iPad connects over LAN. The server owns the authoritative document state using `InMemorySyncStorage` with an `onChange` callback for auto-persistence.

2. **TUI** — The Ink-based chat interface the student uses on their Mac. Manages the conversation loop, sends messages to the LLM, and dispatches tool calls to the MCP server.

3. **MCP server** — Exposes tools to the LLM for reading files, searching notes, and interacting with the canvas. Canvas tools (snapshot, export) work by sending a WebSocket message to the iPad client, which performs the operation using tldraw's browser-based export APIs and returns the result.

### Why no CanvasManager?

tldraw provides `TLSocketRoom` + `InMemorySyncStorage` which already handle:
- Authoritative document state on the server
- WebSocket sync with the iPad client
- Snapshot serialization (via `storage.getSnapshot()`)
- Change notifications (via `onChange` callback)

There is no need for a custom state manager. The MCP server gets a reference to the `TLSocketRoom` instance for persistence operations, and communicates with the iPad client via WebSocket for rendering operations (since tldraw's image export requires the browser DOM).

### Data flow for canvas snapshots

Since tldraw's export APIs (`editor.toImage()`, `editor.getSvgString()`) require a browser DOM, snapshots are generated client-side:

```
LLM calls read_canvas tool
  → MCP server sends { type: "snapshot", page?: number } via WebSocket to iPad
  → iPad client calls editor.toImage() on the requested page
  → iPad sends PNG data back via WebSocket
  → MCP server returns the image to the LLM's vision API
```

This is the simplest approach and always works during active tutoring sessions (the iPad is connected by definition).

## Components

### 1. TUI Chat Interface

**Framework:** Ink (React for CLI)

**Behavior:**
- Single-session, single-thread conversation
- Student types messages; Clark responds with Socratic questions
- Supports slash commands for common actions, plus dynamic skill commands
- Tab completion and hint UI for slash commands (arrow keys to navigate, Tab to complete)
- Command history with up/down navigation (persisted to `~/.clark/history`)
- Shows a status indicator when Clark is thinking or reading the canvas

**Session lifecycle:**
- Student launches `clark` from the terminal
- On first run, an onboarding flow prompts for:
  1. LLM provider selection (Anthropic, OpenAI, Gemini, or Ollama)
  2. API key entry (skipped for Ollama)
  3. Library directory path (default: `~/Clark`) — existing vaults are detected; new paths are scaffolded with a standard directory structure
- Config is saved to `~/.clark/config.json`
- Session is ephemeral — conversation is not persisted across runs (v1)

**Slash commands (built-in):**
- `/help` — Show available commands (includes dynamic skill commands)
- `/canvas` — Open or show active canvas (shows canvas picker if none open)
- `/export [path]` — Export canvas pages as A4 PDF (default: `<canvasDir>/clark-export.pdf`)
- `/save` — Manually save canvas state to disk
- `/notes [path]` — Show or set notes vault directory
- `/model` — Switch model and provider (shows interactive picker)
- `/context` — Show context window usage breakdown
- `/compact` — Summarize conversation to reclaim context tokens
- `/clear` — Clear conversation history

**Dynamic skill commands (from Structures/):**
- At startup, Clark scans `<vault>/Structures/` for `.md` files
- Each Structure file becomes a slash command (e.g., `Class.md` → `/class`, `Problem Set.md` → `/problem_set`)
- When invoked, the Structure's content is appended to the system prompt for that conversation turn
- The LLM uses file tools to help the student create the structure, following the Socratic method
- Accepts optional arguments: `/class CS101` pre-fills context; bare `/class` lets the LLM ask
- One-shot: skill augmentation is cleared after the conversation turn completes

### 2. Library System

The library is a user-specified directory for notes, resources, and structures. It replaces the concept of a "vault" from earlier iterations.

**Directory structure:**
```
<library>/
├── Notes/                  # Markdown notes
├── Resources/
│   ├── Canvas/             # tldraw canvas files (.tldr)
│   ├── Images/             # Images, diagrams
│   ├── PDFs/               # PDF documents
│   └── Transcriptions/     # Markdown transcriptions of resources
├── Structures/             # Structure definitions (also serve as skills)
│   ├── Class.md
│   ├── Idea.md
│   ├── Paper.md
│   ├── Problem Set.md
│   ├── Quote.md
│   └── Resource.md
└── Templates/
    └── Paper Template.md
```

**Scaffolding:** New libraries are created via `scaffoldLibrary()` in `src/library.ts`, which writes the directory tree and all Structure/Template files. The same scaffolding runs during onboarding when a user chooses a new path.

**Structures:** Each Structure file contains `## Purpose`, `## Generation`, and optionally `## Template` sections. The Purpose describes what the structure is for; the Generation section contains LLM-oriented instructions for creating instances; the Template section provides the markdown template. These files double as skill definitions for dynamic slash commands.

### 3. Canvas System (tldraw)

#### tldraw Server

**Runtime:** `Bun.serve()` with WebSocket support

**Sync:** Uses `TLSocketRoom` from `@tldraw/sync-core` with `InMemorySyncStorage`.

```ts
import { TLSocketRoom, InMemorySyncStorage } from '@tldraw/sync-core'

const storage = new InMemorySyncStorage({
  snapshot: existingData, // load from disk if resuming
  onChange() {
    // debounced auto-save
    debouncedSave(storage.getSnapshot())
  },
})
const room = new TLSocketRoom({ storage })
```

**Behavior:**
- Serves the tldraw React app as a static HTML page (bundled by Bun's HTML import system)
- Canvas is lazy — the server only starts when the user opens a canvas via `/canvas`
- Canvas runs in the iPad's browser at a LAN address (e.g., `http://192.168.1.x:3000`)
- The iPad client connects using `useSync({ uri: 'ws://...' })` from `@tldraw/sync`
- `TLSocketRoom` handles sync, conflict resolution, and reconnection automatically
- Custom WebSocket messages use a separate `/ws` endpoint (not interleaved with sync protocol on `/sync`)

**Custom WebSocket messages** (on `/ws` endpoint):
- `{ type: "snapshot-request", page?: string }` — Server → iPad: request a page screenshot
- `{ type: "snapshot-response", page: string, png: base64 }` — iPad → Server: screenshot result
- `{ type: "export-request" }` — Server → iPad: request all pages as images for PDF
- `{ type: "export-response", pages: Array<{ name: string, png: base64 }> }` — iPad → Server: all page images

#### Canvas Picker

When the user types `/canvas`, a picker UI shows existing `.tldr` files from `<vault>/Resources/Canvas/` and allows creating new canvases by typing a name. The canvas server starts on the configured port (default 3000).

#### Page-Based UI

The canvas is configured as a **page-based notebook**, not an infinite canvas. This maps directly to homework submissions.

**tldraw page support:**
- tldraw natively supports multiple pages per document (up to 40 by default, configurable via `maxPages`)
- Each page has its own shapes, camera position, and selection state
- The built-in `NavigationPanel` provides page navigation, zoom controls, and minimap

**A4 page setup (single-page, multi-frame):**
- All "pages" are A4 frame shapes stacked vertically on a single tldraw page (`maxPages: 1` disables page tabs)
- Each frame is 595.28 x 841.89 points with a 60-point gap between frames
- Frames are undeletable (`registerBeforeDeleteHandler` returns `false`) and their position/size is locked via `registerBeforeChangeHandler`
- Camera is unconstrained — users can freely scroll and zoom; `zoomToFit()` on mount
- When a user draws on the last (empty) frame, a new empty frame is auto-created below
- On export, each frame is exported individually with `bounds` clipped to the frame

#### Visual Context Extraction (inspired by tldraw Agent SDK)

The tldraw Agent SDK defines a pattern for giving AI models rich context about canvas state. Clark adopts this approach for the iPad client:

**Three levels of shape representation** (from the Agent SDK):
1. **BlurryShape** — Lightweight summary of shapes in the viewport: bounds, ID, type, text content. Cheap to include in every LLM call as structured context.
2. **SimpleShape** — Full properties for selected/focused shapes. Used when the LLM needs detailed information about specific content.
3. **PeripheralShapeCluster** — Grouped counts of shapes outside the viewport. Gives the LLM awareness of off-screen content without sending full data.

#### Persistence

- Canvas state is stored as `.tldr` files in `<vault>/Resources/Canvas/`
- `InMemorySyncStorage.onChange()` fires on every canvas change
- Changes are debounced and the full document snapshot is serialized to disk
- The `/save` command triggers an immediate save

#### PDF Export

- The `/export` command (or `export_pdf` MCP tool) sends an `export-request` to the iPad client
- The iPad client iterates through all pages, calling `editor.toImage()` on each with the frame bounds and print resolution (300 DPI)
- Page images are sent back to the server via WebSocket
- The server composes them into a multi-page A4 PDF using `pdf-lib`
- PDF is written to disk (default: `<canvasDir>/clark-export.pdf`)

### 4. MCP Server (Context + Canvas Tools)

**Protocol:** Model Context Protocol (MCP) over stdio

**Resources:**
- `notes://` — Access to the configured notes vault (any folder of markdown/PDF/image files)

**Tools exposed to the LLM:**

| Tool | Description | Annotations |
|------|-------------|-------------|
| `read_file` | Read a file from the vault (markdown with wikilink resolution, PDF text extraction, images as base64) | readOnly |
| `search_notes` | Keyword search across markdown/text files, ranked by match density | readOnly |
| `list_files` | List vault directory contents with optional extension filter | readOnly |
| `create_file` | Create a new file in the vault (fails if exists) | write |
| `edit_file` | Find-and-replace editing in vault files | write, destructive |
| `read_canvas` | Capture a PNG snapshot of a canvas page from the iPad client (via WebSocket) | readOnly |
| `export_pdf` | Export canvas pages as A4 PDF via `pdf-lib` | write |
| `save_canvas` | Persist current canvas state to disk | write, idempotent |

**Tool implementation:**
All file tools are vault-scoped — paths are resolved relative to the vault root, and path traversal outside the vault is rejected. The MCP server holds references to:
- A `CanvasBroker` instance (for `read_canvas` and `export_pdf` — sends requests to the iPad, awaits responses)
- An optional `saveCanvas` callback (for `save_canvas` — provided by `index.ts` when the canvas server is running)

This keeps the MCP server decoupled from tldraw internals. It doesn't import tldraw or know about shapes — it just sends messages and receives images.

**File format support:**
- **Markdown (.md):** Read as plain text. Wikilinks (`[[...]]` and `![[...]]`) are extracted and resolved to vault paths, appended as a link footer so the LLM can follow references.
- **PDF (.pdf):** Text extracted via `pdf-parse` for search and reading.
- **Images (.png, .jpg, .gif, etc.):** Returned as base64-encoded data for the LLM's vision API.

**Search (v1):** Keyword/substring search over file contents. Results ranked by relevance (match density).

**Standalone mode:** The MCP server can also run as a standalone stdio process (`src/mcp/standalone.ts`) for testing with the MCP Inspector or external clients.

### 5. LLM Layer

**Design:** Pluggable provider interface with a registry pattern

**Providers:**
- **Anthropic (Claude)** — Claude Sonnet via the Anthropic API. Vision support for canvas snapshots and PDF images. Default model: `claude-sonnet-4-5-20250929`.
- **OpenAI** — GPT-4o via the OpenAI API. Vision support for canvas snapshots. Default model: `gpt-4o`.
- **Google (Gemini)** — Gemini via the Google GenAI SDK. Default model: `gemini-2.5-flash`.
- **Ollama** — Local model support for privacy-first use. Auto-discovers available models, performs RAM preflight checks before loading. No API key required.

**Provider interface:**
```ts
interface LLMProvider {
  readonly name: string;
  readonly supportsVision: boolean;
  chat(
    messages: Message[],
    tools: Tool[],
    systemPrompt: string,
  ): AsyncIterable<StreamChunk>;
}
```

- All providers must support streaming responses
- All providers must support tool use (function calling)
- Vision capability is required for canvas reading — providers without vision skip the `read_canvas` tool
- System prompt is passed as a separate parameter (not as a message)

**Model picker:** The `/model` command shows an interactive picker with all configured providers and their models. Ollama dynamically lists locally available models. Selection is persisted to config for next launch.

**Conversation management:** The `Conversation` class (`src/llm/messages.ts`) manages message history with:
- Token estimation per role (for `/context` display)
- Compaction via LLM-generated summary (for `/compact`)
- Stream response collection (converting `StreamChunk[]` into `MessageContent[]`)

**Configuration:**
- Provider and model are set via onboarding, CLI flags, config file, or environment variables
- `CLARK_MODEL` environment variable overrides the saved model
- API keys via standard env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- Keys can also be saved during onboarding to `~/.clark/config.json` and are applied to the environment at startup

### 6. Socratic System Prompt

The system prompt is the sole guardrail mechanism. It instructs the LLM to:

- Never provide direct answers to homework problems
- Ask guiding questions that lead the student to discover the answer
- Reference the student's own notes and class materials when relevant
- Read the student's handwritten work and comment on their approach
- Identify misconceptions and address them with targeted questions
- Encourage the student and acknowledge progress
- Adapt question difficulty based on the student's responses

The system prompt is stored as a plain text file (`src/prompts/system.md`) so users can customize it. When a skill is active, the Structure file's content is appended to the system prompt for that conversation turn.

## Project Structure

```
clark/
├── CLAUDE.md                  # Bun conventions for AI assistants
├── SPEC.md                    # This file
├── TODO.md                    # Roadmap and pending tasks
├── package.json
├── tsconfig.json
├── index.ts                   # Entry point — onboarding, canvas server, TUI
│
├── docs/
│   └── dependencies/          # Vendored LLM-friendly docs for tldraw, MCP
│
├── src/
│   ├── config.ts              # Config persistence (~/.clark/config.json)
│   ├── library.ts             # Library scaffolding (directory structure + templates)
│   ├── skills.ts              # Dynamic skills from Structures/ (slug, load, prompt)
│   │
│   ├── tui/                   # Ink-based terminal UI
│   │   ├── app.tsx            # Root Ink component (conversation loop, tool dispatch)
│   │   ├── chat.tsx           # Chat message display
│   │   ├── input.tsx          # User input with slash command hints + tab completion
│   │   ├── status.tsx         # Status bar (model, canvas, thinking)
│   │   ├── onboarding.tsx     # First-run setup (provider, API key, library path)
│   │   ├── model-picker.tsx   # Interactive model/provider switcher
│   │   ├── canvas-picker.tsx  # Canvas file picker (open existing or create new)
│   │   ├── context.ts         # Context window usage display
│   │   └── history.ts         # Command history with persistence
│   │
│   ├── canvas/                # tldraw server + client app
│   │   ├── server.ts          # CanvasBroker + Bun.serve for WebSocket messaging
│   │   ├── index.ts           # Canvas module exports (CanvasBroker, startCanvasServer, listCanvasFiles)
│   │   ├── index.html         # Entry HTML served to iPad (tldraw app)
│   │   ├── app.tsx            # tldraw React app for iPad
│   │   ├── pdf-export.ts      # Compose page PNGs into A4 PDF (uses pdf-lib)
│   │   └── context.ts         # BlurryShape/SimpleShape types for visual context
│   │
│   ├── mcp/                   # MCP server
│   │   ├── server.ts          # MCP protocol handler
│   │   ├── tools.ts           # Tool definitions + handlers (file tools, canvas tools)
│   │   ├── vault.ts           # Wikilink resolution and vault path utilities
│   │   ├── standalone.ts      # Standalone stdio entry point for testing/inspector
│   │   ├── pdf.ts             # PDF text extraction (for reading vault PDFs)
│   │   └── index.ts           # MCP module exports
│   │
│   ├── llm/                   # LLM provider abstraction
│   │   ├── provider.ts        # Provider interface, types, registry
│   │   ├── anthropic.ts       # Claude implementation
│   │   ├── openai.ts          # OpenAI implementation
│   │   ├── gemini.ts          # Google Gemini implementation
│   │   ├── ollama.ts          # Ollama local model implementation
│   │   ├── mock.ts            # Mock provider for tests
│   │   ├── messages.ts        # Conversation class (history, tokens, compaction)
│   │   └── index.ts           # LLM module exports
│   │
│   └── prompts/
│       └── system.md          # Socratic system prompt
│
├── test/                      # Tests (bun test)
│   ├── mcp.test.ts            # MCP tool unit tests
│   ├── mcp-integration.test.ts # MCP server integration tests (stdio)
│   ├── conversation.test.ts   # Conversation/message management tests
│   ├── tui.test.tsx           # TUI component tests (App, StatusBar, Chat)
│   ├── input.test.ts          # Input parsing, command filtering, history tests
│   ├── config.test.ts         # Config persistence tests
│   ├── llm.test.ts            # LLM provider tests
│   ├── canvas.test.ts         # Canvas server/broker tests
│   ├── library.test.ts        # Library scaffolding tests
│   └── skills.test.ts         # Skills loading and prompt building tests
│
└── test/test_vault/           # Sample library for tests
    ├── Notes/                  # Markdown notes with wikilinks
    ├── Resources/
    │   ├── Canvas/             # Canvas files
    │   ├── Images/             # Test images
    │   ├── PDFs/               # PDF documents
    │   └── Transcriptions/     # Document transcriptions
    ├── Structures/             # Structure definitions (skill files)
    └── Templates/              # Note templates
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `ink` | React-based TUI framework |
| `react` | Required by Ink and tldraw |
| `tldraw` | Canvas drawing UI (runs on iPad) |
| `@tldraw/sync` | Client-side sync hook (`useSync`) |
| `@tldraw/sync-core` | Server-side sync (`TLSocketRoom`, `InMemorySyncStorage`) |
| `@modelcontextprotocol/sdk` | MCP server implementation |
| `@anthropic-ai/sdk` | Claude API client |
| `openai` | OpenAI API client |
| `@google/genai` | Google Gemini API client |
| `pdf-parse` | PDF text extraction (reading vault PDFs) |
| `pdf-lib` | PDF generation (exporting canvas pages to A4 PDF) |
| `yargs` | CLI argument parsing |

Dev dependencies: `@types/bun`, `@types/react`, `@types/pdf-parse`, `@types/yargs`, `ink-testing-library`, `typescript`

## Configuration

Clark uses environment variables, CLI flags, and a persistent config file at `~/.clark/config.json`. On first run, an onboarding flow prompts for provider, API key, and library path, saving them to the config file. Environment variables take precedence over saved config.

```bash
# API keys can be set via env or saved during onboarding
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=AI...

# Run clark with a notes library
clark --notes ~/Clark

# Or with explicit provider
clark --provider anthropic --model claude-sonnet-4-5-20250929
```

**CLI flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--notes <path>` | `~/Clark` (from onboarding) | Path to notes library directory |
| `--provider` | `anthropic` | LLM provider (`anthropic`, `openai`, `gemini`, `ollama`) |
| `--model` | provider default | Specific model ID |
| `--port` | `3000` | Port for tldraw canvas server |

**Config file (`~/.clark/config.json`):**
```ts
interface ClarkConfig {
  provider?: string;
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  ollamaBaseUrl?: string;
  resourcePath?: string;  // Library directory path
  canvasPath?: string;
}
```

## Non-Goals (v1)

- **Session persistence / conversation history** — Sessions are ephemeral. Persistence is planned for a future version.
- **Multi-session support** — One tutoring session at a time.
- **Vector search / RAG** — Keyword search only in v1.
- **Instructor dashboard or analytics** — Student-facing tool only.
- **Mobile-native app** — iPad accesses tldraw via Safari.

## Open Questions

1. **tldraw canvas export fidelity** — Need to validate that `editor.toImage()` at `pixelRatio: 2` captures Apple Pencil strokes at sufficient resolution for vision API OCR. May need to experiment with scale factor.
2. **PDF rendering for vision** — For PDFs with diagrams/equations, should we send page images to the vision API, or is text extraction sufficient? Likely need both paths depending on content type.
3. **A4 frame enforcement** — Camera constraints with `behavior: 'contain'` prevent panning away from the frame, but students can still draw outside it. On export, we clip to frame bounds via the `bounds` option in `editor.toImage()`. Verify this produces clean results.
4. **BlurryShape extraction cost** — Evaluate whether including structured shape data alongside PNG snapshots meaningfully improves LLM comprehension of handwritten content, or if vision alone is sufficient. If vision alone works well, skip the shape extraction for simplicity.
