Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Session 5: Website distribution

- **Distribution site for desktop binary + docs**
  - Build a lightweight site for downloads, release notes, install instructions, and docs links.
  - Include platform detection hints and checksum/signature visibility.
  - Acceptance: users can discover, download, and verify releases from one place.


## Session 6: Productization + roadmap decisions

- [x] **Default `CLARK.md` scaffold**
  - Shipped default template with workspace layout, tags, file processing, and linking conventions.
  - Updated test_vault CLARK.md to match.

- [x] **Binary build + install script**
  - `bun run build` compiles standalone binaries via `bun build --compile`
  - `scripts/build.ts` supports cross-compilation (`--target`, `--all`) with SHA-256 checksums
  - `install.sh` curl-based installer with platform detection and checksum verification
  - `.github/workflows/release.yml` builds for macOS (arm64/x64) and Linux (x64/arm64) on tag push
  - Version inlined at compile time via `--define CLARK_VERSION`

- **Remaining: Auto-update enhancements**
  - Startup version check (ping GitHub Releases API for newer versions)
  - `clark --update` flag to re-run install script
  - Staged rollout strategy and rollback mechanism

## Session 8: TUI enhancments

- **Color-coded message roles**
  - Apply distinct styles for student/user, Clark/assistant, and system messages.
  - Keep palette accessible in low-contrast terminal environments.
  - Extract the pallette to a place that can be defined globally for the application
  - Avoid color-only meaning by adding role labels or prefixes when needed.
  - Acceptance: role identity is obvious at a glance.

- **Basic Markdown rendering in chat**
  - Render common markdown blocks: headings, bold/italic, inline code, fenced code blocks, lists, links.
  - Ensure graceful fallback for unsupported markdown features.
  - Preserve copy/paste reliability and terminal wrapping behavior.
  - Acceptance: assistant responses are formatted, readable, and stable under long outputs.

- **Multiline input (Shift+Enter)**
  - Enter sends message; Shift+Enter inserts newline.
  - Handle platform/terminal keybinding differences robustly.
  - Keep message editing cursor behavior predictable.
  - Acceptance: users can compose multi-paragraph prompts without accidental sends.


## Backlog of future enhancements

- **Office hours + class notes user stories**
  - Write concrete user journeys (student, TA/instructor) for office hours and notes workflows.
  - Identify required features vs nice-to-have add-ons.
  - Acceptance: prioritized stories that can feed implementation tickets.

- **Test Linux/Windows secret store backends**
  - Add integration tests for LinuxLibsecretStore and WindowsCredentialStore
  - Mock platform-specific CLI commands (`secret-tool`, `cmdkey`, PowerShell)
  - Test get/set/delete operations and fallback behavior
  - Requires CI/CD with Linux/Windows runners or local test devices
  - Acceptance: cross-platform secret storage verified on all target platforms
  
- **Test web search tool Captcha issue**
  - Ensure this doesn't happen regularly and fix accordingly
  - Evaluate usefulness of the results and frequency of use

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

- **Work out kinks in resource upload**
  - If file is drag and dropped first, it is read as a /command
  - Need to add better default prompting to guide tool use and scaffold processing
  - Verify that the poppler methods are working well

- **Consider using CLI tools instead of MCP**
  - Would the model do just as well with some bash commands instead of file tools?

**Known Testing Compromises:**
- ink-testing-library stdin simulation unreliable for interactive flows.
- tldraw sync error cannot be fully suppressed (library internals).
