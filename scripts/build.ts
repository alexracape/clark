/**
 * Build script for compiling Clark into standalone binaries.
 *
 * Usage:
 *   bun scripts/build.ts                    # Build for current platform
 *   bun scripts/build.ts --target darwin-arm64 --target darwin-x64  # Cross-compile
 *   bun scripts/build.ts --all              # Build all supported targets
 */

import { parseArgs } from "node:util";
import { join } from "node:path";

const TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64": "bun-linux-x64",
} as const;

type TargetKey = keyof typeof TARGETS;

const { values } = parseArgs({
  options: {
    target: { type: "string", multiple: true },
    all: { type: "boolean", default: false },
  },
});

const packageJson = await Bun.file(
  join(import.meta.dir, "..", "package.json"),
).json();
const version: string = packageJson.version;

// Determine which targets to build
let targets: TargetKey[];
if (values.all) {
  targets = Object.keys(TARGETS) as TargetKey[];
} else if (values.target && values.target.length > 0) {
  for (const t of values.target) {
    if (!(t in TARGETS)) {
      console.error(`Unknown target: ${t}. Valid: ${Object.keys(TARGETS).join(", ")}`);
      process.exit(1);
    }
  }
  targets = values.target as TargetKey[];
} else {
  // Default: current platform
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const platform = process.platform === "linux" ? "linux" : "darwin";
  targets = [`${platform}-${arch}` as TargetKey];
}

const distDir = join(import.meta.dir, "..", "dist");
await Bun.$`mkdir -p ${distDir}`;

for (const target of targets) {
  const bunTarget = TARGETS[target];
  const outfile = join(distDir, `clark-${target}`);
  console.log(`Building ${target} (v${version})...`);

  const result =
    await Bun.$`bun build --compile index.ts --target=${bunTarget} --outfile=${outfile} --define CLARK_VERSION='"${version}"'`
      .cwd(join(import.meta.dir, ".."))
      .quiet();

  if (result.exitCode !== 0) {
    console.error(`Failed to build ${target}:`);
    console.error(result.stderr.toString());
    process.exit(1);
  }

  console.log(`  → ${outfile}`);
}

// Generate checksums
console.log("\nGenerating checksums...");
for (const target of targets) {
  const binary = join(distDir, `clark-${target}`);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(binary).arrayBuffer());
  const hash = hasher.digest("hex");
  await Bun.write(join(distDir, `clark-${target}.sha256`), `${hash}  clark-${target}\n`);
  console.log(`  ${hash}  clark-${target}`);
}

console.log("\nDone.");
