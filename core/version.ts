import { join } from "node:path";

// Read version — inlined at compile time via --define, with runtime fallback
declare const CLARK_VERSION: string | undefined;
export const version: string =
  typeof CLARK_VERSION !== "undefined"
    ? CLARK_VERSION
    : await Bun.file(join(import.meta.dir, "..", "package.json"))
        .json()
        .then((p: { version?: string }) => p.version ?? "0.1.0")
        .catch(() => "0.1.0");
