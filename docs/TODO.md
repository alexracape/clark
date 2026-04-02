Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Backlog of future enhancements

GUI Related
- Inline PDF rendering
- Delete file
- Thinking indicator / general spinner
- Animations and micro interactions
- QR code
- Graph view in bottom left of explorer


Core Related
- Bash tool instead of so many MCP tools
  - Reduce redundant file call tools with one standard bash tool
  - Follow industry standards from Anthropic and Google for how to best set this up

Low Priority
- Build out telemetry
- Add explore tool to start conversations and optimize token usage
- Optimize small tasks with smaller model
- Tavily option for websearch?
  - Seems like a good fit, but don't want users to worry about another setup step
- Add lines to the pdf pages optionally
- Fix windows tests (3)
- Transition architecture to Rust
- Keep only most recent canvas screenshot in context

- **Office hours + class notes user stories**
  - Write concrete user journeys (student, TA/instructor) for office hours and notes workflows.
  - Identify required features vs nice-to-have add-ons.
  - Acceptance: prioritized stories that can feed implementation tickets.

- **tldraw licensing review for production**
  - Verify licensing terms for intended distribution/commercial use.
  - Document obligations (attribution, restrictions, paid terms if applicable).
  - Acceptance: legal/licensing go/no-go criteria documented.
