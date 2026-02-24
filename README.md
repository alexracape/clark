# Clark

**Clark is a Socratic tutoring assistant for students.** Instead of giving direct answers, Clark asks guiding questions to help you think through problems - like a good TA would. It seamlessly integrates with handwritten work: write on your iPad while Clark reads and responds from your terminal.

**Documentation:** [alex.racape.com/clark](https://alex.racape.com/clark)

## Features

- **Socratic teaching** - Guides you with questions instead of giving answers
- **Handwritten work support** - Draw on iPad via tldraw canvas, Clark reads your work
- **Local & private** - All data stays on your machine, no cloud storage
- **Multi-LLM support** - Works with Claude, GPT-4, Gemini, or local Ollama models
- **Workspace integration** - Manages notes, resources, and structures in your workspace
- **PDF OCR** - Automatically transcribes scanned PDFs and handwritten documents
- **MCP tools** - Extensible tool system for file operations and canvas interaction

## Installation

**Quick install (macOS/Linux):**
```bash
curl -fsSL https://raw.githubusercontent.com/alexracape/clark/main/install.sh | bash
```

**From source:**
```bash
git clone https://github.com/alexracape/clark
cd clark
bun install
bun run start
```

## Quick Start

```bash
# Start Clark in your workspace
cd ~/Notes/CS229
clark

# First run: onboarding will prompt for LLM provider and API key
# Then start asking questions or open a canvas with /canvas
```

## Development

```bash
# Install dependencies
bun install

# Run in dev mode with hot reload
bun run dev

# Run tests
bun test

# Build binaries
bun run build
```

## Tests

```bash
# Run all tests
bun test

# Run only MCP unit tests
bun test test/mcp.test.ts

# Run MCP integration tests (spawns server over stdio, tests via MCP protocol)
bun test test/mcp-integration.test.ts
```

## PDF OCR Benchmarking

Use the standalone benchmark CLI to exercise the production PDF transcription pipeline (render + OCR) and measure timings.

```bash
# Deterministic local benchmark (no API calls)
bun run bench:pdf-ocr -- \
  --input test/test_vault/Resources/PDFs/lecture_1.pdf \
  --ocr-mode mock \
  --runs 5 \
  --warmup-runs 1

# Full benchmark with real vision OCR
bun run bench:pdf-ocr -- \
  --input test/test_vault/Resources/PDFs/lecture_1.pdf \
  --provider anthropic \
  --model claude-sonnet-4-6 \
  --runs 3 \
  --output test/tmp/transcription.md
```

Useful flags:

- `--page-range 1-3` to benchmark a subset of pages
- `--render-concurrency 4` to pin render workers
- `--dpi 150` to match Vision LLM defaults
- `--quiet` to hide per-page progress logs

The script prints per-run metrics (`render`, `ocr`, `total`) plus summary stats and average pages/sec.

## Slash Commands

Clark supports several built-in commands:

- `/help` - Show available commands
- `/tutorial` - Interactive tutorial for first-time users
- `/canvas` - Open or switch canvas
- `/export [path]` - Export canvas as A4 PDF
- `/model` - Switch LLM model and provider
- `/context` - Show context window usage
- `/compact` - Summarize conversation to save context
- `/feedback <message>` - Send feedback so we can improve
- `/clear` - Clear conversation history
- `/exit` or `/quit` - Exit Clark

## LLM Providers

Clark supports multiple LLM providers. Set via `--provider` flag or during onboarding.

### Anthropic (Claude)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
clark --provider anthropic
```

Default model: `claude-sonnet-4-5-20250929`.

### OpenAI

```bash
export OPENAI_API_KEY=sk-...
clark --provider openai
```

Default model: `gpt-4o`.

### Google Gemini

```bash
export GOOGLE_API_KEY=AI...
clark --provider gemini
```

Default model: `gemini-2.0-flash`. Get an API key at [aistudio.google.com](https://aistudio.google.com).

### Ollama (Local)

Run models locally with [Ollama](https://ollama.com) - no API key needed.

```bash
# Install Ollama
brew install ollama

# Start Ollama server
ollama serve

# Pull a model
ollama pull llama3.2

# Start Clark
clark --provider ollama
```

Default model: `llama3.2`. Clark checks RAM availability before loading models.

## Architecture

Clark consists of three main components:

1. **TUI (Terminal UI)** - Ink-based chat interface on your Mac
2. **Canvas Server** - tldraw WebSocket server for iPad drawing
3. **MCP Server** - Tool system for file operations and canvas interaction

See [SPEC.md](docs/SPEC.md) for detailed architecture documentation.

## MCP Server

Clark exposes tools to the LLM via the [Model Context Protocol](https://modelcontextprotocol.io). The MCP server can also be run standalone over stdio for testing and debugging.

### Standalone server

Start the MCP server pointing at a notes vault:

```bash
bun src/mcp/standalone.ts <vault-dir>

# Example with the test vault
bun src/mcp/standalone.ts test/test_vault
```

### MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is an interactive web UI for testing and debugging MCP servers. It lets you browse tools, call them with custom inputs, and see results.

```bash
# Launch the inspector (opens a web UI)
bunx @modelcontextprotocol/inspector bun src/mcp/standalone.ts test/test_vault

# Or use the shortcut script
bun run inspect -- test/test_vault
```

This starts the standalone MCP server as a subprocess and opens the inspector UI. From there you can:

1. Go to the **Tools** tab to see all registered tools and their schemas
2. Click any tool to test it with custom inputs
3. Verify annotations (readOnlyHint, destructiveHint, etc.) are set correctly
4. Check the **Notifications** pane for server logs

### Inspector CLI mode

For scriptable testing without the web UI:

```bash
# List all tools
bunx @modelcontextprotocol/inspector --cli bun src/mcp/standalone.ts test/test_vault \
  --method tools/list

# Call a specific tool
bunx @modelcontextprotocol/inspector --cli bun src/mcp/standalone.ts test/test_vault \
  --method tools/call --tool-name read_file --tool-arg path=Notes/RLHF.md

# Search notes
bunx @modelcontextprotocol/inspector --cli bun src/mcp/standalone.ts test/test_vault \
  --method tools/call --tool-name search_notes --tool-arg query=reinforcement

# List vault files
bunx @modelcontextprotocol/inspector --cli bun src/mcp/standalone.ts test/test_vault \
  --method tools/call --tool-name list_files
```

### Available Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read markdown, PDF, or image files with wikilink resolution |
| `search_notes` | Keyword search across vault files |
| `list_files` | List vault contents with filtering |
| `create_file` | Create new files in the vault |
| `edit_file` | Find-and-replace editing |
| `read_canvas` | Capture PNG snapshot from iPad canvas |
| `export_pdf` | Export canvas as A4 PDF |
| `save_canvas` | Persist canvas state |
| `transcribe_pdf` | OCR scanned/handwritten PDFs into markdown transcripts |
| `web_search` | Search the web for current information |

## Feedback & Support

- **Send feedback:** Use `/feedback <message>` from within Clark
- **Report issues:** [GitHub Issues](https://github.com/alexracape/clark/issues)
- **Documentation:** [alex.racape.com/clark](https://alex.racape.com/clark)

## Project Structure

See [SPEC.md](docs/SPEC.md) for complete technical specification.
