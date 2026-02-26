/**
 * Visual context extraction for the LLM.
 *
 * Inspired by the tldraw Agent SDK's shape representation system.
 * These types and helpers run on the iPad client to extract structured
 * canvas context alongside PNG snapshots.
 *
 * Three levels of detail:
 * - BlurryShape: lightweight viewport summary (cheap, always included)
 * - SimpleShape: full properties for focused shapes
 * - PeripheralShapeCluster: off-screen shape counts
 */

// --- Shape representations ---

export interface BlurryShape {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text content if the shape contains text */
  text?: string;
}

export interface SimpleShape {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  props: Record<string, unknown>;
}

export interface PeripheralShapeCluster {
  /** Direction from viewport: "above" | "below" | "left" | "right" */
  direction: string;
  /** Number of shapes in this cluster */
  count: number;
  /** Shape types present */
  types: string[];
}

/** Full context payload sent alongside a snapshot */
export interface CanvasContext {
  currentPage: string;
  pageCount: number;
  viewportShapes: BlurryShape[];
  selectedShapes: SimpleShape[];
  peripheralClusters: PeripheralShapeCluster[];
}

/**
 * Extract BlurryShape summaries from tldraw shapes.
 *
 * This runs on the iPad client where the tldraw editor is available.
 * Usage: extractBlurryShapes(editor.getCurrentPageShapes(), editor.getViewportPageBounds())
 */
export function extractBlurryShapes(
  shapes: Array<{ id: string; type: string; x: number; y: number; props: Record<string, unknown> }>,
  viewportBounds: { x: number; y: number; w: number; h: number },
): BlurryShape[] {
  return shapes
    .filter((s) => {
      // Include shapes that overlap with the viewport
      const sx = s.x;
      const sy = s.y;
      const sw = (s.props.w as number) ?? 100;
      const sh = (s.props.h as number) ?? 100;
      return (
        sx + sw > viewportBounds.x &&
        sx < viewportBounds.x + viewportBounds.w &&
        sy + sh > viewportBounds.y &&
        sy < viewportBounds.y + viewportBounds.h
      );
    })
    .map((s) => ({
      id: s.id,
      type: s.type,
      x: s.x,
      y: s.y,
      w: (s.props.w as number) ?? 0,
      h: (s.props.h as number) ?? 0,
      ...(s.props.text ? { text: s.props.text as string } : {}),
    }));
}
