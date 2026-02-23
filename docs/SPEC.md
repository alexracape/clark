# Clark — Socratic Tutoring Assistant

**Documentation:** [alex.racape.com/clark](https://alex.racape.com/clark)

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
- Supports slash commands for common actions
- Tab completion and hint UI for slash commands (arrow keys to navigate, Tab to complete)
- File ingestion via drag-and-drop or pasted paths — files are copied to Resources/ and transcribed
- Command history with up/down navigation (persisted to `~/.clark/history`)
- Shows a status indicator when Clark is thinking or reading the canvas

**Session lifecycle:**
- Student launches `clark` from the terminal
- On first run, an onboarding flow prompts for:
  1. LLM provider selection (Anthropic, OpenAI, Gemini, or Ollama)
  2. API key entry (skipped for Ollama)
- Clark scaffolds the current working directory on startup:
  - Always creates `Clark/`, `Clark/Canvas/`, `Clark/Structures/`, and `Clark/CLARK.md`
  - If the working directory is empty, also creates default top-level folders (`Notes`, `Resources`, `Templates`)
- Config is saved to `~/.clark/config.json`
- Session is ephemeral — conversation is not persisted across runs (v1)

**Slash commands (built-in):**
- `/help` — Show available commands
- `/tutorial` — Interactive tutorial for first-time users
- `/canvas` — Open or show active canvas (shows canvas picker if none open)
- `/export [path]` — Export canvas pages as A4 PDF (default: `<pdfExportDir>/<canvasName>.pdf`, fallback `./<canvasName>.pdf`). Supports tab-completion for directory paths.
- `/model` — Switch model and provider (shows interactive picker with API key entry for unconfigured providers)
- `/context` — Show context window usage breakdown (10x10 color-coded grid with per-category token estimates)
- `/compact` — Summarize conversation to reclaim context tokens
- `/feedback <message>` — Send feedback to the developer via Discord webhook (includes system context: Clark version, platform, Bun version, LLM provider)
- `/clear` — Clear conversation history
- `/exit` or `/quit` — Exit Clark (same as Ctrl+C)

**Structures (via NLU):**
- Structure definitions live in `Clark/Structures/` as `.md` files (user-editable)
- At startup, `loadEffectiveSystemPrompt()` scans Structures/ and appends a summary (name + purpose) to the system prompt
- The LLM discovers structures from the system prompt and uses `read_file`/`create_file` tools naturally when a student asks to create one (e.g., "create a new class for CS101")
- No dedicated slash commands — the model handles structure creation conversationally

**File ingestion (agentic):**
- When the student drags a file into the terminal or pastes a file path, the TUI detects it as a path (via `detectFilePath()`) before checking for slash commands
- The file is copied to the appropriate `Resources/` subfolder (PDFs → `Resources/PDFs/`, images → `Resources/Images/`)
- A message is injected into the conversation telling the model about the new file
- The model then drives processing using MCP tools: `read_file` to inspect content, `transcribe_pdf` to OCR scanned PDFs, `create_file` to save transcripts
- The model decides where to place transcripts based on vault structure and CLARK.md conventions
- For scanned/handwritten PDFs, `transcribe_pdf` renders pages to images via poppler (`pdftoppm`) and OCRs each page using a pluggable vision API

### 2. Workspace System

Clark assumes the current working directory is the student's workspace root.

**Directory structure:**
```
<workspace>/
├── Notes/                  # Markdown notes
├── Resources/
│   ├── Images/             # Images, diagrams
│   ├── PDFs/               # PDF documents
│   └── Transcripts/     # Markdown transcripts of resources
└── Templates/
    └── Paper Template.md

<workspace>/Clark/
├── CLARK.md                # Optional local config/context injected into system prompt
├── Canvas/                 # tldraw canvas files (.tldr)
└── Structures/             # Structure definitions (also serve as skills)
    ├── Class.md
    ├── Idea.md
    ├── Paper.md
    ├── Problem Set.md
    ├── Quote.md
    └── Resource.md
```

**Scaffolding:** `scaffoldLibrary()` in `src/library.ts` always creates the Clark core directories/files. It only creates top-level defaults when the workspace starts empty.

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

When the user types `/canvas`, a picker UI shows existing `.tldr` files from `<workspace>/Clark/Canvas/` and allows creating new canvases by typing a name. The canvas server starts on the configured port (default 3000).

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

- Canvas state is stored as `.tldr` files in `<workspace>/Clark/Canvas/`
- `InMemorySyncStorage.onChange()` fires on every canvas change
- Changes are debounced and the full document snapshot is serialized to disk

#### PDF Export

- The `/export` command (or `export_pdf` MCP tool) sends an `export-request` to the iPad client
- The iPad client iterates through all pages, calling `editor.toImage()` on each with the frame bounds and print resolution (300 DPI)
- Page images are sent back to the server via WebSocket
- The server composes them into a multi-page A4 PDF using `pdf-lib`
- PDF is written to disk (default export dir is `pdfExportDir` from config, else working directory)

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
| `transcribe_pdf` | OCR scanned/handwritten PDFs: renders pages via poppler, transcribes via vision API, saves markdown transcript | write |
| `web_search` | Search the web for current information and recent data | readOnly |

**Tool implementation:**
All file tools are vault-scoped — paths are resolved relative to the vault root, and path traversal outside the vault is rejected. The MCP server holds references to:
- A `CanvasBroker` instance (for `read_canvas` and `export_pdf` — sends requests to the iPad, awaits responses)
- An optional `saveCanvas` callback (for `save_canvas` — provided by `index.ts` when the canvas server is running)
- An optional `OCRProvider` (for `transcribe_pdf` — default uses LLM vision API, pluggable for dedicated OCR models)

This keeps the MCP server decoupled from tldraw internals. It doesn't import tldraw or know about shapes — it just sends messages and receives images.

**File format support:**
- **Markdown (.md):** Read as plain text. Wikilinks (`[[...]]` and `![[...]]`) are extracted and resolved to vault paths, appended as a link footer so the LLM can follow references.
- **PDF (.pdf):** Text extracted via `pdf-parse` for search and reading. `read_file` hints when a PDF has sparse text (likely scanned). `transcribe_pdf` provides full OCR via poppler + vision API.
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

If a `CLARK.md` file exists in the workspace's `Clark/` directory, its contents are appended to the system prompt on startup (separated by `---`). This gives students a per-workspace customization point (e.g., "I'm taking CS229 — focus on machine learning concepts").

## Project Structure

```
clark/
├── CLAUDE.md                  # Bun conventions for AI assistants
├── package.json
├── tsconfig.json
├── index.ts                   # Entry point — onboarding, canvas server, TUI
│
├── install.sh                 # Curl-based installer (platform detection + checksum)
│
├── scripts/
│   └── build.ts               # Cross-platform binary compilation via bun build --compile
│
├── .github/
│   └── workflows/
│       └── release.yml        # Build + publish binaries on git tag push
│
├── docs/
│   ├── SPEC.md                # This file
│   ├── TODO.md                # Roadmap and pending tasks
│   ├── design/                # Brand identity, color palette, UI patterns
│   ├── site/                  # Landing page and getting-started HTML
│   └── dependencies/          # Vendored LLM-friendly docs for tldraw, MCP
│
├── src/
│   ├── config.ts              # Config persistence (~/.clark/config.json)
│   ├── library.ts             # Library scaffolding (directory structure + templates)
│   │
│   ├── app/                   # Application-layer orchestration
│   │   ├── canvas-session.ts  # CanvasSessionManager (one active canvas at a time)
│   │   ├── command-router.ts  # Slash command dispatch and /export path resolution
│   │   └── ingest.ts          # File ingestion (path detection, copy, transcription)
│   │
│   ├── bootstrap/             # Startup and initialization
│   │   ├── args.ts            # CLI argument parsing (yargs)
│   │   ├── provider.ts        # Provider/model resolution with Ollama preflight
│   │   ├── start-app.ts       # Wire everything together and render the TUI
│   │   └── system-prompt.ts   # Load system.md + CLARK.md context
│   │
│   ├── tui/                   # Ink-based terminal UI
│   │   ├── app.tsx            # Root Ink component (conversation loop, tool dispatch)
│   │   ├── chat.tsx           # Chat message display
│   │   ├── input.tsx          # User input with slash command hints + tab completion
│   │   ├── status.tsx         # Status bar (model, canvas, thinking)
│   │   ├── onboarding.tsx     # First-run setup (provider, API key)
│   │   ├── model-picker.tsx   # Interactive model/provider switcher
│   │   ├── canvas-picker.tsx  # Canvas file picker (open existing or create new)
│   │   ├── context.ts         # Context window usage display
│   │   ├── history.ts         # Command history with persistence
│   │   └── primitives/        # Reusable UI hooks
│   │       ├── use-line-editor.ts    # Single-line text input state
│   │       └── use-selectable-list.ts # Up/down list selection state
│   │
│   ├── canvas/                # tldraw server + client app
│   │   ├── server.ts          # CanvasBroker + Bun.serve for WebSocket messaging
│   │   ├── index.ts           # Canvas module exports
│   │   ├── index.html         # Entry HTML served to iPad (tldraw app)
│   │   ├── app.tsx            # tldraw React app for iPad (frames, export handlers)
│   │   ├── page-autocreate.ts # Logic for auto-creating trailing empty frames
│   │   ├── pdf-export.ts      # Compose page PNGs into A4 PDF (uses pdf-lib)
│   │   └── context.ts         # BlurryShape/SimpleShape types for visual context
│   │
│   ├── mcp/                   # MCP server
│   │   ├── server.ts          # MCP protocol handler (zod schema bridge)
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
│   │   └── index.ts           # LLM module exports (+ side-effect provider registration)
│   │
│   ├── ocr/                    # OCR pipeline (pluggable provider + PDF rendering)
│   │   ├── provider.ts         # OCRProvider interface + VisionOCRProvider (LLM vision)
│   │   ├── pdf-renderer.ts     # PDF-to-image rendering via poppler (pdftoppm)
│   │   └── index.ts            # OCR module exports
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
│   ├── canvas-page-autocreate.test.ts # Frame auto-creation logic tests
│   ├── command-router.test.ts # Slash command dispatch tests
│   ├── ingest.test.ts         # File ingestion tests
│   └── library.test.ts        # Library scaffolding tests
│
└── test/test_vault/           # Sample library for tests
    ├── Notes/                  # Markdown notes with wikilinks
    ├── Clark/
    │   ├── CLARK.md
    │   ├── Canvas/             # Canvas files
    │   └── Structures/         # Structure definitions (skill files)
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

Clark uses environment variables, CLI flags, and a persistent config file at `~/.clark/config.json`. On first run, onboarding prompts for provider and API key, then scaffolds the current working directory. Environment variables take precedence over saved config.

```bash
# API keys can be set via env or saved during onboarding
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=AI...

# Run clark from your workspace directory
cd ~/Clark
clark

# Or with explicit provider/model
clark --provider anthropic --model claude-sonnet-4-5-20250929
```

**CLI flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--provider` | `anthropic` | LLM provider (`anthropic`, `openai`, `gemini`, `ollama`) |
| `--model` | provider default | Specific model ID |
| `--port` | `3000` | Port for tldraw canvas server |
| `--upgrade` (alias: `--update`) | `false` | Self-update Clark to the latest GitHub release |
| `--version` (or `-v`) | - | Print version and exit |

**Config file (`~/.clark/config.json`):**
```ts
interface ClarkConfig {
  provider?: string;
  model?: string;
  ollamaBaseUrl?: string;
  pdfExportDir?: string;  // Default PDF export directory
  secretStoreBackend?: "macos-keychain" | "linux-libsecret" | "windows-credential" | "fallback";
  hasCompletedOnboarding?: boolean;  // Tracks first-run completion
  tutorialProgress?: {
    completed: boolean;
    currentStep?: number;
    lastCompletedAt?: string;
  };
  maxToolCallsPerTurn?: number;
  maxTokens?: number;
}
```

**Note**: API keys are stored via environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`) or OS-native secret stores:
- **macOS**: Keychain (via `security` CLI)
- **Linux**: libsecret (via `secret-tool` CLI)
- **Windows**: Credential Manager (via `cmdkey` CLI)
- **Fallback**: Environment variables only (when native backend unavailable)

## Feedback System

Clark includes a built-in feedback mechanism via the `/feedback` command. When users submit feedback:

1. A Discord webhook receives the message with context (Clark version, platform, architecture, Bun version, LLM provider)
2. The webhook URL is hardcoded in the application for zero-configuration user experience
3. No user data or conversation content is transmitted - only the explicit feedback message and system metadata
4. Network failures gracefully degrade with a suggestion to use GitHub Issues as a fallback

This approach provides immediate user feedback collection without requiring external services, authentication, or configuration. The webhook URL can be regenerated if needed without code changes by updating the constant in `src/app/command-router.ts`.

## Distribution

Clark is distributed as a standalone compiled binary via GitHub Releases.

**Build:** `bun run build` runs `scripts/build.ts`, which:
- Compiles `index.ts` into a single executable via `bun build --compile`
- Inlines the version at compile time (`--define CLARK_VERSION`)
- Generates SHA-256 checksums for each binary
- Supports cross-compilation: `--target darwin-arm64`, `--target darwin-x64`, `--target linux-arm64`, `--target linux-x64`, `--all`

**Supported platforms:** macOS (arm64, x64), Linux (arm64, x64)

**Release workflow:** Pushing a git tag (`v*`) triggers `.github/workflows/release.yml`, which:
1. Builds binaries on GitHub Actions runners for each platform
2. Creates a GitHub Release with generated release notes and all binaries + checksums

**Installation:**
```bash
curl -fsSL https://raw.githubusercontent.com/alexracape/clark/main/install.sh | bash
```

The install script detects the user's platform, downloads the correct binary, verifies the SHA-256 checksum, and installs to `/usr/local/bin/clark` (or a custom `INSTALL_DIR`).
