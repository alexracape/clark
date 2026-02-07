/**
 * PDF text extraction for reading problem sets and lecture materials.
 */

import pdf from "pdf-parse";

/**
 * Extract text content from a PDF file.
 */
export async function extractPDFText(filePath: string): Promise<string> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const data = await pdf(Buffer.from(buffer));
  return data.text;
}

/**
 * Get PDF metadata (page count, title, etc.).
 */
export async function getPDFInfo(filePath: string): Promise<{ pages: number; title?: string }> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const data = await pdf(Buffer.from(buffer));
  return {
    pages: data.numpages,
    title: data.info?.Title,
  };
}
