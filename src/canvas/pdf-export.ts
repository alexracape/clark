/**
 * PDF export — composes page PNG images into an A4 multi-page PDF.
 *
 * Receives base64 PNG images (one per page) from the iPad client
 * and assembles them into a PDF using pdf-lib.
 */

import { PDFDocument } from "pdf-lib";

/** A4 dimensions in points (72 DPI) */
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

export interface PageImage {
  name: string;
  /** Base64-encoded PNG data */
  png: string;
}

/**
 * Compose multiple page images into a single A4 PDF.
 * Each image is scaled to fit the A4 page while preserving aspect ratio.
 */
export async function composePDF(pages: PageImage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  for (const pageImg of pages) {
    const pngBytes = Buffer.from(pageImg.png, "base64");
    const image = await doc.embedPng(pngBytes);

    const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    const { width: imgWidth, height: imgHeight } = image.size();

    // Scale to fit A4 while preserving aspect ratio
    const scale = Math.min(A4_WIDTH / imgWidth, A4_HEIGHT / imgHeight);
    const scaledWidth = imgWidth * scale;
    const scaledHeight = imgHeight * scale;

    // Center on page
    const x = (A4_WIDTH - scaledWidth) / 2;
    const y = (A4_HEIGHT - scaledHeight) / 2;

    page.drawImage(image, {
      x,
      y,
      width: scaledWidth,
      height: scaledHeight,
    });
  }

  return doc.save();
}

/**
 * Export pages to a PDF file on disk.
 */
export async function exportPDFToFile(pages: PageImage[], outputPath: string): Promise<string> {
  const pdfBytes = await composePDF(pages);
  await Bun.write(outputPath, pdfBytes);
  return outputPath;
}
