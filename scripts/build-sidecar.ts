/**
 * Build script for compiling the GUI sidecar into standalone binaries.
 *
 * Produces platform-specific binaries in tauri/binaries/ with Tauri's
 * expected naming convention: clark-sidecar-<target-triple>
 *
 * Usage:
 *   bun scripts/build-sidecar.ts                          # Build for current platform
 *   bun scripts/build-sidecar.ts --target darwin-arm64    # Cross-compile
 *   bun scripts/build-sidecar.ts --target darwin-arm64 --target darwin-x64  # Both arches + universal via lipo
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { normalizeVersion, readVersionFile } from "../core/version.ts";

/** Map from our target names to Bun compile targets */
const BUN_TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64": "bun-linux-x64",
} as const;

/** Map from our target names to Tauri/Rust target triples */
const TAURI_TRIPLES = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
} as const;

type TargetKey = keyof typeof BUN_TARGETS;

const { values } = parseArgs({
  options: {
    target: { type: "string", multiple: true },
    universal: { type: "boolean", default: false },
    version: { type: "string" },
  },
});

const version = normalizeVersion(values.version ?? await readVersionFile());

// Determine which targets to build
let targets: TargetKey[];
if (values.target && values.target.length > 0) {
  for (const t of values.target) {
    if (!(t in BUN_TARGETS)) {
      console.error(`Unknown target: ${t}. Valid: ${Object.keys(BUN_TARGETS).join(", ")}`);
      process.exit(1);
    }
  }
  targets = values.target as TargetKey[];
} else {
  // Default: current platform only
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const platform = process.platform === "linux" ? "linux" : "darwin";
  targets = [`${platform}-${arch}` as TargetKey];
}

const rootDir = join(import.meta.dir, "..");
const outDir = join(rootDir, "tauri", "binaries");
await Bun.$`mkdir -p ${outDir}`;

const entrypoint = join(rootDir, "gui", "sidecar.ts");

for (const target of targets) {
  const bunTarget = BUN_TARGETS[target];
  const tauriTriple = TAURI_TRIPLES[target];
  const outfile = join(outDir, `clark-sidecar-${tauriTriple}`);

  console.log(`Building sidecar for ${target} (${tauriTriple}, v${version})...`);

  const result =
    await Bun.$`bun build --compile ${entrypoint} --target=${bunTarget} --outfile=${outfile} --define CLARK_VERSION='"${version}"'`
      .cwd(rootDir)
      .quiet();

  if (result.exitCode !== 0) {
    console.error(`Failed to build sidecar for ${target}:`);
    console.error(result.stderr.toString());
    process.exit(1);
  }

  console.log(`  → ${outfile}`);
}

// If both macOS arches were built, also create a universal binary via lipo
const builtDarwinArm = targets.includes("darwin-arm64");
const builtDarwinX64 = targets.includes("darwin-x64");

if ((builtDarwinArm && builtDarwinX64) || values.universal) {
  const armBin = join(outDir, `clark-sidecar-aarch64-apple-darwin`);
  const x64Bin = join(outDir, `clark-sidecar-x86_64-apple-darwin`);
  const universalBin = join(outDir, `clark-sidecar-universal-apple-darwin`);

  console.log("Creating universal macOS binary with lipo...");
  const lipoResult = await Bun.$`lipo -create -output ${universalBin} ${armBin} ${x64Bin}`.quiet();

  if (lipoResult.exitCode !== 0) {
    console.error("Failed to create universal binary:");
    console.error(lipoResult.stderr.toString());
    process.exit(1);
  }

  console.log(`  → ${universalBin}`);
}

console.log("\nSidecar build complete.");
