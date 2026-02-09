# clark

Socratic tutoring assistant. See [SPEC.md](SPEC.md) for full details.

## Setup

```bash
bun install
```

## Run

```bash
# Start the full app (TUI + canvas server)
bun run start

# With a notes vault
bun run start -- --notes ~/Notes/CS229

# Dev mode with hot reload
bun run dev
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

## LLM Providers

Clark supports multiple LLM providers. Set via `--provider` flag or during onboarding.

### Anthropic (Claude) — default

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run start -- --provider anthropic
```

Default model: `claude-sonnet-4-5-20250929`. Override with `--model` or `CLARK_MODEL`.

### OpenAI

```bash
export OPENAI_API_KEY=sk-...
bun run start -- --provider openai
```

Default model: `gpt-4o`.

### Google Gemini

```bash
export GOOGLE_API_KEY=AI...
bun run start -- --provider gemini
```

Default model: `gemini-2.0-flash`. Get an API key at [aistudio.google.com](https://aistudio.google.com).

### Ollama (Local)

Run models locally with [Ollama](https://ollama.com) — no API key needed.

```bash
# Install Ollama (macOS)
brew install ollama

# Start the Ollama server
ollama serve

# Pull a model
ollama pull llama3.2

# Start Clark with Ollama
bun run start -- --provider ollama
```

Default model: `llama3.2`. Override with `--model`:

```bash
bun run start -- --provider ollama --model llava
```

Clark checks that the model fits in system RAM before starting. If the model uses more than 80% of RAM, you'll see a warning. If it exceeds total RAM, Clark will exit with an error.

Configure a custom Ollama host via `OLLAMA_HOST`:

```bash
OLLAMA_HOST=http://192.168.1.100:11434 bun run start -- --provider ollama
```

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

### Available tools

| Tool | Description | Annotations |
|------|-------------|-------------|
| `read_file` | Read a file from the vault (markdown with wikilink resolution, PDF text extraction, images as base64) | readOnly |
| `search_notes` | Keyword search across markdown/text files, ranked by match density | readOnly |
| `list_files` | List vault directory contents with optional extension filter | readOnly |
| `create_file` | Create a new file in the vault (fails if exists) | write |
| `edit_file` | Find-and-replace editing in vault files | write, destructive |
| `read_canvas` | Capture a PNG snapshot from the iPad canvas | readOnly |
| `export_pdf` | Export canvas pages as A4 PDF | write |
| `save_canvas` | Persist canvas state to disk | write, idempotent |
