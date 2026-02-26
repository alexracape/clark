/**
 * Vault utilities for Obsidian-style note vaults.
 *
 * Handles wikilink parsing/resolution, path validation,
 * and file type detection for the MCP tools.
 */

import { readdir, realpath } from "node:fs/promises";
import { join, extname, basename, resolve, relative, dirname, sep } from "node:path";

// --- Wikilink parsing ---

export interface WikiLink {
  /** Raw text as it appeared, e.g. "[[Reinforcement Learning]]" */
  raw: string;
  /** Target name, e.g. "Reinforcement Learning" */
  name: string;
  /** Whether this is an embed (![[...]]) vs a regular link */
  isEmbed: boolean;
}

/**
 * Extract all wikilinks from markdown content.
 * Matches both [[links]] and ![[embeds]].
 */
export function extractWikilinks(content: string): WikiLink[] {
  const regex = /(!)?\[\[([^\]]+)\]\]/g;
  const links: WikiLink[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const raw = match[0];
    if (seen.has(raw)) continue;
    seen.add(raw);

    links.push({
      raw,
      name: match[2]!,
      isEmbed: match[1] === "!",
    });
  }

  return links;
}

// --- File index and wikilink resolution ---

let cachedIndex: { map: Map<string, string>; vaultDir: string; timestamp: number } | null = null;
const INDEX_TTL_MS = 30_000;

/**
 * Invalidate the cached file index. Call after any file tree mutation
 * (create_file, rename_file, delete_file).
 */
export function invalidateFileIndex(): void {
  cachedIndex = null;
}

/**
 * Build an index of all files in the vault for wikilink resolution.
 * Maps lowercase filename (with and without extension) to relative path.
 * Results are cached with a 30-second TTL for performance.
 */
export async function buildFileIndex(vaultDir: string): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedIndex && cachedIndex.vaultDir === vaultDir && (now - cachedIndex.timestamp) < INDEX_TTL_MS) {
    return cachedIndex.map;
  }

  const index = new Map<string, string>();
  const entries = await readdir(vaultDir, { recursive: true });

  for (const entry of entries) {
    const nameWithExt = basename(entry).toLowerCase();
    const nameWithoutExt = basename(entry, extname(entry)).toLowerCase();

    // First match wins (Obsidian resolves ambiguity the same way)
    if (!index.has(nameWithoutExt)) {
      index.set(nameWithoutExt, entry);
    }
    if (!index.has(nameWithExt)) {
      index.set(nameWithExt, entry);
    }
  }

  cachedIndex = { map: index, vaultDir, timestamp: now };
  return index;
}

/**
 * Resolve a wikilink name to a relative path within the vault.
 * Searches the entire vault by filename, like Obsidian does.
 */
export async function resolveWikilink(
  name: string,
  vaultDir: string,
  index?: Map<string, string>,
): Promise<string | null> {
  const fileIndex = index ?? (await buildFileIndex(vaultDir));
  return fileIndex.get(name.toLowerCase()) ?? null;
}

/**
 * Build a footer listing resolved wikilinks for a markdown file.
 * Returns empty string if there are no links.
 */
export async function buildLinkFooter(
  links: WikiLink[],
  vaultDir: string,
): Promise<string> {
  if (links.length === 0) return "";

  const index = await buildFileIndex(vaultDir);
  const lines: string[] = ["\n---\nLinked files:"];

  for (const link of links) {
    const resolved = index.get(link.name.toLowerCase());
    const prefix = link.isEmbed ? "embed" : "link";
    if (resolved) {
      lines.push(`- [${prefix}] [[${link.name}]] → ${resolved}`);
    } else {
      lines.push(`- [${prefix}] [[${link.name}]] → (not found)`);
    }
  }

  return lines.join("\n");
}

// --- Path validation ---

/**
 * Check whether a resolved path is within the vault directory.
 */
export function isWithinVault(filePath: string, vaultDir: string): boolean {
  const resolvedFile = resolve(filePath);
  const resolvedVault = resolve(vaultDir);
  return resolvedFile.startsWith(resolvedVault + sep) || resolvedFile === resolvedVault;
}

/**
 * Resolve a user-provided path (relative to vault) to an absolute path.
 * Returns null if the resolved path escapes the vault, including via symlinks.
 */
export async function resolveVaultPath(inputPath: string, vaultDir: string): Promise<string | null> {
  const resolvedVault = resolve(vaultDir);
  const absolutePath = resolve(resolvedVault, inputPath);
  if (!isWithinVault(absolutePath, vaultDir)) {
    return null;
  }

  // Resolve vault realpath once for robust symlink checks.
  let vaultRealPath: string;
  try {
    vaultRealPath = await realpath(resolvedVault);
  } catch {
    return null;
  }

  // Existing targets can be checked directly.
  try {
    const targetRealPath = await realpath(absolutePath);
    if (!isWithinVault(targetRealPath, vaultRealPath)) {
      return null;
    }
    return absolutePath;
  } catch {
    // Nonexistent target (e.g. create_file): resolve nearest existing parent.
  }

  let cursor = dirname(absolutePath);
  let ancestorRealPath: string | null = null;

  while (isWithinVault(cursor, resolvedVault)) {
    try {
      ancestorRealPath = await realpath(cursor);
      break;
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  if (!ancestorRealPath) {
    return null;
  }

  if (!isWithinVault(ancestorRealPath, vaultRealPath)) {
    return null;
  }

  const tail = relative(cursor, absolutePath);
  const projectedTarget = resolve(ancestorRealPath, tail);
  if (!isWithinVault(projectedTarget, vaultRealPath)) {
    return null;
  }

  return absolutePath;
}

// --- File type detection ---

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp",
]);

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export function isPDFFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ".pdf";
}

/**
 * Get the MIME type for an image file.
 */
export function imageMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".png": return "image/png";
    case ".svg": return "image/svg+xml";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    default: return "image/jpeg";
  }
}
