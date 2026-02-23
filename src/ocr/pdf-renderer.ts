/**
 * PDF page rendering using poppler's pdftoppm.
 *
 * Converts PDF pages to PNG images for OCR processing.
 * Requires poppler-utils to be installed on the system.
 */

import { cpus } from "node:os";
import { getPDFInfo } from "../mcp/pdf.ts";

export interface RenderOptions {
  /** DPI for rendering (default: 150) */
  dpi?: number;
  /** Page range to render. Omit to render all pages. */
  pageRange?: { start: number; end: number };
  /** Max parallel render workers. Defaults to cpus().length - 1 (minimum 1). */
  maxConcurrency?: number;
}

export interface RenderedPage {
  pageNumber: number;
  imageBuffer: ArrayBuffer;
  mimeType: "image/png";
}

/**
 * Check whether pdftoppm (poppler) is available on this system.
 */
export async function checkPopplerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["pdftoppm", "-v"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get platform-specific install instructions for poppler.
 */
export function getPopplerInstallInstructions(): string {
  const platform = process.platform;
  switch (platform) {
    case "darwin":
      return "Install poppler with: brew install poppler";
    case "linux":
      return "Install poppler with: sudo apt install poppler-utils  (or equivalent for your distro)";
    case "win32":
      return "Install poppler from: https://github.com/oschwartz10612/poppler-windows/releases";
    default:
      return "Install poppler-utils for your platform: https://poppler.freedesktop.org/";
  }
}

/**
 * Render PDF pages to PNG images using pdftoppm.
 *
 * @param pdfPath - Absolute path to the PDF file
 * @param options - Rendering options (DPI, page range)
 * @param onProgress - Optional callback for progress updates (pageNumber, completed, totalPages)
 * @returns Array of rendered page images
 */
export async function renderPDFPages(
  pdfPath: string,
  options: RenderOptions = {},
  onProgress?: (pageNumber: number, completed: number, total: number) => void,
): Promise<RenderedPage[]> {
  const available = await checkPopplerAvailable();
  if (!available) {
    throw new Error(
      "pdftoppm (poppler) is not installed. PDF OCR requires poppler to render pages.\n" +
        getPopplerInstallInstructions(),
    );
  }

  const dpi = options.dpi ?? 150;

  // Get page count to determine range
  const info = await getPDFInfo(pdfPath);
  const totalPages = info.pages;
  const start = options.pageRange?.start ?? 1;
  const end = Math.min(options.pageRange?.end ?? totalPages, totalPages);
  const totalToRender = end - start + 1;

  if (start > totalPages) {
    throw new Error(
      `Start page ${start} exceeds PDF page count (${totalPages}).`,
    );
  }
  const defaultConcurrency = Math.max(1, cpus().length - 1);
  const requestedConcurrency = options.maxConcurrency ?? defaultConcurrency;
  const maxWorkers = Math.max(1, Math.floor(requestedConcurrency));
  const workers = Math.min(maxWorkers, totalToRender);
  const pageNumbers = Array.from(
    { length: totalToRender },
    (_, idx) => start + idx,
  );

  const renderedByPage = new Map<number, RenderedPage>();
  let nextPageIdx = 0;
  let completed = 0;

  const renderSinglePage = async (pageNumber: number): Promise<ArrayBuffer> => {
    const args = [
      "-png",
      "-singlefile",
      "-r",
      String(dpi),
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      pdfPath,
    ];

    const proc = Bun.spawn(["pdftoppm", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, imageBuffer, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `pdftoppm failed for page ${pageNumber} (exit ${exitCode}): ${stderr.trim()}`,
      );
    }
    if (imageBuffer.byteLength === 0) {
      throw new Error(`pdftoppm returned empty output for page ${pageNumber}.`);
    }
    return imageBuffer;
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = nextPageIdx++;
      if (idx >= pageNumbers.length) return;

      const pageNumber = pageNumbers[idx]!;
      const imageBuffer = await renderSinglePage(pageNumber);
      renderedByPage.set(pageNumber, {
        pageNumber,
        imageBuffer,
        mimeType: "image/png",
      });
      completed += 1;
      onProgress?.(pageNumber, completed, totalToRender);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return pageNumbers.map((pageNumber) => {
    const rendered = renderedByPage.get(pageNumber);
    if (!rendered) {
      throw new Error(`Missing rendered output for page ${pageNumber}.`);
    }
    return rendered;
  });
}
