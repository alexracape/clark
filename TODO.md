Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Session 3: Ingestion + OCR

- **Scanned PDF OCR pipeline**
  - Detect low-text PDFs and route to vision OCR/transcription fallback.
  - Keep original file + extracted text side-by-side for auditability.
  - Add retry and timeout strategy for OCR provider failures.
  - Acceptance: scanned/handwritten PDFs become searchable text with clear failure modes.

- **Improved file ingestion feedback**
  - Show explicit phases: detected -> parsing -> OCR (if applicable) -> indexed -> done/failed.
  - Add spinner/progress indicator and actionable error messages.
  - Surface file name and size so users can confirm the correct file was ingested.
  - Acceptance: users can track ingestion progress without guessing.

- **PDF -> Markdown conversion strategy**
  - Define when conversion runs (eager on ingest vs lazy on first query).
  - Specify storage format and naming conventions for generated markdown artifacts.
  - Include metadata headers (source file, page mapping, OCR confidence if available).
  - Acceptance: deterministic conversion policy documented and implemented.

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

- **Office hours + class notes user stories**
  - Write concrete user journeys (student, TA/instructor) for office hours and notes workflows.
  - Identify required features vs nice-to-have add-ons.
  - Acceptance: prioritized stories that can feed implementation tickets.

- **Auto-update infrastructure**
  - Implement secure update channel with signature verification.
  - Define rollout strategy (manual/percentage staged rollouts) and rollback mechanism.
  - Acceptance: app can update safely with recovery path on bad release.

- **Distribution site for desktop binary + docs**
  - Build a lightweight site for downloads, release notes, install instructions, and docs links.
  - Include platform detection hints and checksum/signature visibility.
  - Acceptance: users can discover, download, and verify releases from one place.

## Session 7: MCP Tools

- **MCP `search_by_tag` tool**
  - Implement tool for Obsidian-style `#tag` queries over indexed notes/documents.
  - Define tag parsing rules (case sensitivity, punctuation boundaries, nested tags).
  - Return structured results with source path/snippet for grounding.
  - Acceptance: `search_by_tag` is discoverable, tested, and useful in normal chat workflows.

- **MCP websearch tool**
  - Add a websearch tool with safe defaults (rate limits, timeout, source filtering if configured).
  - Return concise result objects (title, URL, snippet, timestamp if available).
  - Integrate with tool-call planning so model can choose local context first, then web if needed.
  - Should follow standard production equivalents
  - Acceptance: tool is stable and produces attributable, linkable results.

## Session 8: TUI enhancments

- **Color-coded message roles**
  - Apply distinct styles for student/user, Clark/assistant, and system messages.
  - Keep palette accessible in low-contrast terminal environments.
  - Extract the pallette to a place that can be defined globally for the application
  - Avoid color-only meaning by adding role labels or prefixes when needed.
  - Acceptance: role identity is obvious at a glance.

- **Markdown rendering in chat**
  - Render common markdown blocks: headings, bold/italic, inline code, fenced code blocks, lists, links.
  - Ensure graceful fallback for unsupported markdown features.
  - Preserve copy/paste reliability and terminal wrapping behavior.
  - Acceptance: assistant responses are formatted, readable, and stable under long outputs.

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


## Backlog of future enhancements

- **Test Linux/Windows secret store backends**
  - Add integration tests for LinuxLibsecretStore and WindowsCredentialStore
  - Mock platform-specific CLI commands (`secret-tool`, `cmdkey`, PowerShell)
  - Test get/set/delete operations and fallback behavior
  - Requires CI/CD with Linux/Windows runners or local test devices
  - Acceptance: cross-platform secret storage verified on all target platforms

- **Add /feedback command**
  - Allow users to submit feedback and report issues
  - Figure out where to store this information

- **Canvas UI polish and theming pass**
  - Consolidate color/spacing tokens used by canvas-specific components.
  - Acceptance: cohesive visual style and no major contrast/accessibility regressions.

- **QR Code for Canvas URL**
  - Add QR code functionality to streamline iPad joining

- **Session persistence (save/resume conversations)**
  - Persist active conversation metadata, transcript state, and relevant tool context.
  - Provide explicit resume behavior on restart (auto-resume or selection prompt).
  - Handle corrupted state file with recover/ignore option.
  - Acceptance: users can resume prior work without manual reconstruction.

- **Lightweight markdown editor exploration (tiptap candidate)**
  - Evaluate if embedding a markdown editor improves note-taking/workflow inside product.
  - Compare footprint, integration complexity, and keyboard accessibility.
  - Provide recommendation with build-vs-buy tradeoffs.
  - Acceptance: documented decision and next action (adopt/defer/reject).

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
