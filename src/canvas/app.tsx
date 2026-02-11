/**
 * tldraw canvas app for iPad.
 *
 * Single-page, multi-frame design: all A4 frames are stacked vertically on
 * one tldraw page. Users scroll vertically to navigate between frames.
 * New frames are auto-created when the user draws on the last empty one.
 *
 * Connects to the server's TLSocketRoom via useSync for real-time collaboration,
 * and opens a separate WebSocket for snapshot/export broker messages.
 */

import React, { useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useSync } from "@tldraw/sync";
import { Tldraw, inlineBase64AssetStore, type Editor, type TLShape } from "tldraw";
import "tldraw/tldraw.css";

import type {
  SnapshotRequest,
  ExportRequest,
  SnapshotResponse,
  ExportResponse,
  CanvasMessage,
} from "./server.ts";

// A4 dimensions in points (matching pdf-export.ts)
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

// Gap between vertically stacked frames
const FRAME_GAP = 60;

/** Create an A4 frame at the correct vertical position for the given page number. */
function createPageFrame(editor: Editor, pageNumber: number) {
  const y = (pageNumber - 1) * (A4_HEIGHT + FRAME_GAP);
  editor.createShape({
    type: "frame",
    x: 0,
    y,
    props: {
      w: A4_WIDTH,
      h: A4_HEIGHT,
      name: `Page ${pageNumber}`,
    },
  });
}

/** Get all frame shapes on the current page, sorted top-to-bottom. */
function getFramesSorted(editor: Editor): TLShape[] {
  return editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "frame")
    .sort((a, b) => a.y - b.y);
}

/** Expected position/size for a frame by its page number (1-indexed). */
function expectedFrameGeometry(pageNumber: number) {
  return {
    x: 0,
    y: (pageNumber - 1) * (A4_HEIGHT + FRAME_GAP),
    w: A4_WIDTH,
    h: A4_HEIGHT,
  };
}

/**
 * Ensure there's always one empty frame at the bottom of the stack.
 * Checks both parented children AND overlapping page-level shapes.
 */
function ensureTrailingEmptyFrame(editor: Editor) {
  const frames = getFramesSorted(editor);
  if (frames.length === 0) return;

  const lastFrame = frames.at(-1)!;

  // Check 1: does the last frame have parented children?
  const childIds = editor.getSortedChildIdsForParent(lastFrame.id);
  if (childIds.length > 0) {
    createPageFrame(editor, frames.length + 1);
    return;
  }

  // Check 2: are there page-level shapes overlapping the last frame?
  // (in case tldraw didn't auto-parent the shape into the frame)
  const frameBounds = editor.getShapePageBounds(lastFrame);
  if (!frameBounds) return;

  const pageId = editor.getCurrentPageId();
  const pageShapes = editor.getCurrentPageShapes().filter(
    (s) => s.type !== "frame" && s.parentId === pageId,
  );

  for (const shape of pageShapes) {
    const sb = editor.getShapePageBounds(shape);
    if (!sb) continue;
    // AABB overlap check
    if (
      sb.x < frameBounds.x + frameBounds.w &&
      sb.x + sb.w > frameBounds.x &&
      sb.y < frameBounds.y + frameBounds.h &&
      sb.y + sb.h > frameBounds.y
    ) {
      createPageFrame(editor, frames.length + 1);
      return;
    }
  }
}

function CanvasApp() {
  const editorRef = useRef<Editor | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Build sync URI from current page host
  const syncUri = `ws://${window.location.host}/sync`;

  // Connect to TLSocketRoom via useSync (following tldraw official example)
  const store = useSync({
    uri: syncUri,
    assets: inlineBase64AssetStore,
  });

  // --- Broker WebSocket (for snapshot/export requests) ---

  const connectBrokerWs = useCallback(() => {
    const wsUrl = `ws://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      const editor = editorRef.current;
      if (!editor) return;

      let msg: CanvasMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "snapshot-request") {
        await handleSnapshotRequest(editor, ws, msg);
      } else if (msg.type === "export-request") {
        await handleExportRequest(editor, ws, msg);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      // Auto-reconnect after 2s
      setTimeout(connectBrokerWs, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connectBrokerWs();
    return () => {
      wsRef.current?.close();
    };
  }, [connectBrokerWs]);

  // --- Editor onMount ---

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    // Prevent frame deletion — users should never remove A4 page frames
    editor.sideEffects.registerBeforeDeleteHandler("shape", (shape) => {
      if (shape.type === "frame") return false;
    });

    // Prevent frame move/resize — revert any position or size changes to frames
    editor.sideEffects.registerBeforeChangeHandler("shape", (_prev, next) => {
      if (next.type !== "frame") return next;
      // Determine which page number this frame is by its name
      const frames = getFramesSorted(editor);
      const idx = frames.findIndex((f) => f.id === next.id);
      if (idx < 0) return next;
      const expected = expectedFrameGeometry(idx + 1);
      // Force position and size back to expected values
      return {
        ...next,
        x: expected.x,
        y: expected.y,
        props: { ...next.props, w: expected.w, h: expected.h },
      };
    });

    // Create initial A4 frame if page is empty (fresh canvas)
    const existingFrames = getFramesSorted(editor);
    if (existingFrames.length === 0) {
      createPageFrame(editor, 1);
    }

    // Fit the initial view to show all frames
    editor.zoomToFit();

    // Auto-create: ensure there's always an empty frame at the bottom.
    // Uses setTimeout(0) so tldraw finishes auto-parenting before we check.
    editor.sideEffects.registerAfterCreateHandler("shape", (shape) => {
      if (shape.type === "frame") return;
      setTimeout(() => ensureTrailingEmptyFrame(editor), 0);
    });
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw
        store={store}
        onMount={handleMount}
        options={{ maxPages: 1 }}
      />
    </div>
  );
}

// --- Snapshot/Export handlers (frame-based) ---

/**
 * Handle a snapshot request by exporting a single frame's content.
 * Finds the frame by name (msg.page) or defaults to the first frame.
 */
async function handleSnapshotRequest(
  editor: Editor,
  ws: WebSocket,
  msg: SnapshotRequest,
) {
  const frames = getFramesSorted(editor);

  // Find requested frame by name, or default to first
  let targetFrame = frames[0];
  if (msg.page) {
    const found = frames.find(
      (f) => f.id === msg.page || (f.props as { name: string }).name === msg.page,
    );
    if (found) targetFrame = found;
  }

  if (!targetFrame) {
    const response: SnapshotResponse = {
      type: "snapshot-response",
      requestId: msg.requestId,
      page: "",
      png: "",
    };
    ws.send(JSON.stringify(response));
    return;
  }

  const frameName = (targetFrame.props as { name: string }).name;
  const childIds = editor.getSortedChildIdsForParent(targetFrame.id);
  const children = childIds
    .map((id) => editor.getShape(id))
    .filter((s): s is TLShape => s != null);

  let png = "";
  if (children.length > 0) {
    const bounds = editor.getShapePageBounds(targetFrame);
    if (bounds) {
      const result = await editor.toImage([targetFrame, ...children], {
        format: "png",
        pixelRatio: 2,
        bounds,
        padding: 0,
        background: true,
      });
      png = await blobToBase64(result.blob);
    }
  }

  const response: SnapshotResponse = {
    type: "snapshot-response",
    requestId: msg.requestId,
    page: frameName,
    png,
  };
  ws.send(JSON.stringify(response));
}

/**
 * Handle an export request by exporting each frame individually.
 * Iterates all frames sorted by Y position, exports each with its bounds.
 */
async function handleExportRequest(
  editor: Editor,
  ws: WebSocket,
  msg: ExportRequest,
) {
  const frames = getFramesSorted(editor);
  const pageImages: Array<{ name: string; png: string }> = [];

  for (const frame of frames) {
    const frameName = (frame.props as { name: string }).name;
    const childIds = editor.getSortedChildIdsForParent(frame.id);
    const children = childIds
      .map((id) => editor.getShape(id))
      .filter((s): s is TLShape => s != null);

    let png = "";
    if (children.length > 0) {
      const bounds = editor.getShapePageBounds(frame);
      if (bounds) {
        const result = await editor.toImage([frame, ...children], {
          format: "png",
          pixelRatio: 2,
          bounds,
          padding: 0,
          background: true,
        });
        png = await blobToBase64(result.blob);
      }
    }

    pageImages.push({ name: frameName, png });
  }

  const response: ExportResponse = {
    type: "export-response",
    requestId: msg.requestId,
    pages: pageImages,
  };
  ws.send(JSON.stringify(response));
}

/** Convert a Blob to a base64 string (without data URL prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// --- Mount ---

const root = createRoot(document.getElementById("root")!);
root.render(<CanvasApp />);
