/**
 * PDF page rendering using poppler's pdftoppm.
 *
 * Converts PDF pages to PNG images for OCR processing.
 * Requires poppler-utils to be installed on the system.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";
import { getPDFInfo } from "../mcp/pdf.ts";

export interface RenderOptions {
  /** DPI for rendering (default: 300) */
  dpi?: number;
  /** Page range to render. Omit to render all pages. */
  pageRange?: { start: number; end: number };
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
 * @param onProgress - Optional callback for progress updates (pageNumber, totalPages)
 * @returns Array of rendered page images
 */
export async function renderPDFPages(
  pdfPath: string,
  options: RenderOptions = {},
  onProgress?: (page: number, total: number) => void,
): Promise<RenderedPage[]> {
  const available = await checkPopplerAvailable();
  if (!available) {
    throw new Error(
      "pdftoppm (poppler) is not installed. PDF OCR requires poppler to render pages.\n" +
      getPopplerInstallInstructions(),
    );
  }

  const dpi = options.dpi ?? 300;

  // Get page count to determine range
  const info = await getPDFInfo(pdfPath);
  const totalPages = info.pages;
  const start = options.pageRange?.start ?? 1;
  const end = Math.min(options.pageRange?.end ?? totalPages, totalPages);

  if (start > totalPages) {
    throw new Error(`Start page ${start} exceeds PDF page count (${totalPages}).`);
  }

  // Create temp directory for rendered images
  const tempDir = join(tmpdir(), `clark-pdf-render-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    // Build pdftoppm command
    const args = [
      "-png",
      "-r", String(dpi),
      "-f", String(start),
      "-l", String(end),
      pdfPath,
      join(tempDir, "page"),
    ];

    const proc = Bun.spawn(["pdftoppm", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`pdftoppm failed (exit ${exitCode}): ${stderr.trim()}`);
    }

    // Read rendered images from temp directory
    const files = await readdir(tempDir);
    const pngFiles = files.filter((f) => f.endsWith(".png")).sort();

    const pages: RenderedPage[] = [];
    for (let i = 0; i < pngFiles.length; i++) {
      const pageNumber = start + i;
      onProgress?.(pageNumber, end - start + 1);

      const imagePath = join(tempDir, pngFiles[i]!);
      const imageBuffer = await Bun.file(imagePath).arrayBuffer();
      pages.push({
        pageNumber,
        imageBuffer,
        mimeType: "image/png",
      });
    }

    return pages;
  } finally {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
