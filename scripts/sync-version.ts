import { join } from "node:path";
import { parseArgs } from "node:util";
import { normalizeVersion, readVersionFile } from "../core/version.ts";

const ROOT = join(import.meta.dir, "..");
const ROOT_PACKAGE_JSON_PATH = join(ROOT, "package.json");
const GUI_PACKAGE_JSON_PATH = join(ROOT, "gui", "package.json");
const TAURI_CONFIG_PATH = join(ROOT, "tauri", "tauri.conf.json");
const TAURI_CARGO_TOML_PATH = join(ROOT, "tauri", "Cargo.toml");

async function writeJsonVersion(path: string, version: string): Promise<void> {
  const contents = await Bun.file(path).json() as Record<string, unknown>;
  contents.version = version;
  await Bun.write(path, `${JSON.stringify(contents, null, 2)}\n`);
}

async function writeCargoVersion(path: string, version: string): Promise<void> {
  const original = await Bun.file(path).text();
  const pattern = /^version = ".*"$/m;
  if (!pattern.test(original)) {
    throw new Error(`Could not find Cargo.toml package version in ${path}`);
  }

  const next = original.replace(pattern, `version = "${version}"`);
  await Bun.write(path, next);
}

export function expectedReleaseTag(version: string): string {
  return `v${normalizeVersion(version)}`;
}

export function assertReleaseTagMatchesVersion(tag: string, version: string): void {
  const expected = expectedReleaseTag(version);
  if (tag !== expected) {
    throw new Error(
      `Release tag mismatch: expected ${expected} from VERSION, received ${tag}`,
    );
  }
}

export async function syncVersionFiles(version?: string): Promise<void> {
  const resolvedVersion = version ? normalizeVersion(version) : await readVersionFile();
  await writeJsonVersion(ROOT_PACKAGE_JSON_PATH, resolvedVersion);
  await writeJsonVersion(GUI_PACKAGE_JSON_PATH, resolvedVersion);
  await writeJsonVersion(TAURI_CONFIG_PATH, resolvedVersion);
  await writeCargoVersion(TAURI_CARGO_TOML_PATH, resolvedVersion);
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "check-tag": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const version = await readVersionFile();

  if (values["check-tag"]) {
    assertReleaseTagMatchesVersion(values["check-tag"], version);
  }

  await syncVersionFiles(version);
  console.log(`Synchronized version ${version}`);
}
