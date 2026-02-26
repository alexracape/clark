import { mkdir, cp } from "node:fs/promises";
import { join } from "node:path";

const ROOT = import.meta.dir;
const DIST = join(ROOT, "dist");

await mkdir(DIST, { recursive: true });
await cp(join(ROOT, "index.html"), join(DIST, "index.html"));

console.log("Built GUI placeholder into gui/dist");
