# Clark — Socratic Tutoring Assistant

**Documentation:** [alex.racape.com/clark](https://alex.racape.com/clark)

## Overview

Clark is a Socratic tutoring assistant for students. Instead of giving direct answers, Clark asks guiding questions — like a good TA would. Its key differentiator is treating handwritten work as a first-class input: students write on an iPad via a shared tldraw canvas while Clark reads and responds from the desktop app on their Mac.

## Design Principles

- **Socratic first.** Clark never solves problems. It asks questions, surfaces relevant context, and nudges the student toward understanding.
- **Handwriting is a first-class input.** Students shouldn't have to transcribe their work. Clark sees what they write.
- **Zero-config onboarding.** No API keys, no provider selection. Clark Cloud handles LLM access out of the box.
- **Hackable.** Simple architecture, few abstractions, easy to extend.

---

## Architecture

Clark is a Tauri desktop app (macOS) with three main layers:

```
┌──────────────────────────────────────────────────────────┐
│  Tauri Desktop App (macOS)                               │
│                                                          │
│  ┌────────────────────┐   ┌──────────────────────────┐  │
│  │  React Frontend    │   │  Rust Tauri Backend       │  │
│  │  (gui/src/)        │◄──│  (tauri/src/)             │  │
│  └─────────┬──────────┘   └────────────┬─────────────┘  │
│            │ IPC                        │ spawn           │
│            ▼                            ▼                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Bun Sidecar (gui/sidecar.ts)                       │ │
│  │  Bun.serve() HTTP + ConversationEngine              │ │
│  │  Routes: /api/chat, /api/settings, /api/files, ...  │ │
│  └────────────────────────┬────────────────────────────┘ │
└───────────────────────────┼──────────────────────────────┘
                            │
          ┌─────────────────┴──────────────────┐
          │                                    │
          ▼                                    ▼
┌──────────────────────┐          ┌────────────────────────┐
│  Clark Cloud         │          │  iPad (Safari)          │
│  (Vercel serverless) │          │                         │
│                      │          │  tldraw canvas app      │
│  /api/chat (LLMs)    │          │  draws + sends          │
│  /api/embed          │          │  PNG snapshots          │
│  /api/ocr (Mistral)  │          │  via WebSocket          │
│  /api/auth           │          │                         │
└──────────────────────┘          └────────────────────────┘
```

**Data flow for a conversation turn:**
1. Student types in the GUI Composer
2. React calls `invokeCommand` → Tauri IPC → Rust → HTTP to Bun sidecar
3. Sidecar runs `ConversationEngine.runTurn()`, which streams from `CloudLLMProvider`
4. `CloudLLMProvider` sends a POST to Clark Cloud (`/api/chat`) which calls the upstream LLM and streams SSE back in Clark's `StreamChunk` format
5. If the LLM calls a tool (e.g., `read_canvas`), `ConversationEngine` dispatches to the MCP tool handler
6. `read_canvas` sends a WebSocket message to the iPad, which calls `editor.toImage()` and returns the PNG
7. The PNG is passed to the LLM as a vision image; the model continues
8. Streaming events are broadcast from the sidecar → Tauri relay → `sidecar:event` in React → `applyStreamEvent` reducer updates UI

---

## Clark Cloud

Clark Cloud is a Vercel serverless proxy service that lets users get started without any API keys or provider setup. All API credentials are managed server-side.

**Deployed endpoints (`cloud/api/`):**

| Endpoint | Purpose | Rate limit |
|----------|---------|------------|
| `/api/chat` | LLM proxy (Anthropic / OpenAI / Google via Vercel AI SDK) | 30 req/60s |
| `/api/embed` | Embeddings via OpenAI `text-embedding-3-small` | 20 req/60s |
| `/api/ocr` | OCR via Mistral OCR API (base64 PDF or image) | 10 req/60s |
| `/api/feedback` | Relays feedback to Discord webhook | — |
| `/api/telemetry` | Lightweight anonymous usage telemetry | — |
| `/api/auth/status` | Returns the client's auth tier | — |

**Auth:** Each client generates a UUID on first run stored in `~/.clark/config.json` as `clientId`. All requests include `X-Clark-Client-Id`. There is no sign-in — the client ID is the identity.

**Rate limiting:** Uses Upstash Redis sliding window rate limiting. Keys are `rl:<clientId>`. No IPs are stored.

**Stack:** `cloud/lib/auth.ts` + `cloud/lib/rate-limit.ts` + `cloud/lib/redis.ts`. Deployed via `cloud/vercel.json`.

---

## GUI (Tauri Desktop App)

The desktop app is the primary way to use Clark. It provides a full chat interface, settings panel, file browser, canvas integration, and onboarding flow.

### React Frontend (`gui/src/`)

**`App.tsx`** — Root component. On mount: checks onboarding status, subscribes to `sidecar:event` for streaming updates. Renders the Titlebar, Sidebar, ChatWindow or MarkdownEditor, Composer, and all modals (ModelPicker, CanvasPicker, ContextPanel, Settings, SessionPicker, Tutorial, Onboarding).

**`app-controller.ts`** — Pure reducer pattern for all app state. `AppState` tracks chat messages, streaming state, active tool calls, modal visibility, canvas status, ingestion toasts, and onboarding progress. Key functions:
- `applyStreamEvent` — processes SSE chunks from the sidecar
- `planSendInput` — handles message submission
- `planFileDrop` — handles drag-and-drop file ingestion
- `applySlashCommandResult` — maps slash command results (e.g., `uiAction: "settings"`) to state transitions

**`ipc.ts`** — IPC bridge:
- **Tauri mode:** `invokeCommand(name, args)` → `tauriInvoke` → Rust `commands.rs` → HTTP to sidecar
- **Browser/dev mode:** maps command names directly to `{ method, path }` and calls sidecar HTTP

**Components:**

| Component | Description |
|-----------|-------------|
| `Composer.tsx` | Message input with Tiptap-based slash command autocomplete |
| `ChatWindow.tsx` | Chat message list with streaming support |
| `MessageBubble.tsx` | Individual message rendering (text, tool calls, images) |
| `ToolCard.tsx` | Tool call/result display |
| `Sidebar.tsx` | Left panel file browser |
| `Settings.tsx` | Settings modal (workspace, file routing, embedding, PDF export) |
| `Onboarding.tsx` | First-run flow (Welcome → workspace setup) |
| `ModelPicker.tsx` | Provider/model selection modal |
| `CanvasPicker.tsx` | Canvas file selection modal |
| `ContextPanel.tsx` | Context window usage visualization |
| `SessionPicker.tsx` | Restore a past session |
| `MarkdownEditor.tsx` | In-app markdown file editor |

### Tauri Backend (`tauri/src/`)

The Rust backend wraps the React frontend and manages the Bun sidecar subprocess.

- `lib.rs` — Tauri app setup, sidecar spawn, IPC invoke handler registration
- `commands.rs` — IPC command handlers; each proxies to sidecar HTTP
- `sidecar.rs` — Sidecar process lifecycle (spawn, port discovery)
- `stream.rs` — Forwards SSE events from the sidecar to Tauri frontend events

### Bun Sidecar (`gui/sidecar.ts`)

The sidecar is a `Bun.serve()` HTTP server that holds all runtime state and runs the `ConversationEngine`. It is spawned as a subprocess by the Tauri Rust backend.

**Module-level state:**

| Variable | Description |
|----------|-------------|
| `config` | `ClarkConfig` loaded from `~/.clark/config.json` |
| `workspaceDir` | Active workspace root |
| `provider` | Active `LLMProvider` instance |
| `conversation` | `Conversation` message history |
| `engine` | `ConversationEngine` |
| `tools` | MCP tool definitions |
| `embeddingProvider` | `CloudEmbeddingProvider` or `OllamaEmbeddingProvider` |
| `searchIndex` | `EmbeddingIndex` (SQLite) |
| `sessionManager` | Session persistence handler |

**Key API endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Run a conversation turn; streaming via WebSocket broadcast |
| `/api/command` | POST | Dispatch a slash command |
| `/api/ingest` | POST | Copy file to workspace + run ingestion pipeline |
| `/api/status` | GET | Current provider and model |
| `/api/files` | GET | List workspace files (optional `?path=`) |
| `/api/canvases` | GET | List `.tldr` canvas files |
| `/api/canvas/open` | POST | Open a canvas by name |
| `/api/context` | GET | Context window usage breakdown |
| `/api/settings` | GET/POST | Read/write config; reinitializes affected subsystems |
| `/api/onboarding-status` | GET | Whether onboarding has been completed |
| `/api/complete-onboarding` | POST | Finalize onboarding |

### Settings Panel

The Settings modal (`Settings.tsx`) provides a GUI for:

- **Workspace** — workspace root directory (OS native folder picker in Tauri)
- **File Routing** — relative paths for dropped PDFs, images, and other files
- **Semantic Search** — embedding provider (Off / Clark Cloud / Ollama) and model
- **PDF Export** — default export directory

The modal tracks dirty state via JSON comparison and only enables Save when there are changes. `POST /api/settings` triggers subsystem reinitialization (e.g., rebuilds `embeddingProvider`, `searchIndex`, and MCP tool list when embedding config changes).

---

## Workspace System

Clark treats the configured path in settings as the workspace root.

**Directory structure:**
```
<workspace>/
├── Notes/                  # Markdown notes
├── Resources/
│   ├── Images/             # Images, diagrams
│   ├── PDFs/               # PDF documents
│   └── Transcripts/        # Markdown transcripts of resources
└── Templates/

<workspace>/Clark/
├── CLARK.md                # Per-workspace context injected into system prompt
├── Canvas/                 # tldraw canvas files (.tldr)
|-- Sessions/               # old conversations that can be resumed (.md)
└── Structures/             # Structure definitions (skill files)
    ├── Class.md
    ├── Idea.md
    ├── Paper.md
    ├── Problem Set.md
    ├── Quote.md
    └── Resource.md
```

**Scaffolding:** `scaffoldLibrary()` in `core/library.ts` always creates the `Clark/` core directories. It only creates top-level defaults (`Notes/`, `Resources/`, `Templates/`) when the workspace starts empty.

**Structures:** Each Structure file contains `## Purpose`, `## Generation`, and optionally `## Template` sections. The LLM discovers structures from the system prompt and uses `read_file`/`create_file` tools when a student asks to create one conversationally.

**CLARK.md:** If this file exists in `<workspace>/Clark/`, its contents are appended to the system prompt on startup. This gives students a per-workspace customization point (e.g., "I'm taking CS229 — focus on machine learning concepts").

**File ingestion:** When a student drags a file into the Composer (or pastes a path in the TUI), it is:
1. Copied to the appropriate `Resources/` subfolder based on file routing config
2. A message is injected into the conversation about the new file
3. The LLM drives processing using MCP tools: `read_file`, `transcribe_pdf`, `create_file`
4. For scanned/handwritten PDFs, `transcribe_pdf` OCRs each page via the configured OCR provider

---

## Canvas System (tldraw)

### Overview

The canvas system lets students write or draw on an iPad while Clark reads their work. The canvas server starts lazily when the student opens a canvas.

### tldraw Server (`core/canvas/server.ts`)

**Runtime:** `Bun.serve()` with WebSocket support

**Sync:** Uses `TLSocketRoom` from `@tldraw/sync-core` with `InMemorySyncStorage`.

```ts
const storage = new InMemorySyncStorage({
  snapshot: existingData,
  onChange() {
    debouncedSave(storage.getSnapshot())
  },
})
const room = new TLSocketRoom({ storage })
```

- Canvas state is stored as `.tldr` files in `<workspace>/Clark/Canvas/`
- The tldraw React app (`core/canvas/app.tsx`) is served as a static HTML page bundled by Bun's HTML import system
- The iPad connects using `useSync({ uri: 'ws://...' })` from `@tldraw/sync` over LAN
- Custom WebSocket messages use a separate `/ws` endpoint (not interleaved with the sync protocol on `/sync`)

**Custom WebSocket messages (on `/ws`):**

| Direction | Message | Purpose |
|-----------|---------|---------|
| Server → iPad | `{ type: "snapshot-request", page?: string }` | Request a page screenshot |
| iPad → Server | `{ type: "snapshot-response", page: string, png: base64 }` | Screenshot result |
| Server → iPad | `{ type: "export-request" }` | Request all pages for PDF export |
| iPad → Server | `{ type: "export-response", pages: Array<{ name, png }> }` | All page images |

### Canvas Snapshots

Since tldraw's export APIs (`editor.toImage()`) require a browser DOM, snapshots are generated client-side on the iPad:

```
LLM calls read_canvas tool
  → MCP server sends { type: "snapshot-request" } via WebSocket to iPad
  → iPad calls editor.toImage() on the requested page
  → iPad sends PNG back via WebSocket
  → MCP server returns the image to the LLM's vision API
```

### Page Layout

The canvas is a **page-based notebook** — all "pages" are A4 frame shapes stacked vertically on a single tldraw document.

- Each frame is 595.28 × 841.89 points with a 60-point gap between frames
- Frames are undeletable and position/size-locked via tldraw's `registerBeforeChangeHandler`
- When a user draws on the last empty frame, a new frame is auto-created below (`core/canvas/page-autocreate.ts`)
- On export, each frame is exported individually with bounds clipped to the frame

### PDF Export

The `/export` command (or `export_pdf` MCP tool):
1. Sends an `export-request` to the iPad client
2. The iPad iterates through all frames and calls `editor.toImage()` on each at 300 DPI
3. Images are sent back via WebSocket
4. The server composes them into a multi-page A4 PDF using `pdf-lib` (`core/canvas/pdf-export.ts`)
5. PDF is written to the configured export directory

---

## MCP Server

**Protocol:** Model Context Protocol over stdio (internally; the sidecar wires tools directly to `ConversationEngine`)

**Tools exposed to the LLM:**

| Tool | Description | Annotations |
|------|-------------|-------------|
| `read_file` | Read a vault file (markdown with wikilink resolution, PDF text extraction, images as base64) | readOnly |
| `search_notes` | Semantic + keyword fallback search across vault files | readOnly |
| `list_files` | List vault directory contents with optional extension filter | readOnly |
| `create_file` | Create a new file in the vault (fails if exists) | write |
| `edit_file` | Find-and-replace editing in vault files | write, destructive |
| `read_canvas` | Capture a PNG snapshot from the iPad via WebSocket | readOnly |
| `export_pdf` | Export canvas pages as A4 PDF | write |
| `save_canvas` | Persist current canvas state to disk | write, idempotent |
| `transcribe_pdf` | OCR scanned/handwritten PDFs; saves markdown transcript | write |
| `web_search` | Search the web for current information | readOnly |

All file tools are vault-scoped — paths are resolved relative to the vault root, and traversal outside the vault is rejected.

**File format support:**
- **Markdown:** Wikilinks (`[[...]]`) are extracted and resolved, appended as a link footer so the LLM can follow references
- **PDF:** Text extracted via `pdf-parse`. `read_file` hints when a PDF likely needs OCR. `transcribe_pdf` runs full page-by-page OCR
- **Images:** Returned as base64-encoded data for the LLM's vision API

**Standalone mode:** The MCP server can run as a standalone stdio process (`core/mcp/standalone.ts`) for testing with the MCP Inspector.

---

## Semantic Search

`search_notes` uses semantic search when an embedding provider is configured, falling back to keyword search otherwise.

### Architecture

```
search_notes
  → check if EmbeddingProvider + EmbeddingIndex are initialized
  → if not configured → keyword fallback
  → embed the query via EmbeddingProvider
  → if index empty → await SearchIndexer.indexStaleFiles() (blocking, with progress)
  → if index non-empty → trigger indexStaleFiles() in background (non-blocking)
  → EmbeddingIndex.searchSimilar(queryVec, modelId, limit)
  → return top results ranked by cosine similarity
```

### Components

**`EmbeddingProvider` (`core/embedding/provider.ts`):**
```ts
interface EmbeddingProvider {
  readonly name: string;
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

- `CloudEmbeddingProvider` — routes requests through Clark Cloud (`/api/embed` → OpenAI `text-embedding-3-small`). Default for Clark Cloud users.
- `OllamaEmbeddingProvider` — calls the Ollama HTTP API directly. For local/power users.

**`EmbeddingIndex` (`core/embedding/index.ts`):**

SQLite-backed store (`~/.clark/embeddings.db`) via `bun:sqlite`. Schema:
```sql
chunks (id, path, chunk_idx, content, hash, model_id, embedding BLOB, updated_at)
UNIQUE(path, chunk_idx, model_id)
```

Embeddings stored as raw `Float32Array` blobs. Search uses brute-force cosine similarity — sufficient for vaults up to ~1,000 chunks.

**`SearchIndexer` (`core/embedding/indexer.ts`):**

Orchestrates scanning, chunking, and embedding. SHA-256 staleness detection avoids re-embedding unchanged content.

**`chunkMarkdown` (`core/embedding/chunker.ts`):**

Splits markdown into semantically meaningful chunks for embedding.

---

## LLM Layer

**Design:** Pluggable provider interface with a registry pattern

**`LLMProvider` interface:**
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

All providers must support streaming and tool use. Vision is required for canvas reading — providers without vision skip `read_canvas`.

**Providers:**

- **Clark Cloud** (`core/llm/cloud.ts`) — Default. Routes all LLM requests through the Clark Cloud Vercel proxy. API keys managed server-side; users need nothing. Supports vision.
- **Ollama** (`core/llm/ollama.ts`) — Local model support for power users who prefer privacy-first operation. Auto-discovers available models, performs RAM preflight checks before loading.

**Model picker:** The `/model` command shows an interactive picker with Clark Cloud and Ollama providers. Ollama dynamically lists locally available models. Selection is persisted to config.

**Conversation management:** The `Conversation` class (`core/llm/messages.ts`) manages message history with token estimation (for `/context`) and compaction via LLM-generated summary (for `/compact`).

---

## System Prompt

The system prompt is the sole guardrail mechanism. It instructs the LLM to:

- Never provide direct answers to homework problems
- Ask guiding questions that lead the student toward discovery
- Reference the student's own notes and class materials when relevant
- Read the student's handwritten work and comment on their approach
- Identify misconceptions and address them with targeted questions
- Encourage the student and acknowledge progress

Stored as plain text at `core/prompts/system.md` — user-customizable. Structure file purposes are appended at startup so the LLM knows what structures exist. If `<workspace>/Clark/CLARK.md` exists, its contents are appended (separated by `---`) for per-workspace context.

---

## TUI (Power Users)

The Terminal UI is a secondary interface for power users who prefer working in the terminal. It provides the same core functionality as the GUI via an Ink (React for CLI) chat interface.

**Entry point:** `index.ts` → `cli/bootstrap/start-app.ts`

**CLI flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--provider` | `clark-cloud` | LLM provider (`clark-cloud`, `ollama`) |
| `--model` | provider default | Specific model ID |
| `--port` | `3000` | Port for tldraw canvas server |
| `--upgrade` | — | Self-update to latest GitHub release |
| `--version` / `-v` | — | Print version and exit |

**Usage:**
```bash
cd ~/Notes/CS229
clark
```

**Slash commands** (also available in GUI):
- `/help`, `/tutorial`, `/canvas`, `/export [path]`, `/model`, `/context`, `/compact`, `/feedback <message>`, `/clear`, `/resume`, `/exit`

The TUI shares all `core/` business logic with the GUI. The canvas server, MCP tools, conversation engine, and cloud providers are identical — only the UI layer differs.

**Session persistence:** Sessions are saved incrementally to `<workspace>/Clark/Sessions/YYYY-MM-DD.md`. The `/resume` command presents a date picker to restore a past session.

---

## Project Structure

```
clark/
├── index.ts                   # CLI entry point
├── package.json
├── tsconfig.json
│
├── core/                      # Shared business logic (UI-agnostic)
│   ├── engine.ts              # ConversationEngine — turn loop
│   ├── config.ts              # Config persistence (~/.clark/config.json)
│   ├── library.ts             # Workspace scaffolding
│   ├── workspace.ts           # Workspace directory resolution
│   ├── history.ts             # Command history
│   ├── version.ts             # Version constant
│   │
│   ├── app/
│   │   ├── canvas-session.ts  # CanvasSessionManager
│   │   ├── command-router.ts  # Slash command dispatch
│   │   └── ingest.ts          # File ingestion pipeline
│   │
│   ├── canvas/                # tldraw server + iPad client app
│   │   ├── server.ts          # CanvasBroker + Bun.serve WebSocket
│   │   ├── app.tsx            # tldraw React app (iPad)
│   │   ├── pdf-export.ts      # Compose page PNGs into A4 PDF
│   │   └── page-autocreate.ts # Auto-create trailing empty frames
│   │
│   ├── mcp/                   # MCP tools
│   │   ├── server.ts          # MCP protocol handler
│   │   ├── tools.ts           # All 10 tool definitions + handlers
│   │   ├── vault.ts           # Wikilink resolution
│   │   └── standalone.ts      # Standalone stdio entry for testing
│   │
│   ├── llm/                   # LLM provider abstraction
│   │   ├── provider.ts        # Provider interface + registry
│   │   ├── cloud.ts           # Clark Cloud provider
│   │   ├── ollama.ts          # Ollama local provider
│   │   ├── messages.ts        # Conversation class
│   │   └── catalog.ts         # Provider/model catalog
│   │
│   ├── embedding/             # Semantic search
│   │   ├── provider.ts        # EmbeddingProvider interface
│   │   ├── cloud.ts           # CloudEmbeddingProvider
│   │   ├── index.ts           # EmbeddingIndex (SQLite)
│   │   ├── indexer.ts         # SearchIndexer
│   │   └── chunker.ts         # chunkMarkdown
│   │
│   ├── ocr/                   # OCR pipeline
│   │   ├── provider.ts        # OCRProvider interface
│   │   ├── cloud.ts           # CloudOCRProvider (Mistral via Clark Cloud)
│   │   ├── pdf-renderer.ts    # PDF-to-image via poppler (Ollama only)
│   │   └── transcribe.ts      # PDF transcription pipeline
│   │
│   └── prompts/
│       ├── system.md          # Socratic system prompt
│       ├── ingest.md          # Ingestion/linking prompt
│       ├── title.md           # Session title prompt
│       └── ocr/               # OCR prompt text
│
├── cli/                       # Terminal UI (Ink/React)
│   ├── bootstrap/             # CLI startup (args, provider, system prompt)
│   └── tui/                   # Ink components (app, chat, input, status, etc.)
│
├── gui/                       # Tauri desktop app
│   ├── sidecar.ts             # Bun HTTP sidecar (all runtime state + API)
│   ├── index.html             # GUI entry HTML
│   └── src/
│       ├── App.tsx            # Root React component
│       ├── app-controller.ts  # Pure reducer AppState
│       ├── ipc.ts             # Tauri/HTTP IPC bridge
│       └── components/        # All UI components
│
├── tauri/                     # Tauri Rust backend
│   └── src/
│       ├── lib.rs             # App setup + sidecar spawn
│       ├── commands.rs        # IPC command proxies
│       ├── sidecar.rs         # Sidecar process management
│       └── stream.rs          # SSE stream forwarder
│
├── cloud/                     # Clark Cloud (Vercel serverless)
│   ├── api/
│   │   ├── chat.ts            # LLM proxy (Vercel AI SDK)
│   │   ├── embed.ts           # Embeddings proxy
│   │   ├── ocr.ts             # OCR proxy (Mistral)
│   │   ├── feedback.ts        # Discord webhook relay
│   │   ├── telemetry.ts       # Usage telemetry
│   │   └── auth/              # Beta code + status endpoints
│   ├── lib/
│   │   ├── auth.ts            # Client ID auth + tier enforcement
│   │   ├── rate-limit.ts      # Upstash Redis sliding window
│   │   └── redis.ts           # Redis client singleton
│   └── vercel.json            # Function timeout config
│
├── docs/                      # SPEC.md, TODO.md, design, dependency docs
├── scripts/                   # Build, benchmark, eval scripts
├── test/                      # bun test suite + test_vault fixture
└── install.sh                 # Curl-based binary installer
```

---

## Configuration

Config is persisted at `~/.clark/config.json`. No API keys are stored — Clark Cloud manages them server-side.

```ts
interface ClarkConfig {
  provider?: string;
  model?: string;
  ollamaBaseUrl?: string;
  clientId?: string;          // UUID for Clark Cloud identity
  workspaceDir?: string;
  pdfExportDir?: string;
  fileRouting?: {
    pdf?: string;             // default: "Resources/PDFs"
    image?: string;           // default: "Resources/Images"
    other?: string;           // default: "Resources"
  };
  embedding?: {
    provider?: "clark-cloud" | "ollama";
    model?: string;
  };
  hasCompletedOnboarding?: boolean;
  tutorialProgress?: {
    completed: boolean;
    currentStep?: number;
    lastCompletedAt?: string;
  };
  maxToolCallsPerTurn?: number;
  maxTokens?: number;
}
```

---

## Distribution

**Desktop app:** Tauri `.dmg` installer distributed via GitHub Releases. Built via `tauri build`.

**CLI binary:** Standalone compiled binary via `bun build --compile`. Installed via:
```bash
curl -fsSL https://raw.githubusercontent.com/alexracape/clark/main/install.sh | bash
```

The install script detects the user's platform, downloads the correct binary from GitHub Releases, verifies the SHA-256 checksum, and installs to `/usr/local/bin/clark`.

**Supported platforms:** macOS (arm64, x64), Linux (arm64, x64)

**Release workflow:** Pushing a git tag (`v*`) triggers `.github/workflows/release.yml`, which builds binaries on GitHub Actions and creates a GitHub Release with all binaries and checksums.
