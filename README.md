# Clark

**Clark is a Socratic tutoring assistant for students.** Instead of giving direct answers, Clark asks guiding questions to help you think through problems — like a good TA would. Write on your iPad while Clark reads your work and responds in the desktop app.

**Documentation:** [alex.racape.com/clark](https://alex.racape.com/clark)

## Features

- **Socratic teaching** — Guides you with questions instead of giving answers
- **Handwritten work support** — Draw on iPad via tldraw canvas; Clark reads your work
- **Zero-config** — No API keys needed. Clark Cloud handles everything out of the box
- **Workspace integration** — Manages notes, resources, and structures in your workspace
- **PDF OCR** — Automatically transcribes scanned PDFs and handwritten documents
- **Semantic search** — Finds notes by meaning, not just keywords
- **Local option** — Power users can run fully local via Ollama

## Installation

**Desktop app (macOS):**
Download the latest build from [GitHub Releases](https://github.com/alexracape/clark/releases/latest).

**CLI install (macOS/Linux):**
```bash
curl -fsSL https://raw.githubusercontent.com/alexracape/clark/main/install.sh | bash
```

**From source:**
```bash
git clone https://github.com/alexracape/clark
cd clark
bun install
bun run dev
```

## Quick Start

**Desktop app:** Open Clark, complete the one-time onboarding, and start asking questions.

**CLI:**
```bash
# Run from your workspace directory
cd ~/Notes/CS229
clark
```

On first run, Clark scaffolds the workspace and auto-configures with Clark Cloud defaults — no provider selection or API key entry required.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/tutorial` | Interactive tutorial for first-time users |
| `/canvas` | Open or switch canvas |
| `/export [path]` | Export canvas as A4 PDF |
| `/model` | Switch LLM model and provider |
| `/context` | Show context window usage |
| `/compact` | Summarize conversation to save context |
| `/resume` | Restore a past session |
| `/feedback <message>` | Send feedback to the developer |
| `/clear` | Clear conversation history |
| `/exit` or `/quit` | Exit Clark |

## Local / Offline Mode

For users who prefer to keep everything on-device, Clark supports [Ollama](https://ollama.com) as a local LLM and embedding provider:

```bash
# Install and start Ollama
brew install ollama
ollama serve
ollama pull llama3.2
```

Configure via the Settings panel in the GUI, or with `--provider ollama` in the CLI.

## Development

```bash
# Install dependencies
bun install

# Run in dev mode
bun run dev

# Run tests
bun test

# Build CLI binaries
bun run build
```

## Architecture

Clark consists of:

1. **GUI (Tauri desktop app)** — React frontend + Bun sidecar HTTP server + Rust Tauri backend
2. **Clark Cloud** — Vercel serverless proxy for LLM, OCR, and embedding (no API keys needed)
3. **Canvas Server** — tldraw WebSocket server the iPad connects to over LAN
4. **MCP Tools** — Tool system for file operations, canvas interaction, and web search
5. **CLI (TUI)** — Ink-based terminal interface for power users

See [docs/SPEC.md](docs/SPEC.md) for complete technical specification.

## MCP Server

Clark exposes tools to the LLM via the [Model Context Protocol](https://modelcontextprotocol.io). The MCP server can be run standalone for testing.

```bash
# Standalone MCP server
bun core/mcp/standalone.ts test/test_vault

# Test with MCP Inspector
bunx @modelcontextprotocol/inspector bun core/mcp/standalone.ts test/test_vault
```

**Available tools:** `read_file`, `search_notes`, `list_files`, `create_file`, `edit_file`, `read_canvas`, `export_pdf`, `save_canvas`, `transcribe_pdf`, `web_search`

## PDF OCR Benchmarking

```bash
# Deterministic local benchmark (no API calls)
bun run bench:pdf-ocr -- \
  --input test/test_vault/Resources/PDFs/lecture_1.pdf \
  --ocr-mode mock \
  --runs 5

# Full benchmark with real OCR
bun run bench:pdf-ocr -- \
  --input test/test_vault/Resources/PDFs/lecture_1.pdf \
  --provider anthropic \
  --model claude-sonnet-4-6 \
  --runs 3
```

Flags: `--page-range 1-3`, `--render-concurrency 4`, `--dpi 150`, `--quiet`

## Feedback & Support

- **In-app:** `/feedback <message>`
- **Issues:** [GitHub Issues](https://github.com/alexracape/clark/issues)
- **Docs:** [alex.racape.com/clark](https://alex.racape.com/clark)
