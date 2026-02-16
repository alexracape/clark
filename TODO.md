Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Session 1: Canvas reliability + export correctness

- **Fix canvas broker cleanup on close (`canvas-session.ts`)**
  - Ensure all pending snapshot/export promises are rejected when a canvas session closes.
  - Prevent memory leaks by unregistering listeners/subscriptions tied to the broker.
  - Add a regression test that closes during an in-flight export and verifies deterministic rejection behavior.
  - Acceptance: no dangling promises after close; no unhandled rejections in normal shutdown path.

- **Auto-delete intermediate blank pages (but never the final page)**
  - Define a consistent blank-page heuristic (no shapes, no strokes, no text, no embedded assets).
  - Apply cleanup during page transitions and/or save checkpoints.
  - Preserve UX safety: never delete the only page, and never delete the current last page automatically.
  - Acceptance: blank pages between non-blank pages are removed; last page remains available as working canvas.

- **Skip trailing empty frames during export**
  - Reuse the same blank-frame heuristic as page cleanup to avoid divergent behavior.
  - Trim trailing blank frames before export pipeline starts.
  - Keep exported page numbering stable and predictable for non-blank pages.
  - Acceptance: exported files do not include trailing blank pages/frames.

- **Canvas reconnect feedback in TUI**
  - Emit clear events for `connecting`, `connected`, `disconnected`, `reconnecting`, and `failed`.
  - Surface status changes as concise TUI notifications (not spammy repeated logs).
  - Include timestamps or sequence IDs in debug logs to aid diagnosis.
  - Acceptance: users can always tell whether iPad/canvas connection is live and recovering.

- **Canvas UI polish and theming pass**
  - Consolidate color/spacing tokens used by canvas-specific components.
  - Acceptance: cohesive visual style and no major contrast/accessibility regressions.

## Session 2: TUI onboarding + core chat UX

- **Welcome screen for first run**
  - Add first-run detection and show a branded ASCII intro screen.
  - Include 2-3 clear “what to do next” steps and key commands.
  - Persist “has seen welcome” flag so it does not reappear each launch.
  - Acceptance: first-time users get guided entry; returning users skip it.

- **Improved onboarding flow**
  - Break onboarding into explicit steps with progress indicator (e.g., model key, workspace, first prompt).
  - Provide positive/negative state feedback per step (success, warning, missing input).
  - Keep copy student-friendly and short.
  - Acceptance: users can complete setup without reading docs.

- **`/tutorial` interactive walkthrough**
  - Implement command-driven mini tutorial that demonstrates: ask question, attach file, use canvas, run slash command.
  - Allow users to skip/exit and resume later.
  - Track completion state for analytics/debugging (if telemetry exists).
  - Acceptance: tutorial runs end-to-end and leaves user in normal chat state.

- **Color-coded message roles**
  - Apply distinct styles for student/user, Clark/assistant, and system messages.
  - Keep palette accessible in low-contrast terminal environments.
  - Avoid color-only meaning by adding role labels or prefixes when needed.
  - Acceptance: role identity is obvious at a glance.

- **Markdown rendering in chat**
  - Render common markdown blocks: headings, bold/italic, inline code, fenced code blocks, lists, links.
  - Ensure graceful fallback for unsupported markdown features.
  - Preserve copy/paste reliability and terminal wrapping behavior.
  - Acceptance: assistant responses are formatted, readable, and stable under long outputs.

- **Improved file ingestion feedback**
  - Show explicit phases: detected -> parsing -> OCR (if applicable) -> indexed -> done/failed.
  - Add spinner/progress indicator and actionable error messages.
  - Surface file name and size so users can confirm the correct file was ingested.
  - Acceptance: users can track ingestion progress without guessing.

- **Add `/quit` and `/exit` commands**
  - Map both commands to graceful shutdown sequence.
  - Reuse same teardown logic as SIGINT where possible.
  - Confirm unsaved state when needed before exiting.
  - Acceptance: command exit path matches Ctrl+C safety guarantees.

- **Multiline input (Shift+Enter)**
  - Enter sends message; Shift+Enter inserts newline.
  - Handle platform/terminal keybinding differences robustly.
  - Keep message editing cursor behavior predictable.
  - Acceptance: users can compose multi-paragraph prompts without accidental sends.

- **Canvas connection status in status bar**
  - Display compact live indicator in status bar (connected/disconnected/reconnecting).
  - Synchronize with reconnect events and avoid stale status.
  - Acceptance: status bar always reflects current canvas connectivity.

## Session 3: Ingestion + OCR + retrieval tools (MCP)

- **Scanned PDF OCR pipeline**
  - Detect low-text PDFs and route to vision OCR/transcription fallback.
  - Keep original file + extracted text side-by-side for auditability.
  - Add retry and timeout strategy for OCR provider failures.
  - Acceptance: scanned/handwritten PDFs become searchable text with clear failure modes.

- **MCP `search_by_tag` tool**
  - Implement tool for Obsidian-style `#tag` queries over indexed notes/documents.
  - Define tag parsing rules (case sensitivity, punctuation boundaries, nested tags).
  - Return structured results with source path/snippet for grounding.
  - Acceptance: `search_by_tag` is discoverable, tested, and useful in normal chat workflows.

- **MCP websearch tool**
  - Add a websearch tool with safe defaults (rate limits, timeout, source filtering if configured).
  - Return concise result objects (title, URL, snippet, timestamp if available).
  - Integrate with tool-call planning so model can choose local context first, then web if needed.
  - Acceptance: tool is stable and produces attributable, linkable results.

- **PDF -> Markdown conversion strategy**
  - Define when conversion runs (eager on ingest vs lazy on first query).
  - Specify storage format and naming conventions for generated markdown artifacts.
  - Include metadata headers (source file, page mapping, OCR confidence if available).
  - Acceptance: deterministic conversion policy documented and implemented.

## Session 4: Architecture + platform hardening

- **Cross-platform secret store support**
  - Add Linux backend via `libsecret` and Windows backend via Credential Manager.
  - Maintain common interface parity with existing macOS keychain implementation.
  - Add graceful fallback path when OS store is unavailable/misconfigured.
  - Acceptance: secrets can be set/get/delete reliably across macOS/Linux/Windows.

- **Standardize filesystem APIs (`node:fs` vs `Bun.file`)**
  - Audit current usage and define preferred patterns per operation type (streaming, metadata, content reads).
  - Refactor for consistency aligned with project guidance in `CLAUDE.md`.
  - Validate no behavior regressions in path handling, encoding, and error mapping.
  - Acceptance: codebase follows one coherent file I/O strategy.

- **Fix `useCallback` dependency arrays in `app.tsx`**
  - Identify incomplete dependency lists (e.g., `runConversationTurn` missing `addMessage`).
  - Refactor callback structure where dependency churn is causing re-render issues.
  - Add lint checks/tests to prevent future stale-closure regressions.
  - Acceptance: hook dependency warnings resolved; behavior stable under repeated interactions.

- **Graceful shutdown**
  - Ensure SIGINT/SIGTERM path saves canvas state and flushes history before process exit.
  - Add timeout guard so shutdown cannot hang indefinitely.
  - Reuse for `/quit` and `/exit` command path.
  - Acceptance: shutdown is safe, bounded, and data-loss resistant.

- **Session persistence (save/resume conversations)**
  - Persist active conversation metadata, transcript state, and relevant tool context.
  - Provide explicit resume behavior on restart (auto-resume or selection prompt).
  - Handle corrupted state file with recover/ignore option.
  - Acceptance: users can resume prior work without manual reconstruction.

- **CLI `--version` flag**
  - Implement `--version` and optional short alias if CLI conventions allow.
  - Print semantic version + build metadata (if available) in machine-parseable format.
  - Ensure command exits successfully without launching full app.
  - Acceptance: version command works in scripts and manual usage.

## Session 5: Test coverage + signal quality

- **Clean up benign tldraw sync test noise**
  - Address `Error assembling message` warning in canvas test by fixing protocol usage or suppressing known-benign output.
  - Keep real failures visible; avoid blanket suppression.
  - Acceptance: test logs are quiet on success and high-signal on failure.

- **Add tests for onboarding and model-picker flows**
  - Cover primary happy path and at least one invalid-input path per flow.
  - Include snapshot/DOM assertions only where stable and meaningful.
  - Acceptance: onboarding/model-picker regressions are caught in CI.

- **Full conversation loop integration test**
  - Add end-to-end test for: send message -> stream -> tool call -> tool result -> continued stream/final response.
  - Assert ordering and state transitions, not just final output string.
  - Acceptance: core chat orchestration has automated regression protection.

- **In-process MCP dispatch tests**
  - Extend `mcp-integration.test.ts` beyond stdio to include in-process dispatch behavior.
  - Validate tool registration, invocation, error propagation, and timeout handling.
  - Acceptance: both stdio and in-proc MCP paths are tested.

- **Error-path coverage**
  - Add tests for network failures, invalid API keys, and corrupt config files.
  - Verify user-facing errors are actionable and do not crash the app.
  - Acceptance: major failure modes are deterministic and covered.

## Session 6: Productization + roadmap decisions

- **Default `CLARK.md` scaffold**
  - Ship a default `CLARK.md` template with practical examples students can customize.
  - Include sections for tone/preferences, course context, and workflow constraints.
  - Include library assumptions like tags, structures, etc
  - Add generation/bootstrap behavior for new workspaces.
  - Acceptance: new users start with a useful, editable baseline config file.

- **Branding documentation + overhaul**
  - Define brand primitives (voice, typography choices, color usage, icon style).
  - Update docs/screens to reflect cohesive identity across CLI/TUI/site.
  - Acceptance: brand guidance is concrete enough for contributors to apply consistently.

- **Lightweight markdown editor exploration (tiptap candidate)**
  - Evaluate if embedding a markdown editor improves note-taking/workflow inside product.
  - Compare footprint, integration complexity, and keyboard accessibility.
  - Provide recommendation with build-vs-buy tradeoffs.
  - Acceptance: documented decision and next action (adopt/defer/reject).

- **Office hours + class notes user stories**
  - Write concrete user journeys (student, TA/instructor) for office hours and notes workflows.
  - Identify required features vs nice-to-have add-ons.
  - Acceptance: prioritized stories that can feed implementation tickets.

- **tldraw licensing review for production**
  - Verify licensing terms for intended distribution/commercial use.
  - Document obligations (attribution, restrictions, paid terms if applicable).
  - Acceptance: legal/licensing go/no-go criteria documented.

- **Desktop GUI direction (Electrobun vs Tauri v2 fallback)**
  - Define evaluation matrix: performance, native integrations, packaging, maintenance cost, team familiarity.
  - Spike both paths enough to derisk major unknowns.
  - Acceptance: explicit platform decision with rationale and migration implications.

- **macOS code signing + notarization in CI/CD**
  - Add Developer ID signing pipeline and notarization step.
  - Validate installer/app launches cleanly on fresh macOS machine without trust warnings.
  - Acceptance: release artifacts pass Gatekeeper checks.

- **Auto-update infrastructure**
  - Implement secure update channel with signature verification.
  - Define rollout strategy (manual/percentage staged rollouts) and rollback mechanism.
  - Acceptance: app can update safely with recovery path on bad release.

- **Distribution site for desktop binary + docs**
  - Build a lightweight site for downloads, release notes, install instructions, and docs links.
  - Include platform detection hints and checksum/signature visibility.
  - Acceptance: users can discover, download, and verify releases from one place.


## Future Enhancements

- **Canvas/PDF mode toggle with explicit export rules**
  - Add a mode toggle in UX/state model between `pdf` and `canvas`.
  - In `canvas` mode, disable or hide PDF export actions and present a short explanation.
  - Ensure mode state is persisted/restored correctly per session.
  - Acceptance: impossible to trigger unsupported export path while in canvas mode.

- **Add /feedback command**
  - Allow users to submit feedback and report issues
  - Figure out where to store this information
