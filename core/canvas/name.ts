/**
 * Validate and normalize canvas names before using them in file paths.
 */

const MAX_CANVAS_NAME_LENGTH = 80;
const SAFE_CANVAS_NAME = /^[A-Za-z0-9._ -]+$/;

export function normalizeCanvasName(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function validateCanvasName(input: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeCanvasName(input);
  if (!name) {
    return { ok: false, error: "Canvas name cannot be empty." };
  }
  if (name.length > MAX_CANVAS_NAME_LENGTH) {
    return { ok: false, error: `Canvas name must be at most ${MAX_CANVAS_NAME_LENGTH} characters.` };
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return { ok: false, error: "Canvas name contains invalid path characters." };
  }
  if (name === "." || name === ".." || name.includes("..")) {
    return { ok: false, error: "Canvas name cannot contain path traversal segments." };
  }
  if (!SAFE_CANVAS_NAME.test(name)) {
    return { ok: false, error: "Canvas name may only include letters, numbers, spaces, dots, hyphens, and underscores." };
  }
  return { ok: true, name };
}

export function requireValidCanvasName(input: string): string {
  const result = validateCanvasName(input);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.name;
}
