Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Backlog of future enhancements

- Testing
  - multiline input
  - installing via curl
  - updating with --update
  - theme consistency
  - tool calling and actual usability with good models
  - canvas theme
  - OCR and resource handling in general
  - web search tool

- Add Ollama and Default library to the docs
- Add workflow to publish the site

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
