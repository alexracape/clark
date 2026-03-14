A file has been added to the user's library. The file has already been copied and transcribed. Your job is to link it into the user's existing notes.

## File Info
- **File:** {{fileName}}
- **Location:** {{destPath}}
- **Transcript saved to:** Clark/Transcripts/{{baseName}}.md

## File Content
{{fileContent}}

## Current Conversation Context
{{conversationContext}}

## Instructions

1. **Find related notes** — use `search_notes` and `list_files` to find documents related to this file's content and the current conversation context.

2. **Link to related notes** — if a relevant class page, topic note, or structure file exists, use `edit_file` to add a wikilink (`[[{{destPath}}]]`) in the appropriate section (e.g., under ## Homework, ## Slides, ## Resources). If it makes sense to imbed the resource, use `![[{{destPath}}]]`.

3. **Return a brief summary** of what you did (1-2 sentences). If no related notes were found, say so.

Be conservative with edits — only link where the relationship is obvious. Do not create new structure files unless the user has explicitly asked.
