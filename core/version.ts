import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

declare const CLARK_VERSION: string | undefined;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION_FILE_PATH = join(REPO_ROOT, "VERSION");

export interface ResolveVersionOptions {
  compileTimeVersion?: string | undefined;
  envVersion?: string | undefined;
  versionFilePath?: string;
}

export function normalizeVersion(rawVersion: string): string {
  const normalized = rawVersion.trim().replace(/^v/, "");
  if (!normalized) {
    throw new Error("Clark version cannot be empty");
  }
  return normalized;
}

export async function readVersionFile(path = VERSION_FILE_PATH): Promise<string> {
  const contents = await Bun.file(path).text();
  return normalizeVersion(contents);
}

export async function resolveVersion(options: ResolveVersionOptions = {}): Promise<string> {
  const compileTimeVersion =
    options.compileTimeVersion ?? (
      typeof CLARK_VERSION !== "undefined" ? CLARK_VERSION : undefined
    );
  if (compileTimeVersion) {
    return normalizeVersion(compileTimeVersion);
  }

  const envVersion = options.envVersion ?? process.env.CLARK_VERSION;
  if (envVersion) {
    return normalizeVersion(envVersion);
  }

  return readVersionFile(options.versionFilePath);
}

export const version = await resolveVersion();
