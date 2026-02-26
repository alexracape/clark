export interface FrameBlankness {
  id: string;
  isBlank: boolean;
}

/**
 * Shared blank-frame heuristic for cleanup and export.
 * A frame is blank when it has neither frame children nor overlapping page-level content.
 */
export function isFrameBlank(hasChildContent: boolean, hasOverlappingPageContent: boolean): boolean {
  return !hasChildContent && !hasOverlappingPageContent;
}

/**
 * Intermediate blank frames can be auto-deleted, but never the final frame.
 */
export function intermediateBlankFrameIds(frames: FrameBlankness[]): string[] {
  if (frames.length <= 1) return [];
  return frames.slice(0, -1).filter((frame) => frame.isBlank).map((frame) => frame.id);
}

/**
 * Trailing blank frames should be excluded from export, while keeping at least one frame.
 */
export function trimTrailingBlankFrames<T extends { isBlank: boolean }>(frames: T[]): T[] {
  let end = frames.length;
  while (end > 1 && frames[end - 1]!.isBlank) {
    end -= 1;
  }
  return frames.slice(0, end);
}
