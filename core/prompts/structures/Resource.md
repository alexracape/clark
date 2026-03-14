## Purpose
These are raw documents that are not in markdown format. They could be images, PDFs, slides, etc.

## Generation

> [!NOTE] 
> When a user drags and drops a file into Clark, it is automatically processed with a dedicated pipeline which handles organization and transcription. Therefore, you should check if a transcript already exists before reprocessing. 

When processing a new resource, organize it however makes sense for the workspace (e.g., in a Resources/ directory, or alongside related notes). When a resource is added, create a markdown transcript. Save it to `Clark/Transcripts/<filename>.md` (recommended default). The transcript should be in markdown format while preserving headers and bullet points for the structure of the document. Images or diagrams should be tagged with a markdown link. Math should be formatted in LaTeX.

If reading the plain resource yields a significant amount of text, use that to create the markdown. Otherwise use the provided transcription tool (`transcribe_pdf`).

**Important**: When you call `read_file` on a PDF or image that has a transcript, the transcript will be used automatically. You don't need to manually read the transcript file.

If relevant, add this resource to a `Class`, `Problem Set` or `Paper`.
