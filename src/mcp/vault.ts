/**
 * Vault utilities for Obsidian-style note vaults.
 *
 * Handles wikilink parsing/resolution, path validation,
 * and file type detection for the MCP tools.
 */

import { readdir } from "node:fs/promises";
import { join, extname, basename, resolve, relative } from "node:path";

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

/**
 * Build an index of all files in the vault for wikilink resolution.
 * Maps lowercase filename (with and without extension) to relative path.
 */
export async function buildFileIndex(vaultDir: string): Promise<Map<string, string>> {
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
  return resolvedFile.startsWith(resolvedVault + "/") || resolvedFile === resolvedVault;
}

/**
 * Resolve a user-provided path (relative to vault) to an absolute path.
 * Returns null if the resolved path escapes the vault.
 */
export function resolveVaultPath(inputPath: string, vaultDir: string): string | null {
  const absolutePath = resolve(vaultDir, inputPath);
  if (!isWithinVault(absolutePath, vaultDir)) {
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
