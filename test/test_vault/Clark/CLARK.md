# CLARK.md

Add context about your courses, preferences, and workflow here.
Clark reads this file at startup and uses it to personalize responses.

## Workspace Layout

- `Notes/` — Markdown notes, one file per topic
- `Resources/` — Raw documents (not markdown)
  - `Resources/Images/` — Screenshots, diagrams, photos
  - `Resources/PDFs/` — PDF documents
  - `Resources/Transcriptions/` — Markdown transcriptions of resources
- `Templates/` — Reusable note templates
- `Clark/Canvas/` — tldraw canvas files (.tldr)
- `Clark/Structures/` — Structure definitions that guide how Clark creates files

## Tags

- `#class` — A course or class
- `#problem_set` — A homework assignment or problem set
- `#paper` — An academic paper
- `#quote` — A quote
- `#idea` — An atomic idea or concept

## File Processing Conventions

When processing files added to Resources/:
- Save transcriptions to `Resources/Transcriptions/<source-name>.md`
- Include YAML frontmatter with source path, timestamp, and page range
- For scanned/handwritten PDFs, use OCR via `transcribe_pdf`
- For text-based PDFs, extract text directly via `read_file`

## Linking Conventions

- Use `[[wikilinks]]` to connect related notes
- Use `![[embeds]]` to embed images or other files inline
- When creating new files, link them to relevant classes or topics
