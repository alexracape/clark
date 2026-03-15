/**
 * Markdown-aware text chunking for embedding.
 *
 * Splits content on paragraph boundaries, respects heading hierarchy,
 * and prepends parent headings for context.
 */

export interface Chunk {
  /** Chunk content (heading prefix + paragraph text). */
  text: string;
  /** Position index within the source file. */
  index: number;
}

const DEFAULT_MAX_CHARS = 2000;
const MIN_CHUNK_CHARS = 50;

/**
 * Chunk markdown content into embedding-sized pieces.
 *
 * Strategy:
 * 1. Split on double newlines (paragraph boundaries)
 * 2. Headings are hard boundaries — never merge across them
 * 3. Merge adjacent paragraphs up to maxChars
 * 4. Prepend the nearest parent heading to each chunk
 * 5. Skip trivially short chunks (< 50 chars)
 */
export function chunkMarkdown(content: string, maxChars = DEFAULT_MAX_CHARS): Chunk[] {
  if (!content.trim()) return [];

  const blocks = content.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let currentHeading = "";
  let buffer = "";
  let chunkIndex = 0;

  function flush() {
    const text = buffer.trim();
    if (text.length < MIN_CHUNK_CHARS) {
      buffer = "";
      return;
    }
    const prefixed = currentHeading && !text.startsWith(currentHeading)
      ? `${currentHeading}\n\n${text}`
      : text;
    chunks.push({ text: prefixed, index: chunkIndex++ });
    buffer = "";
  }

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const isHeading = /^#{1,6}\s/.test(trimmed);

    if (isHeading) {
      // Flush anything accumulated before this heading
      flush();
      currentHeading = trimmed.split("\n")[0]!;
      buffer = trimmed;
      // Flush the heading block immediately so it starts a new chunk
      flush();
    } else {
      // Would appending exceed max size?
      const candidate = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
      if (candidate.length > maxChars && buffer) {
        flush();
        buffer = trimmed;
      } else {
        buffer = candidate;
      }
    }
  }

  // Flush remaining
  flush();

  return chunks;
}
