---
description: Critical project constraints, Bun-native workflow, and local SDK reference paths.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json, docs/dependencies/**/*.txt"
alwaysApply: true
---

# Project Guidelines

## Core Tech Stack
- **Runtime:** Always use **Bun** instead of Node.js.
- **Package Manager:** Use `bun install`, `bun add`, and `bun run`.
- **Testing:** Use `bun test`.
- **Bundling:** Use `bun build` (No Webpack/Vite/Esbuild).
- **Environment:** Bun loads `.env` automatically; do not use `dotenv`.

## Project Documentation & Planning
- **Roadmap:** Consult `TODO.md` for pending tasks and future enhancements.
- **Specification:** Refer to `SPEC.md` for the overall project architecture and logic.
- **Context Management:** After completing a task, update `TODO.md` and `SPEC.md` if any key components have changed.

## External Dependencies Documentation
The repo contains documentation for some dependencies as plain text.
To minimize context window bloat for these large files, use `grep` or read specific snippets rather than the full files unless necessary.

### tldraw SDK (`docs/dependencies/tldraw/`)
- **Primary Entry:** `llms.txt` (Index of resources).
- **Features:** `llms-docs.txt` (Standard usage).
- **Agentic/Canvas:** `llms-agent-kit.txt` (Visual understanding).
- **Deep Reference:** `llms-full.txt` (Complex troubleshooting only).

### Model Context Protocol (`docs/dependencies/mcp/`)
- **Reference:** `llms-full.txt` (Full spec, lifecycle, and tools).

---

## Technical Patterns & APIs

### Bun Native APIs (Preferred)
- **Server:** `Bun.serve()` with native routes. **Do not use Express.**
- **Database:** `bun:sqlite` (SQLite), `Bun.sql` (Postgres), `Bun.redis` (Redis).
- **I/O:** `Bun.file()` instead of `node:fs`.
- **Shell:** `Bun.$` instead of `execa` or `child_process`.

### Frontend Workflow
Use Bun’s native HTML imports. Bun automatically transpiles `.tsx`/`.jsx` and bundles CSS.

Development Commands
Run Dev: bun --hot index.ts
Install: bun install
Test: bun test
Lint/Format: bun x biome check . (if applicable)
