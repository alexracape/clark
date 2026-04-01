/**
 * File ingestion — detect file paths, copy to Resources/, and run background
 * processing (transcription + agentic linking).
 */

import { basename, dirname, join, resolve, extname } from "node:path";
import { mkdir, stat, rename, unlink } from "node:fs/promises";
import { expandPath, clarkTranscriptsDirPath } from "../library.ts";
import { isImageFile, isPDFFile } from "../mcp/vault.ts";
import { transcribePDF } from "../ocr/transcribe.ts";
import { Conversation } from "../llm/messages.ts";
import { ConversationEngine } from "../engine.ts";
import type { LLMProvider, Message } from "../llm/provider.ts";
import type { ToolDefinition } from "../mcp/tools.ts";
import type { OCRProvider } from "../ocr/provider.ts";
import type { ExtractedImage } from "../ocr/cloud.ts";

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

/** Default routing destinations by file type. */
export const DEFAULT_FILE_ROUTING = {
  pdf: "Resources/PDFs",
  image: "Resources/Images",
  other: "Resources",
} as const;

export type FileRouting = {
  pdf?: string;
  image?: string;
  other?: string;
};

/**
 * Determine the destination subfolder for a file based on its type and config.
 */
function resourceSubfolder(filePath: string, routing?: FileRouting): string {
  if (isPDFFile(filePath)) return routing?.pdf ?? DEFAULT_FILE_ROUTING.pdf;
  if (isImageFile(filePath)) return routing?.image ?? DEFAULT_FILE_ROUTING.image;
  return routing?.other ?? DEFAULT_FILE_ROUTING.other;
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
  routing?: FileRouting,
): Promise<CopyResult> {
  const fileName = basename(filePath);
  const subfolder = resourceSubfolder(filePath, routing);
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

// --- Background ingestion pipeline ---

export interface IngestionPipelineOptions {
  /** Absolute path of the copied file in the workspace. */
  filePath: string;
  /** Vault-relative destination path (e.g., "Resources/PDFs/lecture.pdf"). */
  destPath: string;
  /** Display file name. */
  fileName: string;
  /** Workspace root directory. */
  workspaceDir: string;
  /** LLM provider for OCR and agentic linking. */
  provider: LLMProvider;
  /** MCP tools the linking agent can use. */
  tools: ToolDefinition[];
  /** System prompt for the linking agent. */
  systemPrompt: string;
  /** Summary of recent conversation for linking context. */
  conversationContext: string;
  /** OCR provider for PDF transcription (null if vision not available). */
  ocrProvider: OCRProvider | null;
  /** File routing config for determining where images are saved. */
  fileRouting?: FileRouting;
  /** Progress callback. */
  onProgress: (stage: "transcribing" | "linking", message: string) => void;
}

export interface IngestionPipelineResult {
  summary: string;
  transcriptPath?: string;
  finalFileName: string;
  finalDestPath: string;
}

const INGEST_PROMPT_FALLBACK = `A file has been added to the user's library. The file has already been copied and transcribed. Your job is to link it into the user's existing notes.

## File Info
- **File:** {{fileName}}
- **Location:** {{destPath}}
- **Transcript saved to:** Clark/Transcripts/{{baseName}}.md

## File Content
{{fileContent}}

## Current Conversation Context
{{conversationContext}}

## Instructions

1. **Find related notes** — use \`search_notes\` and \`list_files\` to find documents related to this file's content and the current conversation context. Search returns ranked file paths — use \`read_file\` on promising results to check relevance before editing.

2. **Link to related notes** — if a relevant class page, topic note, or structure file exists, use \`edit_file\` to add a wikilink (\`[[{{destPath}}]]\`) in the appropriate section (e.g., under ## Homework, ## Slides, ## Resources). If it makes sense to imbed the resource, use \`![[{{destPath}}]]\`.

3. **Return a brief summary** of what you did (1-2 sentences). If no related notes were found, say so.

Be conservative with edits — only link where the relationship is obvious. Do not create new structure files unless the user has explicitly asked.`;

/** Simple text-in/text-out LLM call for naming and cleanup tasks. */
async function simpleLLMCall(
  provider: LLMProvider,
  userPrompt: string,
  systemPrompt: string,
): Promise<string> {
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: userPrompt }] },
  ];
  let result = "";
  for await (const chunk of provider.chat(messages, [], systemPrompt)) {
    if (chunk.type === "text_delta") result += chunk.text;
  }
  return result;
}

/** Suggest a descriptive file name using an LLM. */
async function suggestFileName(
  content: string,
  originalName: string,
  provider: LLMProvider,
): Promise<string> {
  const truncated = content.substring(0, 2000);
  const raw = await simpleLLMCall(
    provider,
    `Original filename: ${originalName}\n\nDocument content (first ~2000 chars):\n${truncated}`,
    `You suggest concise, descriptive filenames for documents. Output ONLY the filename (no extension, no path, no quotes, no explanation). Use Title Case. Keep it under 60 characters. Examples: "Attention Is All You Need", "Lecture 5 Linear Algebra", "Q3 Sales Report".`,
  );
  const cleaned = sanitizeFileName(raw.trim());
  return cleaned || "";
}

/** Clean up garbled extracted text into well-structured markdown via LLM. */
async function cleanupTranscript(
  rawText: string,
  fileName: string,
  provider: LLMProvider,
): Promise<string> {
  // Vision OCR output already has frontmatter and clean structure — skip cleanup
  // entirely so the LLM doesn't strip frontmatter or reformat good content.
  if (rawText.startsWith("---\n")) {
    return rawText;
  }

  // Only clean up if the text looks garbled (has excessive whitespace/tabs)
  const tabRatio = (rawText.match(/\t/g)?.length ?? 0) / rawText.length;
  const multiSpaceRatio =
    (rawText.match(/ {3,}/g)?.length ?? 0) / rawText.split("\n").length;
  const needsCleanup = tabRatio > 0.01 || multiSpaceRatio > 0.3;

  if (!needsCleanup) {
    return rawText;
  }

  const truncated = truncateForPrompt(rawText, 100000);
  return await simpleLLMCall(
    provider,
    `Document: ${fileName}\n\nRaw extracted text:\n${truncated}`,
    `You are a document formatting assistant. Reformat the raw extracted text into clean, well-structured Markdown. Preserve ALL content — do not summarize or omit anything. Fix spacing/tab issues, add proper heading hierarchy, format lists and tables correctly. Format math as LaTeX. Do not create or preserve a leading document-title H1 when it only repeats the filename or document title, because Clark already shows the filename as the note title. Output ONLY the formatted markdown, no preamble.`,
  );
}

/** Remove filesystem-unsafe characters and normalize whitespace. */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 80);
}

function normalizeComparableTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripLeadingDuplicateTitleHeading(
  markdown: string,
  candidateTitles: string[],
): string {
  const normalizedCandidates = candidateTitles
    .map(normalizeComparableTitle)
    .filter(Boolean);
  if (normalizedCandidates.length === 0) return markdown;

  let prefix = "";
  let body = markdown;
  const frontmatterMatch = markdown.match(/^(---\n[\s\S]*?\n---\n*)([\s\S]*)$/);
  if (frontmatterMatch) {
    prefix = frontmatterMatch[1]!;
    body = frontmatterMatch[2]!;
  }

  const headingMatch = body.match(/^(\s*)# (.+?)\s*\n+/);
  if (!headingMatch) return markdown;

  const headingTitle = normalizeComparableTitle(headingMatch[2]!);
  if (!headingTitle || !normalizedCandidates.includes(headingTitle)) {
    return markdown;
  }

  const remaining = body.slice(headingMatch[0].length).replace(/^\n+/, "");
  return prefix + remaining;
}

/** Find an available sibling path by appending a numeric suffix when needed. */
async function ensureUniqueSiblingPath(targetPath: string): Promise<string> {
  const extension = extname(targetPath);
  const stem = basename(targetPath, extension);
  const parentDir = dirname(targetPath);

  if (!(await Bun.file(targetPath).exists())) {
    return targetPath;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = join(parentDir, `${stem} ${index}${extension}`);
    if (!(await Bun.file(candidate).exists())) {
      return candidate;
    }
  }

  throw new Error(`Could not find an available filename for ${targetPath}`);
}

/** Load the ingestion prompt template and fill in variables. */
async function loadIngestionPrompt(vars: {
  fileName: string;
  destPath: string;
  baseName: string;
  fileContent: string;
  conversationContext: string;
}): Promise<string> {
  // Try to load from source file first; fall back to embedded template if unavailable
  // (e.g. when running as a compiled sidecar binary).
  let template = INGEST_PROMPT_FALLBACK;
  try {
    const templateFile = Bun.file(new URL("../prompts/ingest.md", import.meta.url));
    if (await templateFile.exists()) {
      template = await templateFile.text();
    }
  } catch {
    // Use fallback
  }
  return template
    .replace(/\{\{fileName\}\}/g, vars.fileName)
    .replace(/\{\{destPath\}\}/g, vars.destPath)
    .replace(/\{\{baseName\}\}/g, vars.baseName)
    .replace(/\{\{fileContent\}\}/g, vars.fileContent)
    .replace(/\{\{conversationContext\}\}/g, vars.conversationContext);
}

/**
 * Save extracted OCR images to the image routing directory with a document prefix.
 * Returns the prefix used, so callers can update markdown references.
 */
async function saveExtractedImages(
  images: ExtractedImage[],
  docBaseName: string,
  workspaceDir: string,
  routing?: FileRouting,
): Promise<string> {
  const imageDir = join(workspaceDir, routing?.image ?? DEFAULT_FILE_ROUTING.image);
  await mkdir(imageDir, { recursive: true });

  // Sanitize the document name for use as a prefix
  const prefix = sanitizeFileName(docBaseName).replace(/\s+/g, "-") + "-";

  for (const img of images) {
    const destPath = join(imageDir, `${prefix}${img.id}`);
    const buffer = Buffer.from(img.data, "base64");
    await Bun.write(destPath, buffer);
  }

  return prefix;
}

/**
 * Replace Obsidian image wikilinks with prefixed versions.
 * `![[img-0.jpg]]` → `![[prefix-img-0.jpg]]`
 */
function prefixImageLinks(markdown: string, images: ExtractedImage[], prefix: string): string {
  let result = markdown;
  for (const img of images) {
    result = result.replaceAll(`![[${img.id}]]`, `![[${prefix}${img.id}]]`);
  }
  return result;
}

/**
 * Run the full ingestion pipeline for a dropped file:
 * 1. Extract raw text (vision OCR → pdftotext → error)
 * 2. Clean up transcript formatting via LLM
 * 3. Rename file based on LLM-suggested name
 * 4. Save transcript to Clark/Transcripts/
 * 5. Run agentic linking via a separate ConversationEngine
 */
export async function runIngestionPipeline(
  opts: IngestionPipelineOptions,
): Promise<IngestionPipelineResult> {
  const absFilePath = join(opts.workspaceDir, opts.destPath);
  const baseName = basename(opts.fileName, getExtension(opts.fileName));
  const transcriptsDir = clarkTranscriptsDirPath(opts.workspaceDir);
  await mkdir(transcriptsDir, { recursive: true });

  // --- Step 1: Read and transcribe file content ---
  opts.onProgress("transcribing", `Transcribing ${opts.fileName}...`);

  let fileContent = "";
  let extractedImages: ExtractedImage[] | undefined;

  if (isPDFFile(opts.fileName)) {
    try {
      const result = await transcribePDF({
        pdfPath: absFilePath,
        ocrProvider: opts.ocrProvider,
        sourcePath: opts.destPath,
      });
      fileContent = result.text;
      extractedImages = result.images;
    } catch (err) {
      console.error(`[ingest] PDF transcription failed for ${opts.fileName}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      fileContent = `[Could not extract text from ${opts.fileName}. ${msg}]`;
    }
  } else if (isImageFile(opts.fileName)) {
    // For images, we can't extract text without vision — store a placeholder
    fileContent = `[Image file: ${opts.fileName}]`;
  } else {
    // Plain text / markdown — read directly
    fileContent = await Bun.file(absFilePath).text().catch(
      () => `[Could not read ${opts.fileName}]`,
    );
  }

  // --- Step 2: Clean up transcript formatting ---
  if (fileContent && !fileContent.startsWith("[")) {
    try {
      fileContent = await cleanupTranscript(fileContent, opts.fileName, opts.provider);
    } catch (err) {
      console.error(`[ingest] Transcript cleanup failed for ${opts.fileName}:`, err);
      // Keep raw text — still usable
    }
  }

  // --- Step 3: Rename file based on content ---
  let finalFileName = opts.fileName;
  let finalDestPath = opts.destPath;
  let finalAbsFilePath = absFilePath;
  let finalBaseName = baseName;

  const suggested = await suggestFileName(fileContent, opts.fileName, opts.provider).catch(
    (err) => {
      console.error(`[ingest] LLM naming failed for ${opts.fileName}:`, err);
      return "";
    },
  );
  if (suggested && suggested !== baseName) {
    const ext = extname(opts.fileName);
    const newFileName = `${suggested}${ext}`;
    const newAbsPath = await ensureUniqueSiblingPath(join(dirname(absFilePath), newFileName));
    try {
      await rename(absFilePath, newAbsPath);
      finalFileName = basename(newAbsPath);
      finalDestPath = opts.destPath.replace(opts.fileName, finalFileName);
      finalAbsFilePath = newAbsPath;
      finalBaseName = basename(finalFileName, ext);
      console.log(`[ingest] Renamed ${opts.fileName} → ${finalFileName}`);
    } catch (err) {
      console.error(`[ingest] Could not rename ${opts.fileName}:`, err);
    }
  }

  // --- Step 4a: Save extracted images (if any) ---
  if (extractedImages && extractedImages.length > 0) {
    try {
      const prefix = await saveExtractedImages(
        extractedImages,
        finalBaseName,
        opts.workspaceDir,
        opts.fileRouting,
      );
      // Update image references in the transcript with the prefix
      fileContent = prefixImageLinks(fileContent, extractedImages, prefix);
      console.log(`[ingest] Saved ${extractedImages.length} extracted images with prefix "${prefix}"`);
    } catch (err) {
      console.error(`[ingest] Failed to save extracted images for ${finalFileName}:`, err);
    }
  }

  fileContent = stripLeadingDuplicateTitleHeading(fileContent, [
    finalBaseName,
    baseName,
  ]);

  // --- Step 4b: Save transcript ---
  const desiredTranscriptAbsPath = join(opts.workspaceDir, "Clark", "Transcripts", `${finalBaseName}.md`);
  const finalTranscriptAbsPath = await ensureUniqueSiblingPath(desiredTranscriptAbsPath);
  const finalTranscriptRelPath = `Clark/Transcripts/${basename(finalTranscriptAbsPath)}`;
  await Bun.write(finalTranscriptAbsPath, fileContent);

  // Clean up any stale transcript from a prior run that used the original name
  if (basename(finalTranscriptAbsPath, ".md") === finalBaseName && finalBaseName !== baseName) {
    const staleTranscriptPath = join(opts.workspaceDir, `Clark/Transcripts/${baseName}.md`);
    try {
      await unlink(staleTranscriptPath);
      console.log(`[ingest] Removed stale transcript Clark/Transcripts/${baseName}.md`);
    } catch {
      // File didn't exist — nothing to clean up
    }
  }

  // --- Step 5: Agentic linking ---
  opts.onProgress("linking", "Finding related notes...");

  const conversationContext = opts.conversationContext || "No active conversation.";
  const prompt = await loadIngestionPrompt({
    fileName: finalFileName,
    destPath: finalDestPath,
    baseName: finalBaseName,
    fileContent: truncateForPrompt(fileContent, 8000),
    conversationContext,
  });

  // Create isolated conversation + engine for linking
  const linkingConversation = new Conversation();
  const linkingEngine = new ConversationEngine({
    conversation: linkingConversation,
    tools: opts.tools,
    systemPrompt: opts.systemPrompt,
    maxToolCallsPerTurn: 6,
  });

  linkingConversation.addUserMessage(prompt);

  let summary = `Transcribed ${finalFileName} and saved to ${finalTranscriptRelPath}.`;
  try {
    let agentResponse = "";
    await linkingEngine.runTurn(opts.provider, {
      onAssistantMessage: (text) => {
        agentResponse = text;
      },
    });
    if (agentResponse) {
      summary += ` ${agentResponse}`;
    }
  } catch (err) {
    console.error(`[ingest] Linking failed for ${finalFileName}:`, err);
    summary += " Linking could not be completed.";
  }

  return {
    summary,
    transcriptPath: finalTranscriptRelPath,
    finalFileName,
    finalDestPath,
  };
}

/** Get file extension including the dot. */
function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.substring(dot) : "";
}

/** Truncate content for inclusion in prompts to avoid blowing up context. */
function truncateForPrompt(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.substring(0, maxChars) + "\n\n[Content truncated...]";
}
