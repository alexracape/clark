# CLARK.md

Add context about your courses, preferences, and workflow here.
Clark reads this file at startup and uses it to personalize responses.

## Workspace Layout

- `Notes/` — Markdown notes, one file per topic
- `Resources/` — Raw documents (not markdown)
  - `Resources/Images/` — Screenshots, diagrams, photos
  - `Resources/PDFs/` — PDF documents
- `Templates/` — Reusable note templates
- `Clark/Canvas/` — tldraw canvas files (.tldr)
- `Clark/Structures/` — Structure definitions that guide how Clark creates files
- `Clark/Transcripts/` — Markdown transcripts of PDFs and images

## Tags

- `#class` — A course or class
- `#problem_set` — A homework assignment or problem set
- `#paper` — An academic paper
- `#quote` — A quote
- `#idea` — An atomic idea or concept

## File Processing Conventions

When processing PDFs and images:
- Save transcripts to `Clark/Transcripts/<source-name>.md`
- Include YAML frontmatter with source path, timestamp, and page range
- For scanned/handwritten PDFs, use OCR via `transcribe_pdf`
- For text-based PDFs, extract text directly via `read_file`
- For markdown notes and transcripts, the filename already acts as the visible note title, so do not start the body with a duplicate H1 unless the user explicitly asks for one

**Auto-detection**: When you call `read_file` on a PDF or image, Clark automatically checks for a markdown transcript and uses it if available. Transcripts are found by checking:
1. Same directory with .md extension (e.g., `Resources/PDFs/lecture.pdf` → `Resources/PDFs/lecture.md`)
2. Clark transcripts directory (e.g., any PDF/image → `Clark/Transcripts/<filename>.md`)

## Linking Conventions

- Use `[[wikilinks]]` to connect related notes
- Use `![[embeds]]` to embed images or other files inline
- When creating new files, link them to relevant classes or topics
