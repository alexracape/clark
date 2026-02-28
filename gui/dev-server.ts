/**
 * GUI dev server — serves the React app and starts the sidecar.
 *
 * Spawns the Bun sidecar API server, builds the React frontend,
 * and serves everything on a single dev command.
 *
 * Usage:
 *   bun gui/dev-server.ts
 *   # or from project root:
 *   bun run dev:gui
 *
 * Then open http://localhost:1420
 */

import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT ?? "1420");
const ROOT = import.meta.dir;
const PROJECT_ROOT = resolve(ROOT, "..");

// --- Start sidecar process ---

const SIDECAR_PORT = process.env.CLARK_SIDECAR_PORT ?? "3456";

console.log("Starting sidecar...");
const sidecar = spawn("bun", [join(ROOT, "sidecar.ts")], {
  cwd: PROJECT_ROOT,
  env: { ...process.env, CLARK_SIDECAR_PORT: SIDECAR_PORT },
  stdio: ["ignore", "pipe", "inherit"],
});

// Wait for sidecar to be ready
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Sidecar startup timed out")), 15000);

  sidecar.stdout!.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (text.includes("CLARK_SIDECAR_PORT=")) {
      clearTimeout(timeout);
      resolve();
    }
  });

  sidecar.on("error", (err) => {
    clearTimeout(timeout);
    reject(err);
  });

  sidecar.on("exit", (code) => {
    if (code !== null && code !== 0) {
      clearTimeout(timeout);
      reject(new Error(`Sidecar exited with code ${code}`));
    }
  });
});

console.log("Sidecar ready.");

// Clean up sidecar on exit
process.on("SIGINT", () => {
  sidecar.kill();
  process.exit(0);
});
process.on("SIGTERM", () => {
  sidecar.kill();
  process.exit(0);
});
process.on("exit", () => {
  sidecar.kill();
});

// --- Build frontend ---

const buildResult = await Bun.build({
  entrypoints: [join(ROOT, "src/main.tsx")],
  outdir: join(ROOT, "dist"),
  sourcemap: "inline",
  target: "browser",
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
});

if (!buildResult.success) {
  console.error("Build failed:");
  for (const log of buildResult.logs) {
    console.error(log);
  }
  sidecar.kill();
  process.exit(1);
}

// Prepare the HTML with injected JS bundle
const indexHtml = await Bun.file(join(ROOT, "index.html")).text();
const jsFile = buildResult.outputs.find((o) => o.path.endsWith(".js"));
const jsFileName = jsFile ? jsFile.path.split("/").pop() : "main.js";

let html = indexHtml.replace(
  '<script type="module" src="./src/main.tsx"></script>',
  `<script type="module" src="/${jsFileName}"></script>`,
);

// Inject CSS if emitted
const cssFile = buildResult.outputs.find((o) => o.path.endsWith(".css"));
if (cssFile) {
  const cssName = cssFile.path.split("/").pop()!;
  html = html.replace(
    "</head>",
    `  <link rel="stylesheet" href="/${cssName}" />\n  </head>`,
  );
}

// --- Serve frontend ---

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    // Serve index.html at root
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Serve built assets from dist/
    const distPath = join(ROOT, "dist", pathname.slice(1));
    const distFile = Bun.file(distPath);
    if (await distFile.exists()) {
      return new Response(distFile);
    }

    // Serve static assets from gui/
    const staticPath = join(ROOT, pathname.slice(1));
    const staticFile = Bun.file(staticPath);
    if (await staticFile.exists()) {
      return new Response(staticFile);
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`\nGUI dev server at http://localhost:${server.port}`);
