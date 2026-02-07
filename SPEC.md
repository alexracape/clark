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
- Supports slash commands for common actions
- Renders markdown in responses (code blocks, math, lists)
- Shows a status indicator when Clark is thinking or reading the canvas

**Session lifecycle:**
- Student launches `clark` from the terminal
- Optionally provides a problem set file: `clark --problem ./pset3.pdf`
- Optionally configures the notes directory: `clark --notes ~/Notes/CS229`
- Session is ephemeral — conversation is not persisted across runs (v1)

**Slash commands:**
- `/problem <path>` — Load a problem set file (PDF or markdown)
- `/notes <path>` — Set the notes directory to search
- `/canvas` — Open the tldraw canvas URL (prints the LAN URL, or opens browser)
- `/snapshot [page]` — Manually trigger a canvas snapshot and send to the LLM
- `/export [path]` — Export canvas pages as A4 PDF to the given path (or default location)
- `/save` — Manually save canvas state to disk
- `/clear` — Clear conversation history
- `/model <provider>` — Switch LLM provider mid-session
- `/help` — Show available commands

### 2. Canvas System (tldraw)

#### tldraw Server

**Runtime:** `Bun.serve()` with WebSocket support

**Sync:** Uses `TLSocketRoom` from `@tldraw/sync-core` with `InMemorySyncStorage`.

```ts
import { TLSocketRoom, InMemorySyncStorage } from '@tldraw/sync-core'

const storage = new InMemorySyncStorage({
  snapshot: existingData, // load from disk if resuming
  onChange() {
    // debounced auto-save to ~/.clark/canvas/<session-id>.json
    debouncedSave(storage.getSnapshot())
  },
})
const room = new TLSocketRoom({ storage })
```

**Behavior:**
- Serves the tldraw React app as a static HTML page (bundled by Bun)
- Canvas runs in the iPad's browser at a LAN address (e.g., `http://192.168.1.x:3000`)
- The iPad client connects using `useSync({ uri: 'ws://...' })` from `@tldraw/sync`
- `TLSocketRoom` handles sync, conflict resolution, and reconnection automatically

**Custom WebSocket messages** (alongside the sync protocol):
- `{ type: "snapshot-request", page?: string }` — Server → iPad: request a page screenshot
- `{ type: "snapshot-response", page: string, png: base64 }` — iPad → Server: screenshot result
- `{ type: "export-request" }` — Server → iPad: request all pages as images for PDF
- `{ type: "export-response", pages: Array<{ name: string, png: base64 }> }` — iPad → Server: all page images

#### Page-Based UI

The canvas is configured as a **page-based notebook**, not an infinite canvas. This maps directly to homework submissions.

**tldraw page support (confirmed from docs):**
- tldraw natively supports multiple pages per document (up to 40 by default, configurable via `maxPages`)
- Each page has its own shapes, camera position, and selection state
- The built-in `NavigationPanel` provides page navigation, zoom controls, and minimap
- Pages can be created, deleted, duplicated, renamed, and reordered via the API

**A4 page setup:**
- On each page, a `frame` shape is created at A4 dimensions (595 x 842 points) as a visual boundary
- Camera constraints lock the viewport to the frame area using `behavior: 'contain'`:
  ```ts
  editor.setCameraOptions({
    constraints: {
      bounds: { x: 0, y: 0, w: 595, h: 842 },
      padding: { x: 32, y: 32 },
      origin: { x: 0.5, y: 0.5 },
      initialZoom: 'fit-min',
      baseZoom: 'default',
      behavior: 'contain',
    },
  })
  ```
- On export, content is clipped to the frame bounds
- Default: session starts with one blank A4 page; new pages can be added freely via the tldraw UI

#### Visual Context Extraction (inspired by tldraw Agent SDK)

The tldraw Agent SDK defines a pattern for giving AI models rich context about canvas state. Clark adopts this approach for the iPad client:

**Three levels of shape representation** (from the Agent SDK):
1. **BlurryShape** — Lightweight summary of shapes in the viewport: bounds, ID, type, text content. Cheap to include in every LLM call as structured context.
2. **SimpleShape** — Full properties for selected/focused shapes. Used when the LLM needs detailed information about specific content.
3. **PeripheralShapeCluster** — Grouped counts of shapes outside the viewport. Gives the LLM awareness of off-screen content without sending full data.

**How Clark uses these:**
- The iPad client extracts BlurryShape summaries for the current page and includes them in snapshot responses. This gives the LLM structured data alongside the PNG image.
- When the student selects shapes (e.g., highlighting a specific equation), the SimpleShape format provides detailed properties.
- The LLM receives both the screenshot (for handwriting OCR via vision) and structured shape data (for typed text, shapes, annotations).

**PromptPart pattern:**
The Agent SDK's `PromptPartUtil` pattern — modular classes that each contribute a piece of context — is a good model for assembling the LLM prompt. Clark applies this on the server side: each context source (canvas snapshot, shape summaries, problem set text, relevant notes) is a "prompt part" that contributes to the system message.

#### Persistence

- `InMemorySyncStorage.onChange()` fires on every canvas change
- Changes are debounced (2 seconds) and the full document snapshot is serialized to `~/.clark/canvas/<session-id>.json`
- On startup, if a previous save exists for the same problem set, offer to resume
- The `/save` command triggers an immediate save

#### PDF Export

- The `/export` command (or `export_pdf` MCP tool) sends an `export-request` to the iPad client
- The iPad client iterates through all pages, calling `editor.toImage()` on each with the frame bounds and print resolution (300 DPI)
- Page images are sent back to the server via WebSocket
- The server composes them into a multi-page A4 PDF using `pdf-lib`
- PDF is written to disk (default: alongside the problem set file, or a user-specified path)

### 3. MCP Server (Context + Canvas Tools)

**Protocol:** Model Context Protocol (MCP) over stdio

**Resources:**
- `notes://` — Access to the configured notes directory (Obsidian vault or any folder of markdown/PDF files)
- `problem://` — Access to the loaded problem set file

**Tools exposed to the LLM:**

| Tool | Description |
|------|-------------|
| `read_file` | Read the contents of a file by path (markdown as text, PDF extracted as text) |
| `search_notes` | Keyword search across all files in the notes directory. Returns matching file paths and snippets. |
| `list_files` | List files in a directory, optionally filtered by extension |
| `read_canvas` | Request a PNG snapshot of a canvas page from the iPad client (via WebSocket). Returns the image for the vision API, plus BlurryShape structured data. |
| `export_pdf` | Request all page images from the iPad client, compose into A4 PDF via `pdf-lib`. Returns the file path. |
| `save_canvas` | Persist current canvas state to disk via `storage.getSnapshot()`. |

**Canvas tool implementation:**
The MCP server holds references to:
- The `TLSocketRoom` instance (for `save_canvas` — calls `storage.getSnapshot()`)
- A WebSocket message broker (for `read_canvas` and `export_pdf` — sends requests to the iPad, awaits responses)

This keeps the MCP server decoupled from tldraw internals. It doesn't import tldraw or know about shapes — it just sends messages and receives images.

**File format support:**
- **Markdown (.md):** Read as plain text. Obsidian-flavored links and frontmatter are preserved.
- **PDF (.pdf):** Text extracted for search and reading. Sent as images to the vision API when layout matters (diagrams, equations).

**Search (v1):** Keyword/substring search over file contents. Results ranked by relevance (match density).

**Future enhancement:** Vector embeddings index for semantic search / RAG retrieval over notes.

### 4. LLM Layer

**Design:** Pluggable provider interface

**V1 providers:**
- **Anthropic (Claude)** — Claude Sonnet or Opus via the Anthropic API. Vision support for canvas snapshots and PDF images.
- **OpenAI** — GPT-4o via the OpenAI API. Vision support for canvas snapshots.

**Future provider:**
- **Ollama** — Local model support for privacy-first use. Vision quality will vary by model. The interface is designed to accommodate this but implementation is deferred.

**Provider interface:**
```ts
interface LLMProvider {
  name: string;
  chat(messages: Message[], tools: Tool[]): AsyncIterable<StreamChunk>;
  supportsVision: boolean;
}
```

- All providers must support streaming responses
- All providers must support tool use (function calling)
- Vision capability is required for canvas reading — providers without vision skip the `read_canvas` tool

**Configuration:**
- Provider and model are set via environment variables or CLI flags
- `CLARK_PROVIDER=anthropic` / `CLARK_PROVIDER=openai`
- `CLARK_MODEL=claude-sonnet-4-5-20250929` / `CLARK_MODEL=gpt-4o`
- API keys via standard env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

### 5. Socratic System Prompt

The system prompt is the sole guardrail mechanism. It instructs the LLM to:

- Never provide direct answers to homework problems
- Ask guiding questions that lead the student to discover the answer
- Reference the student's own notes and class materials when relevant
- Read the student's handwritten work and comment on their approach
- Identify misconceptions and address them with targeted questions
- Encourage the student and acknowledge progress
- Adapt question difficulty based on the student's responses

The system prompt is stored as a plain text file in the repo (`prompts/system.md`) so users can customize it.

## Project Structure

```
clark/
├── CLAUDE.md                  # Bun conventions for AI assistants
├── SPEC.md                    # This file
├── package.json
├── tsconfig.json
├── index.ts                   # Entry point — starts tldraw server, MCP server, TUI
│
├── src/
│   ├── tui/                   # Ink-based terminal UI
│   │   ├── app.tsx            # Root Ink component
│   │   ├── chat.tsx           # Chat message display
│   │   ├── input.tsx          # User input handling
│   │   └── status.tsx         # Status bar (model, canvas, etc.)
│   │
│   ├── canvas/                # tldraw server + client app
│   │   ├── server.ts          # Bun.serve + TLSocketRoom setup + WS message broker
│   │   ├── pdf-export.ts      # Compose page PNGs into A4 PDF (server-side, uses pdf-lib)
│   │   ├── app.tsx            # tldraw React app (runs on iPad)
│   │   ├── context.ts         # BlurryShape/SimpleShape extraction (runs on iPad)
│   │   └── index.html         # Entry HTML served to iPad
│   │
│   ├── mcp/                   # MCP server
│   │   ├── server.ts          # MCP protocol handler
│   │   ├── tools.ts           # Tool definitions (read_file, search, canvas tools)
│   │   └── pdf.ts             # PDF text extraction (for reading problem sets)
│   │
│   ├── llm/                   # LLM provider abstraction
│   │   ├── provider.ts        # Provider interface + types
│   │   ├── anthropic.ts       # Claude implementation
│   │   ├── openai.ts          # OpenAI implementation
│   │   └── messages.ts        # Message history management
│   │
│   └── prompts/
│       └── system.md          # Socratic system prompt
│
└── test/                      # Tests
    ├── mcp.test.ts
    ├── llm.test.ts
    └── canvas.test.ts
```

Note: Files in `src/canvas/` that run on the iPad (`app.tsx`, `context.ts`) are bundled by Bun and served as static assets. Files that run on the server (`server.ts`, `pdf-export.ts`) are part of the main Bun process.

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
| `pdf-parse` | PDF text extraction (reading problem sets) |
| `pdf-lib` | PDF generation (exporting canvas pages to A4 PDF) |
| `chalk` | Terminal color output |
| `yargs` | CLI argument parsing |

Dev dependencies: `@types/bun`, `@types/react`, `typescript`

## Configuration

Clark uses environment variables and CLI flags. No config file for v1.

```bash
# Required: at least one API key
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# Run clark
clark --problem ./pset3.pdf --notes ~/Notes/CS229

# Or with explicit provider
clark --provider anthropic --model claude-sonnet-4-5-20250929
```

**CLI flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--problem <path>` | none | Path to problem set file (PDF or markdown) |
| `--notes <path>` | none | Path to notes directory |
| `--provider` | `anthropic` | LLM provider (`anthropic` or `openai`) |
| `--model` | provider default | Specific model ID |
| `--port` | `3000` | Port for tldraw canvas server |

## Non-Goals (v1)

- **Session persistence / conversation history** — Sessions are ephemeral. Persistence is planned for a future version.
- **Multi-session support** — One tutoring session at a time.
- **Local LLM support (Ollama)** — Interface is designed for it, but not implemented in v1.
- **Vector search / RAG** — Keyword search only in v1.
- **Instructor dashboard or analytics** — Student-facing tool only.
- **Mobile-native app** — iPad accesses tldraw via Safari.

## tldraw Technical Reference

Key APIs and patterns from the tldraw docs that Clark relies on:

### Sync Setup (server)
```ts
import { TLSocketRoom, InMemorySyncStorage } from '@tldraw/sync-core'

const storage = new InMemorySyncStorage({
  snapshot: loadedData,
  onChange: () => debouncedSave(storage.getSnapshot()),
})
const room = new TLSocketRoom({ storage })

// In WebSocket handler:
room.handleSocketConnect({ sessionId, socket })
```

### Sync Setup (iPad client)
```tsx
import { useSync } from '@tldraw/sync'
import { Tldraw } from 'tldraw'

function App() {
  const store = useSync({ uri: `ws://${host}:${port}/sync` })
  return <Tldraw store={store} onMount={setupPages} />
}
```

### Page Management
```ts
editor.createPage({ name: 'Page 1' })
editor.getPages()               // list all pages
editor.setCurrentPage(pageId)   // switch pages
editor.renamePage(pageId, name)
editor.deletePage(pageId)
// maxPages option controls limit (default 40)
```

### Camera Constraints (A4 viewport lock)
```ts
editor.setCameraOptions({
  constraints: {
    bounds: { x: 0, y: 0, w: 595, h: 842 }, // A4 in points
    padding: { x: 32, y: 32 },
    origin: { x: 0.5, y: 0.5 },
    initialZoom: 'fit-min',
    baseZoom: 'default',
    behavior: 'contain', // 'fixed' when zoomed out, 'inside' when zoomed in
  },
})
```

### Frame Shape (A4 visual boundary)
```ts
editor.createShape({
  type: 'frame',
  x: 0, y: 0,
  props: { w: 595, h: 842, name: 'Page 1' },
})
// Frames clip their children visually
```

### Image Export (client-side only — requires DOM)
```ts
const result = await editor.toImage(shapes, {
  format: 'png',
  pixelRatio: 2,      // 2x for retina / vision API quality
  background: true,
  bounds: frameBounds, // clip to A4 frame
})
// result.blob contains the PNG
```

### Persistence Snapshots
```ts
import { getSnapshot, loadSnapshot } from 'tldraw'

// Save (server-side, from InMemorySyncStorage)
const data = storage.getSnapshot()
await Bun.write(savePath, JSON.stringify(data))

// Load (server-side, into InMemorySyncStorage)
const data = await Bun.file(savePath).json()
const storage = new InMemorySyncStorage({ snapshot: data })
```

## Open Questions

1. **tldraw canvas export fidelity** — Need to validate that `editor.toImage()` at `pixelRatio: 2` captures Apple Pencil strokes at sufficient resolution for vision API OCR. May need to experiment with scale factor.
2. **PDF rendering for vision** — For PDFs with diagrams/equations, should we send page images to the vision API, or is text extraction sufficient? Likely need both paths depending on content type.
3. **WebSocket message interleaving** — The sync protocol and custom messages (snapshot requests) share the same WebSocket. Need to verify that custom messages don't interfere with tldraw's sync protocol, or use a separate WebSocket endpoint for custom messages.
4. **A4 frame enforcement** — Camera constraints with `behavior: 'contain'` prevent panning away from the frame, but students can still draw outside it. On export, we clip to frame bounds via the `bounds` option in `editor.toImage()`. Verify this produces clean results.
5. **BlurryShape extraction cost** — Evaluate whether including structured shape data alongside PNG snapshots meaningfully improves LLM comprehension of handwritten content, or if vision alone is sufficient. If vision alone works well, skip the shape extraction for simplicity.
