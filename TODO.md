Some future enhancements and things that need fixing.

## Security

- **Cross-platform secret stores (follow-up)** — macOS Keychain is implemented, but Linux (`libsecret`) and Windows (`Credential Manager`) backends are still missing.

## Refactoring

- **Mutable module-level state in `input.tsx`** — `COMMANDS` is a mutable `let` export modified by `registerCommands()`. This makes testing fragile and couples module state to app lifecycle. Refactor to pass commands as a prop or use React context.
- **Duplicated tool type definitions** — `ToolDefinition` in `mcp/tools.ts` and `Tool` in `llm/provider.ts` are nearly identical but separate types. Unify into a single shared type.
- **`buildFileIndex()` called on every `read_file`** — Each wikilink resolution rebuilds the full vault file index via `readdir(recursive)`. Cache the index per session or use a file watcher.
- **`searchDirectory()` reads every file sequentially** — The search tool reads all `.md`/`.txt` files one by one. Use `Promise.all` with concurrency limits or leverage Bun's fast I/O for parallel reads.
- **`node:fs` vs `Bun.file` inconsistency** — The codebase mixes `readdir`/`stat` from `node:fs/promises` with `Bun.file()` for content reads. Standardize on Bun APIs where possible per CLAUDE.md guidelines.
- **Gemini tool result passes `toolUseId` as function name** — In `gemini.ts:158`, `functionResponse.name` is set to `c.toolUseId` (a UUID) instead of the actual tool name. This may confuse the model when correlating results.
- **OpenAI/Gemini tool results lose image content** — Both providers convert image tool results to the string `"[image]"` instead of passing base64 data. This means canvas snapshots returned as tool results won't work with these providers.
- **Ollama `supportsVision` is hardcoded `true`** — Not all Ollama models support vision. Check model capabilities at runtime (e.g., from `ollama.show()` metadata).
- **`canvas-session.ts` doesn't clean up broker on close** — When closing a canvas, pending snapshot/export promises are left dangling. Reject them on close.
- **`app.tsx` callback dependency arrays** — Several `useCallback` hooks have incomplete dependency arrays (e.g., `runConversationTurn` doesn't list `addMessage`). This can cause stale closures.

## Canvas

- Styling — canvas UI polish, theming
- Allow users to toggle between PDF and Canvas mode
  - Export as PDF would not be allowed for Canvas mode
- Automatically delete intermediate blank pages if they are not last
- Export should skip trailing empty frames (currently exports blank pages)
- Canvas reconnect feedback — show a message in TUI when iPad disconnects/reconnects

## LLMs

- Add default CLARK.md file with example content guiding students on how to customize
- Handle `max_tokens` stop reason — currently not surfaced to user when response is truncated
- Streaming error recovery — if a stream fails mid-response, show partial text and an error
- Anthropic provider hardcodes `max_tokens: 4096` — make configurable or use model defaults

## MCP

- Add `rename_file` tool — currently no way for the LLM to rename notes
- Add `delete_file` tool (with confirmation) — structures workflow sometimes needs cleanup
- Adding a `search_by_tag` tool for Obsidian-style `#tag` queries
- Add websearch tool
- Consider how / when to convert PDF to markdown files with OCR

## TUI

- `/resource` needs to accept file upload with file explorer, drag-and-drop, or something
- Need to refine the /structures (skills) commands
  - The model's responses are too verbose and need prompting work
  - Should look into ways to collect args like a conversational process
  - Consider removing them from the UI and having Model do this with NLU
- Markdown rendering in chat — assistant responses are raw text, should render bold/headers/code
- Add a `/quit` or `/exit` command as alternative to Ctrl+C
- Input multiline support — allow Shift+Enter for multi-line messages

## Testing

- Canvas test emits a benign `Error assembling message` from tldraw sync — clean up by using proper protocol messages or suppressing in test output
- No tests for `onboarding.tsx` or `model-picker.tsx` flows
- No integration test that exercises the full conversation loop (send message → stream → tool call → result → next stream)
- `mcp-integration.test.ts` only tests standalone stdio — add tests for in-process tool dispatch
- Add tests for error paths (network failures, invalid API keys, corrupt config files)

## Misc.

- Lightweight markdown editor potentially with tiptap
- Office hours and class notes stories
- Look into tldraw licensing for production distribution
- Build site to publish the binary with documentation
- Branding documentation and overhaul
- React UI instead of TUI? — evaluate if Electron/Tauri shell improves UX
- Add `--version` flag to CLI args
- Add graceful shutdown — save canvas state and flush history on SIGINT/SIGTERM
- Consider session persistence (save/resume conversations across launches)
