Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Backlog of future enhancements

General
- Inline PDF rendering
- Delete file
- Keep only most recent canvas screenshot in context
- Rename sessions or do this automatically
- Bash tool instead of so many MCP tools
- build out telemetry
- move websearch tool to gateway: https://vercel.com/docs/ai-gateway/capabilities#web-search
- ignore Clark/Sessions from search results
- specify no H1 + Title duplication in prompts
- block latex is black on dark background

Polish
- Thinking indicator / general spinner
- Animations and micro interactions
- QR code
- /note should auto focus on new note title to rename
- /feedback + enter should not send blank message - cleanly enter
- Graph view in bottom left of explorer
- Context visualization missing tool definitions


Bugs
- Issue in resolve links in read tool:
  [embed] [[Resources/Images/FullSizeRender.jpg]] → (not found)
  [embed] [[FullSizeRender.jpg]] → Resources/Images/FullSizeRender.jpg

Low Priority
- Add explore tool to start conversations and optimize token usage
- Optimize small tasks with smaller model
- Tavily option for websearch?
  - Seems like a good fit, but don't want users to worry about another setup step
- Add lines to the pdf pages optionally
- Fix windows tests (3)
- Transition architecture to Rust

- **Office hours + class notes user stories**
  - Write concrete user journeys (student, TA/instructor) for office hours and notes workflows.
  - Identify required features vs nice-to-have add-ons.
  - Acceptance: prioritized stories that can feed implementation tickets.

- **tldraw licensing review for production**
  - Verify licensing terms for intended distribution/commercial use.
  - Document obligations (attribution, restrictions, paid terms if applicable).
  - Acceptance: legal/licensing go/no-go criteria documented.
