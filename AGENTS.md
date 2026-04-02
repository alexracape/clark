# Clark

Socratic tutoring assistant — Tauri desktop app (macOS) with Bun sidecar, Vercel cloud proxy, and CLI.

## Commands

- **Install:** `bun install`
- **Dev:** `bun --hot index.ts`
- **Test:** `bun test`
- **Typecheck:** `bunx tsc`
- **Lint:** `bun x biome check .`
- **Build desktop:** `cd tauri && cargo build`

## Tech Stack

- **Runtime:** Bun (never Node.js)
- **Package manager:** `bun install`, `bun add` (never npm, pnpm, yarn)
- **Testing:** `bun test` (never vitest, jest)
- **Bundling:** `bun build` (never Webpack, Vite, esbuild)
- **Environment:** Bun loads `.env` automatically — do not use `dotenv`

## Project Structure

```
gui/          React frontend + Tauri integration (desktop app)
core/         ConversationEngine, MCP tools, canvas, library, OCR, embeddings
cloud/        Vercel serverless proxy (deployed separately, has its own package.json)
cli/          Ink-based TUI terminal interface
tauri/        Rust desktop shell (IPC, sidecar lifecycle, window management)
test/         All tests (bun test)
docs/         Architecture (SPEC.md), prompts (PROMPTS.md), GUI (GUI.md), design system
```

## Code Style

### Bun Native APIs (always prefer over Node.js equivalents)

- **HTTP server:** `Bun.serve()` with native routes — never Express
- **Database:** `bun:sqlite` (SQLite), `Bun.sql` (Postgres), `Bun.redis` (Redis)
- **File I/O:** `Bun.file()` — never `node:fs`
- **Shell commands:** `Bun.$` — never `execa` or `child_process`
- **Frontend:** Bun native HTML imports — auto-transpiles TSX/JSX and bundles CSS

## Architecture Docs

- `docs/SPEC.md` — Full technical architecture and data flow
- `docs/PROMPTS.md` — Context window assembly, system prompt, tool definitions
- `docs/GUI.md` — Desktop GUI architecture, React components, Tauri backend
- `docs/TODO.md` — Current backlog and pending tasks
- `docs/design/DESIGN.md` — Brand identity, typography, UI patterns
- `docs/design/COLOR-PALETTE.md` — Source of truth for all colors

## Dependency Documentation

Large reference files live in `docs/dependencies/`. These are for targeted grep searches — never read the full files.

- **tldraw:** Start with `docs/dependencies/tldraw/llms.txt` (index). Grep `llms-docs.txt` for API usage. `llms-full.txt` is grep-only.
- **MCP:** Grep `docs/dependencies/mcp/llms-full.txt` for specific protocol topics.

## GUI Verification

After modifying files under `gui/src/`, verify the UI renders correctly using `agent-browser`:

1. **Start dev server** (if not running): `bun gui/dev-server.ts` — serves at `http://localhost:1420`
2. **Open in browser**: `agent-browser open http://localhost:1420 && agent-browser wait --load networkidle`
3. **Screenshot**: `agent-browser screenshot --annotate` — read the image to visually inspect
4. **Snapshot elements**: `agent-browser snapshot -i` — verify interactive elements are present
5. **Check for errors**: `agent-browser eval 'document.body.innerText.trim().length > 0 ? "HAS_CONTENT" : "BLANK"'`
6. **Clean up**: `agent-browser close`

Run `/verify-gui` for the full verification flow. Always verify after non-trivial GUI changes.

## Boundaries

**Always:**
- Use Bun for everything (runtime, packages, tests, builds)
- Run `bun test` to verify changes
- Run `/verify-gui` (or manual `agent-browser` checks) after GUI changes

**Never:**
- Node.js, npm, pnpm, yarn, Express, dotenv, Webpack, Vite, esbuild
- Read `llms-full.txt` files in their entirety (grep specific symbols instead)
