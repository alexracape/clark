Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Backlog of future enhancements

GUI Related
- Inline PDF rendering
- Delete file
- Thinking indicator / general spinner
- More transparency in tool requests, ingestion prompts, progress, etc
- Animations and micro interactions
- QR code
- Graph view in bottom left of explorer
- Filter and polish model selection

Core Related
- Bash tool instead of so many MCP tools
  - Reduce redundant file call tools with one standard bash tool
  - Follow industry standards from Anthropic and Google for how to best set this up
- Check how tool use is handled inside of ingestion
  - Looks to be getting cut-off
  - Ex: Imported Attention Is All You Need 2.pdf → Resources/PDFs/Attention Is All You Need 2.pdf Transcribed Attention Is All You Need 2.pdf and saved to Clark/Transcripts/Attention Is All You Need 2.md. I see there's already an earlier version of this paper in the system. Let me check if there are differences and search for any other relevant machine learning or NLP notes:
- Handle larger files exceeding limit for OCR
- Improved testing

Low Priority
- Build out telemetry
- Add subagents
  - explore tool to start conversations and optimize token usage
  - diagram creation
  - ...
- Optimize small tasks with smaller model
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
