import type { TLShape } from "tldraw";

/**
 * Only local user-created non-frame shapes should trigger trailing-page checks.
 * Remote shape creation events are sync replays from other clients and must not
 * append additional pages locally.
 */
export function shouldCheckTrailingEmptyFrameAfterCreate(
  shape: Pick<TLShape, "type">,
  source: "user" | "remote",
): boolean {
  return source === "user" && shape.type !== "frame";
}
