/**
 * PDF text extraction and metadata using poppler CLI tools (pdftotext, pdfinfo).
 *
 * Requires poppler-utils to be installed on the system.
 * See: https://alex.racape.com/clark/dependencies.html#pdf-processing-with-popp
 */

const POPPLER_DOCS_URL =
  "https://alex.racape.com/clark/dependencies.html#pdf-processing-with-popp";

/**
 * Extract text content from a PDF file using pdftotext (poppler).
 */
export async function extractPDFText(filePath: string): Promise<string> {
  const proc = Bun.spawn(["pdftotext", "-layout", filePath, "-"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, text, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`pdftotext failed: ${stderr.trim()}`);
  }
  if (!text.trim()) {
    throw new Error("pdftotext returned empty output");
  }
  return text;
}

/**
 * Get PDF metadata (page count, title) using pdfinfo (poppler).
 */
export async function getPDFInfo(
  filePath: string,
): Promise<{ pages: number; title?: string }> {
  const proc = Bun.spawn(["pdfinfo", filePath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, output, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`pdfinfo failed: ${stderr.trim()}`);
  }

  let pages = 0;
  let title: string | undefined;
  for (const line of output.split("\n")) {
    const pagesMatch = line.match(/^Pages:\s+(\d+)/);
    if (pagesMatch) {
      pages = parseInt(pagesMatch[1]!, 10);
    }
    const titleMatch = line.match(/^Title:\s+(.+)/);
    if (titleMatch) {
      title = titleMatch[1]!.trim() || undefined;
    }
  }

  if (pages === 0) {
    throw new Error("pdfinfo returned no page count");
  }

  return { pages, title };
}

export { POPPLER_DOCS_URL };
