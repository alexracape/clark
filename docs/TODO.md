Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Backlog of future enhancements

GUI Related
- Inline PDF rendering
- Delete file
- block latex is black on dark background
- Thinking indicator / general spinner
- Animations and micro interactions
- QR code
- /note should auto focus on new note title to rename
- /feedback + enter should not send blank message - cleanly enter
- Graph view in bottom left of explorer
- Issue in resolve links in read tool:
  [embed] [[Resources/Images/FullSizeRender.jpg]] → (not found)
  [embed] [[FullSizeRender.jpg]] → Resources/Images/FullSizeRender.jpg


Core Related
- Keep only most recent canvas screenshot in context
  - We currently keep all saved snapshots even though the old ones are outdated and induce context bloat
- Rename sessions or do this automatically
  - Use LLM generated name with a lightweight prompt and rename based on the first conversation turn
- Bash tool instead of so many MCP tools
  - Reduce redundant file call tools with one standard bash tool
  - Follow industry standards from Anthropic and Google for how to best set this up
- move websearch tool to gateway: https://vercel.com/docs/ai-gateway/capabilities#web-search
  - Reuse existing code and standard tools when possible
- ignore Clark/Sessions from search results
  - Currently old conversation histories show up in Search results
  - This could be useful in some circumstances, but I think we should add a flag or function argument to ignore this directory
- specify no H1 + Title duplication in prompts
  - this applies to ingestion and using defined structures
  - should follow obsidian standard where the filename is displayed at the top of the doc as if it were H1

Low Priority
- Build out telemetry
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
