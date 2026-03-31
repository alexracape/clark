# Clark GUI Architecture Specification

**Status:** Planning
**Last Updated:** 2026-02-23

---

## Executive Summary

This document outlines the strategy for evolving Clark from a Terminal UI (TUI) application to a cross-platform desktop GUI application using Tauri. The goal is to make Clark accessible to non-technical students and instructors while maintaining the existing CLI for power users.

**Key Decisions:**
- **Framework:** Tauri v2 (Rust + Web frontend)
- **Frontend:** React (reuse knowledge from Ink, required for tldraw)
- **Backend Strategy:** Phased migration from Bun sidecar (MVP) to Rust backend (optimized)
- **Distribution:** Native installers (.dmg, .exe, .AppImage) via Tauri

**Expected Outcomes:**
- Bundle size: ~8-20MB (vs 120MB+ for Electron)
- Memory usage: ~90-140MB (vs 250-300MB for Electron/full Bun)
- Startup time: <0.5s (vs 1.5s+ for Electron)
- Installation: Simple download & install (vs terminal setup)

---

## Table of Contents

1. [Strategic Rationale](#strategic-rationale)
2. [Technology Selection](#technology-selection)
3. [Architecture Overview](#architecture-overview)
4. [Repository Structure](#repository-structure)
5. [Phased Implementation Plan](#phased-implementation-plan)
6. [Component Migration Analysis](#component-migration-analysis)
7. [Performance Targets](#performance-targets)
8. [Open Questions](#open-questions)
9. [References](#references)

---

## Strategic Rationale

### Why Build a GUI?

**Target User Challenges:**
- **Students/TAs/Instructors** are the primary audience (not developers)
- Even simple terminal commands (`cd`, path navigation) are barriers to entry
- "Open terminal" causes 80%+ of non-technical users to bounce
- Academic use cases (office hours, note-taking) expect GUI applications

**Killer Feature Hidden in TUI:**
- **tldraw canvas integration** - Visual, collaborative whiteboard
- Cannot show canvas directly in terminal
- GUI unlocks:
  - Real-time canvas preview
  - Drag-and-drop resources onto canvas
  - QR code for sharing sessions (perfect for office hours)
  - Side-by-side markdown + chat view

**Distribution Friction:**

Current (CLI):
```
1. Install Bun (unfamiliar tool)
2. Configure PATH (often fails)
3. Run `bun install -g clark`
4. Debug installation errors
```

Proposed (GUI):
```
1. Download ClarkApp.dmg
2. Drag to Applications
3. Launch
```

**Competitive Positioning:**
- Claude Code: CLI-only (developer-focused)
- ChatGPT Desktop: Cloud-only, no local models
- Clark GUI: Cloud-first with local model option, canvas-integrated, academic-focused **differentiation**

**Decision:** GUI is necessary for product-market fit with target audience.

---

## Backend Strategy: Phased Migration

**Challenge:** Balance speed-to-market vs optimal architecture.

**Solution:** Start with **Bun sidecar** (fast MVP), migrate to **Rust backend** over time.

**Phase 1 (MVP):** Tauri wraps Bun sidecar
- Ships in 2-3 weeks
- Reuses 100% of existing TypeScript code
- Bundle: ~20MB, Memory: ~130-150MB

**Phase 2 (Optimized):** Rust backend + minimal Bun (tldraw only)
- Migrate LLM, MCP, file I/O to Rust
- Keep tldraw sync in Bun (TypeScript-only library)
- Bundle: ~10MB, Memory: ~90MB

See [Phased Implementation Plan](#phased-implementation-plan) for details.

---

## Architecture Overview

### Phase 1: Bun Sidecar (MVP)

```
┌─────────────────────────────────────────────────┐
│ Tauri Application (Native Window)              │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ React Frontend (WebView - OS Renderer)    │ │
│  │                                           │ │
│  │  Components:                              │ │
│  │   - Chat UI (message list + input)        │ │
│  │   - Canvas Panel (tldraw embedded)        │ │
│  │   - Settings (model picker)                │ │
│  │   - Resource Library (drag-drop files)    │ │
│  │                                           │ │
│  └───────────────────────────────────────────┘ │
│                    ↕                            │
│              Tauri IPC Commands                 │
│                    ↕                            │
│  ┌───────────────────────────────────────────┐ │
│  │ Rust Backend (Minimal - ~200 lines)       │ │
│  │                                           │ │
│  │  - Spawn Bun sidecar on startup           │ │
│  │  - Expose file picker dialog              │ │
│  │  - Manage app lifecycle                   │ │
│  │                                           │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
                    ↓ spawns + monitors
┌─────────────────────────────────────────────────┐
│ Bun Sidecar Process (Existing Codebase)        │
│                                                 │
│  HTTP Server (port 3456):                      │
│   - GET  /             → Serve canvas HTML     │
│   - WS   /sync/:roomId → tldraw sync protocol  │
│   - WS   /ws           → Canvas broker (iPad)  │
│                                                 │
│  Modules (from src-core/):                     │
│   - llm/        → LLM provider implementations │
│   - mcp/        → MCP server + tools           │
│   - canvas/     → tldraw room management       │
│   - ocr/        → PDF transcription            │
│   - config.ts   → Configuration management     │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Data Flow Example (User sends message):**
1. User types in React Chat component
2. Frontend calls `invoke('send_message', { text: '...' })`
3. Tauri IPC forwards to Rust
4. Rust forwards to Bun sidecar via HTTP POST
5. Bun calls LLM provider (Clark Cloud proxy or Ollama)
6. Response streams back: Bun → Rust → React (via WebSocket)

**Why This Works for MVP:**
- ✅ Zero code rewrite - existing business logic untouched
- ✅ Fast to ship - focus on UI/UX
- ✅ Low risk - proven backend
- ❌ Not optimal - two runtimes, higher memory

---

### Phase 2: Hybrid Architecture (Optimized)

```
┌─────────────────────────────────────────────────┐
│ Tauri Application                               │
│                                                 │
│  Frontend (React)                               │
│        ↕ IPC                                    │
│  ┌───────────────────────────────────────────┐ │
│  │ Rust Backend (Primary)                    │ │
│  │                                           │ │
│  │  Modules:                                 │ │
│  │   - HTTP/WS server (Axum)                 │ │
│  │   - LLM API calls (reqwest + serde)       │ │
│  │   - MCP server (Rust MCP SDK)             │ │
│  │   - File I/O (Tauri fs plugin)            │ │
│  │   - Config (serde_json)                   │ │
│  │   - PDF processing (pdf-extract)          │ │
│  │                                           │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
                    ↓ spawns minimal process
┌─────────────────────────────────────────────────┐
│ Minimal Bun Process (~50 lines)                 │
│                                                 │
│  ONLY: tldraw sync server                      │
│   - WS /sync/:roomId → TLSocketRoom            │
│   - Uses @tldraw/sync-core (TypeScript only)   │
│                                                 │
│  Memory: ~50MB (vs ~120MB for full Bun)        │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Why Keep Bun for tldraw:**
- `@tldraw/sync-core` is TypeScript-only (no Rust equivalent)
- Rewriting sync protocol = 2-4 weeks of work + ongoing maintenance
- 50MB overhead acceptable for **key differentiating feature**

---

## Repository Structure

### Current Structure (TUI)

```
clark/
├── src/
│   ├── llm/              # LLM provider implementations
│   ├── mcp/              # MCP server + tools
│   ├── canvas/           # tldraw sync server
│   ├── ocr/              # PDF transcription
│   ├── tui/              # Ink TUI components
│   ├── app/              # CLI app logic
│   ├── bootstrap/        # CLI startup
│   └── config.ts         # Config management
├── index.ts              # CLI entry point
├── package.json
└── bun.lockb
```

### Proposed Structure (GUI + CLI)

```
clark/
├── core/                       # Shared business logic (UI-agnostic)
│   ├── llm/                    # LLM providers (clark-cloud, ollama)
│   ├── mcp/                    # MCP server + tool implementations
│   ├── canvas/                 # tldraw room management, broker
│   ├── ocr/                    # PDF processing, transcription
│   ├── config.ts               # Configuration persistence
│   └── types.ts                # Shared TypeScript types
│
├── cli/                        # CLI-specific (Terminal UI)
│   ├── tui/                    # Ink components (moved from src/tui)
│   │   ├── app.tsx
│   │   ├── chat.tsx
│   │   ├── primitives/
│   │   └── ...
│   ├── app/                    # CLI app logic (moved from src/app)
│   ├── bootstrap/              # CLI startup (moved from src/bootstrap)
│   └── index.ts                # CLI entry point
│
├── gui/                        # GUI frontend (React web)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat.tsx        # Chat interface (message list + input)
│   │   │   ├── Canvas.tsx      # tldraw embedded panel
│   │   │   ├── Settings.tsx    # API key setup, model picker
│   │   │   ├── Resources.tsx   # Resource library with drag-drop
│   │   │   └── Onboarding.tsx  # First-run setup wizard
│   │   ├── hooks/              # React hooks (useConversation, etc.)
│   │   ├── App.tsx             # Root component
│   │   └── main.tsx            # React entry point
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json            # GUI-specific frontend deps
│
├── tauri/                      # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs             # Tauri app setup
│   │   ├── sidecar.rs          # Bun sidecar spawning/management
│   │   ├── commands.rs         # IPC commands (file picker, etc.)
│   │   └── lib.rs              # Phase 2: Rust backend modules
│   ├── Cargo.toml              # Rust dependencies
│   ├── tauri.conf.json         # Tauri configuration
│   ├── build.rs                # Build script
│   ├── capabilities/           # Permission configs
│   └── icons/                  # App icons (platform-specific)
│
├── package.json                 # Root package.json (workspace?)
├── bun.lockb
├── Cargo.lock
└── docs/
    ├── GUI.md                  # This document
    ├── SPEC.md
    └── TODO.md
```

**Key Changes:**
1. **`src/` → `core/`** - All UI-agnostic business logic
2. **`cli/`** - Terminal UI moved here (keep CLI for power users)
3. **`gui/`** - New React frontend
4. **`tauri/`** - Rust backend (standard Tauri structure)

**Why This Structure:**
- ✅ **Clear separation** - Core logic vs UI implementation
- ✅ **Code reuse** - Both CLI and GUI import from `src-core/`
- ✅ **Standard Tauri layout** - Follows official conventions
- ✅ **Independent packaging** - Can ship CLI and GUI separately

---

## Phased Implementation Plan

### Phase 1: MVP - Bun Sidecar (2-3 weeks)

**Goal:** Ship working GUI with existing codebase, validate product-market fit.

**Architecture:** Tauri (minimal Rust) + Bun sidecar (all logic)

#### Week 1: Scaffold & Prove Concept

**Tasks:**
1. Install Tauri CLI and dependencies
   ```bash
   cargo install tauri-cli
   cargo install create-tauri-app
   ```

2. Initialize Tauri project (in repo root)
   ```bash
   cargo create-tauri-app --name clark-gui
   # Select: React + Vite
   ```

3. Configure Bun as sidecar in `tauri.conf.json`:
   ```json
   {
     "bundle": {
       "externalBin": [
         "binaries/clark-backend"
       ]
     }
   }
   ```

4. Write minimal Rust backend (`src-tauri/src/main.rs`):
   ```rust
   use tauri::{Manager, api::process::{Command, CommandEvent}};

   #[tauri::command]
   fn spawn_bun_backend() {
       let sidecar = Command::new_sidecar("clark-backend")
           .expect("failed to create sidecar command");

       sidecar.spawn().expect("Failed to spawn Bun backend");
   }

   fn main() {
       tauri::Builder::default()
           .setup(|app| {
               spawn_bun_backend();
               Ok(())
           })
           .run(tauri::generate_context!())
           .expect("error running tauri app");
   }
   ```

5. **Spike test:** Verify Bun sidecar starts and accepts HTTP requests

**Acceptance:**
- Tauri window opens
- Bun process starts automatically

---

#### Week 2: Build GUI Frontend

**Tasks:**
1. Refactor `src/` → `core/` (move UI-agnostic code)
2. Create React components in `src-gui/`:
   - `Chat.tsx` - Message list + input
   - `Canvas.tsx` - Embed tldraw with `useSync`
   - `Settings.tsx` - Model and workspace configuration
3. Connect to Bun backend via HTTP/WebSocket
4. Implement IPC commands for file picker (via Tauri)

**Example: Canvas.tsx**
```tsx
import { Tldraw } from 'tldraw'
import { useSync } from '@tldraw/sync'
import 'tldraw/tldraw.css'

export function Canvas({ roomId }: { roomId: string }) {
  const store = useSync({
    uri: `ws://localhost:3456/sync/${roomId}`,
  })

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw store={store} />
    </div>
  )
}
```

**Acceptance:**
- Chat interface sends messages to LLM
- Canvas displays and syncs in real-time
- Can open file picker from Settings

---

#### Week 3: Polish & Package

**Tasks:**
1. Add onboarding flow (first-run welcome + beta code)
2. Add app icons and branding
3. Configure Tauri bundler for Mac/Windows
4. Test build pipeline:
   ```bash
   bun tauri build
   ```
5. Create GitHub Actions for automated builds

**Deliverables:**
- `ClarkApp.dmg` (macOS)
- `ClarkApp.msi` (Windows)
- `clark.AppImage` (Linux)

**Acceptance:**
- Non-technical user can download, install, and use without terminal
- Bundle size <25MB
- App starts in <1 second

**Success Metrics:**
- 5 beta users successfully install and run GUI
- Collect feedback on canvas feature usage
- Measure memory usage (target: <150MB)

---

### Phase 2: Hybrid Architecture (Months 2-4)

**Goal:** Optimize performance by migrating logic to Rust, reduce memory footprint.

**Trigger:** After MVP validation, if memory/performance is a concern.

#### Stage 2.1: Move HTTP/WebSocket Server to Rust

**Replace:** `Bun.serve()` with Axum (Rust web framework)

**Implementation:**
```rust
// src-tauri/src/server.rs
use axum::{Router, routing::{get, post}, Json};
use tokio::net::TcpListener;

#[tokio::main]
async fn start_server() {
    let app = Router::new()
        .route("/api/chat", post(handle_chat))
        .route("/api/models", get(list_models))
        .route("/health", get(|| async { "OK" }));

    let listener = TcpListener::bind("127.0.0.1:3456")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}
```

**Effort:** 3-5 days
**Memory savings:** ~30-50MB

---

#### Stage 2.2: Move LLM API Calls to Rust

**Replace:** Clark Cloud TypeScript proxy client with `reqwest` + `serde` (Rust)

**Implementation:**
```rust
// src-tauri/src/llm/cloud.rs
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub async fn call_cloud_proxy(
    request: CloudRequest,
) -> Result<CloudResponse, Error> {
    let client = Client::new();
    let res = client
        .post("https://clark-steel.vercel.app/api/chat")
        .json(&request)
        .send()
        .await?
        .json()
        .await?;

    Ok(res)
}
```

**Effort:** 3-5 days (clark-cloud proxy + ollama)
**Benefit:** Faster API calls, lower memory, no SDK overhead

---

#### Stage 2.3: Move MCP Server to Rust

**Replace:** `@modelcontextprotocol/sdk` (TypeScript) with Rust MCP SDK

**Note:** User confirmed a **Rust MCP SDK exists** - use official implementation.

**Implementation:**
```rust
// src-tauri/src/mcp/server.rs
use mcp_sdk::{Server, Tool, ToolResult}; // Hypothetical - check actual SDK

pub struct FileReadTool;

impl Tool for FileReadTool {
    fn name(&self) -> &str { "read_file" }

    fn execute(&self, params: Value) -> ToolResult {
        let path = params["path"].as_str().unwrap();
        let content = std::fs::read_to_string(path)?;
        Ok(json!({ "content": content }))
    }
}

pub fn start_mcp_server() {
    let server = Server::new()
        .add_tool(FileReadTool)
        .add_tool(WriteFileTool)
        .add_tool(ListFilesTool);

    server.listen_stdio();
}
```

**Effort:** 3-5 days
**Benefit:** Native integration, potentially better performance

---

#### Stage 2.4: Minimize Bun Sidecar (tldraw only)

**Goal:** Strip Bun process down to ONLY tldraw sync server.

**Create minimal `canvas-sync.ts`:**
```typescript
import { TLSocketRoom, InMemorySyncStorage } from '@tldraw/sync-core'

Bun.serve({
  port: 3456,
  websocket: {
    open(ws) {
      const room = new TLSocketRoom({
        storage: new InMemorySyncStorage(),
      })
      room.handleSocketOpen(ws)
    },
    message(ws, msg) {
      ws.room.handleSocketMessage(ws, msg)
    },
    close(ws) {
      ws.room.handleSocketClose(ws)
    },
  },
})
```

**Bundle minimal Bun:**
```bash
bun build canvas-sync.ts --compile --outfile binaries/canvas-sync
```

**Update `tauri.conf.json`:**
```json
{
  "bundle": {
    "externalBin": [
      "binaries/canvas-sync"
    ]
  }
}
```

**Effort:** 2-3 days
**Memory savings:** ~70MB (120MB full Bun → 50MB minimal)

---

**Phase 2 Total:**
- **Time:** 2-3 months (parallel to feature development)
- **Memory reduction:** ~130MB → ~90MB (30% improvement)
- **Bundle size:** ~20MB → ~10MB
- **Maintenance:** Simpler (less TypeScript, more Rust)

---

## Open Questions

### Q1: Should we maintain both CLI and GUI long-term?

**Current stance:** Unsure, depends on user feedback.

**Options:**
- **A: Both forever** - CLI for power users, GUI for general users (requires shared `src-core/`)
- **B: GUI only** - Deprecate CLI after GUI is stable (simpler maintenance)
- **C: CLI as fallback** - Keep for SSH/remote use, minimal updates

**Decision point:** After 3-6 months of GUI usage data.

---

### Q2: How to handle updates?

**Tauri built-in updater:**
- Checks for updates on GitHub Releases
- Downloads and installs in background
- Prompts user to restart

**Action:** Configure in Phase 1, test in Phase 3.

---

### Q5: Code signing for distribution?

**macOS:** Requires Apple Developer account ($99/year)
**Windows:** Requires code signing certificate (~$200-400/year)

**Phase 1:** Ship unsigned (users see security warning)
**Phase 2:** Add code signing after validating user adoption

---

## References

### Documentation
- [Tauri v2 Documentation](https://v2.tauri.app/)
- [Tauri Project Structure](https://v2.tauri.app/start/project-structure/)
- [Tauri Sidecar Guide](https://v2.tauri.app/develop/sidecar/)
- [Using Bun as Tauri Sidecar](https://codeforreal.com/blogs/using-bun-or-deno-as-a-web-server-in-tauri/)
- [tldraw Documentation](https://tldraw.dev/)
- [tldraw Multiplayer Starter Kit](https://tldraw.dev/starter-kits/multiplayer)

### Rust Ecosystem
- [Axum Web Framework](https://docs.rs/axum/latest/axum/)
- [Reqwest HTTP Client](https://docs.rs/reqwest/latest/reqwest/)
- [Serde JSON](https://docs.rs/serde_json/latest/serde_json/)
- [MCP Rust SDK](https://github.com/modelcontextprotocol/rust-sdk)

### React + Vite
- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
