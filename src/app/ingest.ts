/**
 * File ingestion — detect file paths in user input, copy to Resources/,
 * and generate transcriptions for PDFs and images.
 */

import { basename, extname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { expandPath } from "../library.ts";
import { isImageFile, isPDFFile, imageMimeType } from "../mcp/vault.ts";
import { extractPDFText, getPDFInfo } from "../mcp/pdf.ts";
import type { LLMProvider, Message } from "../llm/provider.ts";

const MAX_PDF_PAGES = 50;

/** Characters per page below which we consider a PDF to be scanned/image-based. */
const SPARSE_TEXT_THRESHOLD = 50;

export interface IngestResult {
  /** Display name of the file */
  fileName: string;
  /** Where the file was copied to (relative to workspace) */
  destPath: string;
  /** Path to transcription file if generated (relative to workspace) */
  transcriptionPath?: string;
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
 * Ingest a file into the workspace Resources/ directory.
 * Copies the file and generates a transcription if applicable.
 */
export async function ingestFile(
  filePath: string,
  workspaceDir: string,
  provider?: LLMProvider,
): Promise<IngestResult> {
  const fileName = basename(filePath);
  const subfolder = resourceSubfolder(filePath);
  const destDir = join(workspaceDir, subfolder);
  await mkdir(destDir, { recursive: true });

  const destPath = join(destDir, fileName);

  // Copy file to Resources/
  const sourceFile = Bun.file(filePath);
  await Bun.write(destPath, sourceFile);

  const relDest = `${subfolder}/${fileName}`;
  const result: IngestResult = {
    fileName,
    destPath: relDest,
    summary: `Added ${fileName} to ${subfolder}.`,
  };

  // Generate transcription for PDFs
  if (isPDFFile(filePath)) {
    const info = await getPDFInfo(filePath);
    if (info.pages > MAX_PDF_PAGES) {
      result.summary += ` PDF has ${info.pages} pages (max ${MAX_PDF_PAGES}) — skipping transcription. Consider splitting the file.`;
      return result;
    }

    const extractedText = await extractPDFText(filePath);
    const avgCharsPerPage = extractedText.length / Math.max(info.pages, 1);

    if (avgCharsPerPage > SPARSE_TEXT_THRESHOLD) {
      // Text-based PDF — save extracted text as transcription
      const transcriptionPath = await saveTranscription(workspaceDir, fileName, extractedText);
      result.transcriptionPath = transcriptionPath;
      result.summary += ` Transcription saved to ${transcriptionPath}.`;
    } else if (provider?.supportsVision) {
      // Scanned PDF with sparse text — note the limitation
      result.summary += ` PDF appears to be scanned with limited extractable text. Text extraction saved what was found.`;
      if (extractedText.trim()) {
        const transcriptionPath = await saveTranscription(workspaceDir, fileName, extractedText);
        result.transcriptionPath = transcriptionPath;
        result.summary += ` Partial transcription saved to ${transcriptionPath}.`;
      }
    } else {
      if (extractedText.trim()) {
        const transcriptionPath = await saveTranscription(workspaceDir, fileName, extractedText);
        result.transcriptionPath = transcriptionPath;
        result.summary += ` Transcription saved to ${transcriptionPath}.`;
      }
    }
    return result;
  }

  // Generate transcription for images using vision LLM
  if (isImageFile(filePath) && provider?.supportsVision) {
    try {
      const transcription = await transcribeImage(filePath, provider);
      const transcriptionPath = await saveTranscription(workspaceDir, fileName, transcription);
      result.transcriptionPath = transcriptionPath;
      result.summary += ` Transcription saved to ${transcriptionPath}.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.summary += ` Image transcription failed: ${msg}`;
    }
    return result;
  }

  return result;
}

/**
 * Transcribe an image file using the LLM's vision API.
 */
async function transcribeImage(filePath: string, provider: LLMProvider): Promise<string> {
  const buffer = await Bun.file(filePath).arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = imageMimeType(filePath);

  const messages: Message[] = [{
    role: "user",
    content: [
      {
        type: "image",
        data: base64,
        mediaType: mimeType as "image/png" | "image/jpeg" | "image/webp",
      },
      {
        type: "text",
        text: "Transcribe this document to markdown. Preserve the structure including headings, bullet points, and formatting. Format math expressions in LaTeX. If there are diagrams or figures, describe them briefly in brackets.",
      },
    ],
  }];

  let result = "";
  for await (const chunk of provider.chat(messages, [], "You are a document transcription assistant. Output only the transcribed content in markdown format.")) {
    if (chunk.type === "text_delta") result += chunk.text;
  }
  return result;
}

/**
 * Save transcription text to Resources/Transcriptions/.
 * Returns the relative path from workspace root.
 */
async function saveTranscription(workspaceDir: string, sourceFileName: string, content: string): Promise<string> {
  const transcriptDir = join(workspaceDir, "Resources", "Transcriptions");
  await mkdir(transcriptDir, { recursive: true });

  const baseName = sourceFileName.replace(/\.[^.]+$/, "");
  const transcriptPath = join(transcriptDir, `${baseName}.md`);
  await Bun.write(transcriptPath, content);

  return `Resources/Transcriptions/${baseName}.md`;
}
