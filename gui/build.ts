/**
 * Build the GUI frontend using Bun's bundler.
 * Output goes to gui/dist/ for Tauri to serve.
 */

import { join } from "node:path";
import { mkdir, cp } from "node:fs/promises";

const ROOT = import.meta.dir;
const DIST = join(ROOT, "dist");

await mkdir(DIST, { recursive: true });

// Bundle the React app
const result = await Bun.build({
  entrypoints: [join(ROOT, "src/main.tsx")],
  outdir: DIST,
  minify: !process.env.DEV,
  sourcemap: process.env.DEV ? "inline" : "none",
  target: "browser",
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.DEV ? "development" : "production",
    ),
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Copy index.html to dist, injecting the built JS bundle
const indexHtml = await Bun.file(join(ROOT, "index.html")).text();
const jsFile = result.outputs.find((o) => o.path.endsWith(".js"));
const jsFileName = jsFile ? jsFile.path.split("/").pop() : "main.js";

// Replace the TSX script tag with the built JS bundle
const builtHtml = indexHtml.replace(
  '<script type="module" src="./src/main.tsx"></script>',
  `<script type="module" src="./${jsFileName}"></script>`,
);

await Bun.write(join(DIST, "index.html"), builtHtml);

// Copy CSS if it was emitted separately
const cssFile = result.outputs.find((o) => o.path.endsWith(".css"));
if (cssFile) {
  const cssName = cssFile.path.split("/").pop()!;
  // Inject CSS link into HTML
  const htmlWithCss = builtHtml.replace(
    "</head>",
    `  <link rel="stylesheet" href="./${cssName}" />\n  </head>`,
  );
  await Bun.write(join(DIST, "index.html"), htmlWithCss);
}

console.log(`Built GUI into gui/dist (${result.outputs.length} files)`);
