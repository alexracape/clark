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
