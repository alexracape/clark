import type { OCRProvider } from "./provider.ts";
import { renderPDFPages, type RenderOptions } from "./pdf-renderer.ts";

export interface TranscriptionProgressEvent {
  phase: "render" | "ocr";
  pageNumber: number;
  completed: number;
  total: number;
}

export interface TranscribePDFOptions {
  /** Value used in markdown frontmatter `source:`. */
  sourcePath: string;
  /** Optional render page range. */
  pageRange?: RenderOptions["pageRange"];
  /** Render DPI (default 150). */
  dpi?: number;
  /** Max parallel render workers. */
  renderConcurrency?: number;
  /** Optional progress callback for render/OCR phases. */
  onProgress?: (event: TranscriptionProgressEvent) => void;
  /** If true, consolidate and deduplicate content across pages (useful for slide decks). */
  consolidate?: boolean;
}

export interface TranscribePDFResult {
  markdown: string;
  pageCount: number;
  metrics: {
    renderMs: number;
    ocrMs: number;
    totalMs: number;
  };
}

export async function transcribePDFToMarkdown(
  pdfPath: string,
  ocrProvider: OCRProvider,
  options: TranscribePDFOptions,
): Promise<TranscribePDFResult> {
  const startedAt = performance.now();

  const renderStartedAt = performance.now();
  const renderedPages = await renderPDFPages(
    pdfPath,
    {
      dpi: options.dpi,
      pageRange: options.pageRange,
      maxConcurrency: options.renderConcurrency,
    },
    (pageNumber, completed, total) => {
      options.onProgress?.({
        phase: "render",
        pageNumber,
        completed,
        total,
      });
    },
  );
  const renderMs = performance.now() - renderStartedAt;

  if (renderedPages.length === 0) {
    throw new Error("No pages were rendered from the PDF.");
  }

  const ocrStartedAt = performance.now();
  const pageTexts: string[] = [];
  for (let i = 0; i < renderedPages.length; i++) {
    const page = renderedPages[i]!;
    const completed = i + 1;
    options.onProgress?.({
      phase: "ocr",
      pageNumber: page.pageNumber,
      completed,
      total: renderedPages.length,
    });
    const text = await ocrProvider.transcribeImage(page.imageBuffer, page.mimeType);
    pageTexts.push(text);
  }
  const ocrMs = performance.now() - ocrStartedAt;

  const now = new Date().toISOString();
  const firstPage = renderedPages[0]!.pageNumber;
  const lastPage = renderedPages[renderedPages.length - 1]!.pageNumber;
  const rangeStr = `${firstPage}-${lastPage}`;

  let markdown =
    `---\nsource: ${options.sourcePath}\n` +
    `generated: ${now}\n` +
    `pages: ${rangeStr}\n` +
    `method: ${ocrProvider.name}\n` +
    "---\n\n";

  for (let i = 0; i < pageTexts.length; i++) {
    markdown += pageTexts[i]!.trim() + "\n\n";
  }

  // Consolidate if requested
  if (options.consolidate && renderedPages.length > 1) {
    const consolidateStartedAt = performance.now();
    options.onProgress?.({
      phase: "ocr",
      pageNumber: renderedPages.length,
      completed: renderedPages.length,
      total: renderedPages.length,
    });

    // Extract just the content (skip frontmatter)
    const contentStart = markdown.indexOf("---\n\n") + 5;
    const frontmatter = markdown.substring(0, contentStart);
    const rawContent = markdown.substring(contentStart);

    const consolidatedContent = await ocrProvider.consolidateTranscript(rawContent);
    markdown = frontmatter + consolidatedContent;

    const consolidateMs = performance.now() - consolidateStartedAt;
    // Add consolidation time to OCR metrics since it's part of the processing
  }

  return {
    markdown,
    pageCount: renderedPages.length,
    metrics: {
      renderMs,
      ocrMs,
      totalMs: performance.now() - startedAt,
    },
  };
}
