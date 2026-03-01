/**
 * File ingestion — detect file paths in user input and copy to Resources/.
 *
 * Processing (text extraction, OCR, transcription) is handled by the model
 * using MCP tools (read_file, transcribe_pdf, create_file) rather than
 * a hardcoded pipeline.
 */

import { basename, join, resolve } from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { expandPath } from "../library.ts";
import { isImageFile, isPDFFile } from "../mcp/vault.ts";

export interface CopyResult {
  /** Display name of the file */
  fileName: string;
  /** Where the file was copied to (relative to workspace) */
  destPath: string;
  /** Human-readable file size */
  fileSize: string;
  /** Brief summary of what was done */
  summary: string;
}

/**
 * Detect whether user input is a file path.
 * Returns the resolved absolute path if it points to an existing file, null otherwise.
 */
export async function detectFilePath(input: string): Promise<string | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Skip short inputs that are likely chat messages, not paths
  // Slash commands (e.g., /help) are handled separately in handleSubmit,
  // but detectFilePath runs first, so we filter out obvious non-paths.
  // A valid file path must contain a path separator or start with ~ or .
  if (!trimmed.includes("/") && !trimmed.includes("\\") && !trimmed.startsWith("~") && !trimmed.startsWith(".")) return null;

  // Handle shell-escaped spaces (\ ), surrounding quotes, and ~ expansion
  let cleaned = trimmed;
  // Strip surrounding quotes
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  // Unescape backslash-escaped spaces
  cleaned = cleaned.replace(/\\ /g, " ");
  // Expand ~
  cleaned = expandPath(cleaned);
  // Resolve to absolute
  cleaned = resolve(cleaned);

  try {
    const file = Bun.file(cleaned);
    if (await file.exists()) {
      return cleaned;
    }
  } catch {
    // Not a valid path
  }
  return null;
}

/**
 * Determine the destination subfolder under Resources/ for a file.
 */
function resourceSubfolder(filePath: string): string {
  if (isPDFFile(filePath)) return "Resources/PDFs";
  if (isImageFile(filePath)) return "Resources/Images";
  return "Resources";
}

/**
 * Format a byte count as a human-readable string.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Copy a file into the workspace Resources/ directory.
 * Does not perform any processing — the model handles that via MCP tools.
 */
export async function copyFileToResources(
  filePath: string,
  workspaceDir: string,
): Promise<CopyResult> {
  const fileName = basename(filePath);
  const subfolder = resourceSubfolder(filePath);
  const destDir = join(workspaceDir, subfolder);
  await mkdir(destDir, { recursive: true });

  const destPath = join(destDir, fileName);

  // Get file size before copying
  const stats = await stat(filePath);
  const fileSize = formatFileSize(stats.size);

  // Copy file to Resources/
  const sourceFile = Bun.file(filePath);
  await Bun.write(destPath, sourceFile);

  const relDest = `${subfolder}/${fileName}`;
  return {
    fileName,
    destPath: relDest,
    fileSize,
    summary: `Copied ${fileName} (${fileSize}) to ${subfolder}.`,
  };
}
