import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? "1420");
const ROOT = import.meta.dir;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function resolvePath(pathname: string): string | null {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const cleanPath = normalize(normalized).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = join(ROOT, cleanPath);

  if (!absolutePath.startsWith(ROOT)) {
    return null;
  }

  return absolutePath;
}

function contentTypeFor(pathname: string): string {
  const ext = extname(pathname).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const filePath = resolvePath(pathname);
    if (!filePath) {
      return new Response("forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("not found", { status: 404 });
    }

    return new Response(file, {
      headers: {
        "content-type": contentTypeFor(filePath),
      },
    });
  },
});

console.log(`GUI dev server listening on http://localhost:${server.port}`);
