/**
 * Self-upgrade logic for Clark.
 *
 * Downloads the latest release binary from GitHub, verifies the SHA-256
 * checksum, and replaces the currently running binary in-place.
 */

import { createHash } from "node:crypto";

const REPO = "alexracape/clark";

/** Compare two semver strings (without leading "v"). Returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/** Detect the platform-arch target string matching the build matrix. */
function detectTarget(): string {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

/** Fetch the latest release tag from GitHub. */
async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) {
    throw new Error(
      `Failed to check for updates (HTTP ${res.status}). Try again later.`,
    );
  }
  const data = (await res.json()) as { tag_name: string };
  return data.tag_name; // e.g. "v0.2.0"
}

/** Download a URL into a Buffer. */
async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download failed: ${url} (HTTP ${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Verify SHA-256 checksum. The checksum file format is "<hash>  <filename>\n". */
function verifyChecksum(binary: Buffer, checksumFileContents: string): void {
  const expectedHash = checksumFileContents.trim().split(/\s+/)[0];
  const actualHash = createHash("sha256").update(binary).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch!\n  Expected: ${expectedHash}\n  Got:      ${actualHash}\nAborting upgrade for safety.`,
    );
  }
}

/**
 * Run the upgrade flow:
 * 1. Check latest version on GitHub
 * 2. Compare with current version
 * 3. Download + verify + replace binary
 */
export async function runUpgrade(currentVersion: string): Promise<void> {
  console.log("Checking for updates...");

  const latestTag = await fetchLatestVersion();
  const latestVersion = latestTag.replace(/^v/, "");
  const cleanCurrent = currentVersion.replace(/^v/, "");

  if (compareVersions(cleanCurrent, latestVersion) >= 0) {
    console.log(`Already up to date (v${cleanCurrent}).`);
    return;
  }

  console.log(`Update available: v${cleanCurrent} → v${latestVersion}`);

  const target = detectTarget();
  const binaryName = `clark-${target}`;
  const baseUrl = `https://github.com/${REPO}/releases/download/${latestTag}`;

  console.log(`Downloading ${binaryName}...`);
  const [binary, checksumFile] = await Promise.all([
    download(`${baseUrl}/${binaryName}`),
    download(`${baseUrl}/${binaryName}.sha256`),
  ]);

  console.log("Verifying checksum...");
  verifyChecksum(binary, checksumFile.toString("utf-8"));

  // Replace the running binary
  const execPath = process.execPath;
  console.log(`Installing to ${execPath}...`);

  try {
    await Bun.write(execPath, binary, { mode: 0o755 });
  } catch {
    // Permission denied — retry with sudo
    console.log("Permission denied, retrying with sudo...");
    const tmpPath = `${Bun.env.TMPDIR ?? "/tmp"}/clark-upgrade-${Date.now()}`;
    await Bun.write(tmpPath, binary, { mode: 0o755 });
    const result = await Bun.$`sudo mv ${tmpPath} ${execPath}`.quiet();
    if (result.exitCode !== 0) {
      throw new Error(`Failed to install binary: ${result.stderr.toString()}`);
    }
  }

  console.log(`\nClark upgraded: v${cleanCurrent} → v${latestVersion}`);
}
