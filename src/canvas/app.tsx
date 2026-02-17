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
import {
  intermediateBlankFrameIds,
  trimTrailingBlankFrames,
} from "./frame-heuristics.ts";

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

function getFrameChildren(editor: Editor, frame: TLShape): TLShape[] {
  const childIds = editor.getSortedChildIdsForParent(frame.id);
  return childIds
    .map((id) => editor.getShape(id))
    .filter((shape): shape is TLShape => shape != null);
}

/**
 * Reparent any page-level shapes to frames based on their position.
 * This ensures content is properly organized within frames.
 */
function reparentShapesToFrames(editor: Editor): void {
  const frames = getFramesSorted(editor);
  const pageId = editor.getCurrentPageId();
  const pageLevelShapes = editor.getCurrentPageShapes().filter(
    (shape) => shape.type !== "frame" && shape.parentId === pageId,
  );

  if (pageLevelShapes.length === 0) return;

  // Map each page-level shape to the frame it should belong to
  const reparentingMap = new Map<string, TLShape[]>();

  for (const shape of pageLevelShapes) {
    const shapeBounds = editor.getShapePageBounds(shape);
    if (!shapeBounds) continue;

    // Find which frame this shape belongs to (by center point)
    const centerY = shapeBounds.y + shapeBounds.h / 2;

    for (const frame of frames) {
      const frameBounds = editor.getShapePageBounds(frame);
      if (!frameBounds) continue;

      if (
        centerY >= frameBounds.y &&
        centerY < frameBounds.y + frameBounds.h &&
        shapeBounds.x < frameBounds.x + frameBounds.w &&
        shapeBounds.x + shapeBounds.w > frameBounds.x
      ) {
        if (!reparentingMap.has(frame.id)) {
          reparentingMap.set(frame.id, []);
        }
        reparentingMap.get(frame.id)!.push(shape);
        break;
      }
    }
  }

  // Reparent shapes to their frames
  for (const [frameId, shapes] of reparentingMap) {
    editor.reparentShapes(
      shapes.map((s) => s.id),
      frameId,
    );
  }
}

function frameIsBlank(editor: Editor, frame: TLShape): boolean {
  const hasChildContent = getFrameChildren(editor, frame).length > 0;
  return !hasChildContent;
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
  if (!frameIsBlank(editor, lastFrame)) createPageFrame(editor, frames.length + 1);
}

function normalizeFrameStack(editor: Editor): void {
  const frames = getFramesSorted(editor);
  const updates: TLShape[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const expected = expectedFrameGeometry(i + 1);
    const expectedName = `Page ${i + 1}`;
    const props = frame.props as { w?: number; h?: number; name?: string };
    if (
      frame.x !== expected.x ||
      frame.y !== expected.y ||
      props.w !== expected.w ||
      props.h !== expected.h ||
      props.name !== expectedName
    ) {
      updates.push({
        ...frame,
        x: expected.x,
        y: expected.y,
        props: { ...frame.props, w: expected.w, h: expected.h, name: expectedName },
      });
    }
  }

  if (updates.length > 0) editor.updateShapes(updates);
}

function cleanupIntermediateBlankFrames(editor: Editor): void {
  const frames = getFramesSorted(editor);
  const blankFrames = intermediateBlankFrameIds(
    frames.map((frame) => ({
      id: frame.id,
      isBlank: frameIsBlank(editor, frame),
    })),
  );
  if (blankFrames.length === 0) return;
  editor.deleteShapes(blankFrames);
  normalizeFrameStack(editor);
}

function CanvasApp() {
  const editorRef = useRef<Editor | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const maintenanceRunningRef = useRef(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  // Build sync URI from current page host
  const syncUri = `ws://${window.location.host}/sync?token=${encodeURIComponent(token)}`;

  // Connect to TLSocketRoom via useSync (following tldraw official example)
  const store = useSync({
    uri: syncUri,
    assets: inlineBase64AssetStore,
  });

  // --- Broker WebSocket (for snapshot/export requests) ---

  const connectBrokerWs = useCallback(() => {
    const wsUrl = `ws://${window.location.host}/ws?token=${encodeURIComponent(token)}`;
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
  }, [token]);

  useEffect(() => {
    connectBrokerWs();
    return () => {
      wsRef.current?.close();
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
      }
    };
  }, [connectBrokerWs]);

  // --- Editor onMount ---

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    // Immediate maintenance: ensure trailing blank + normalize positions
    const runImmediateMaintenance = () => {
      if (maintenanceRunningRef.current) return;
      maintenanceRunningRef.current = true;
      try {
        editor.run(() => {
          reparentShapesToFrames(editor);
          ensureTrailingEmptyFrame(editor);
          normalizeFrameStack(editor);
        }, { history: "ignore" });
      } finally {
        maintenanceRunningRef.current = false;
      }
    };

    // Debounced cleanup: remove intermediate blank frames after user stops editing
    const scheduleDebouncedCleanup = () => {
      // Clear any pending cleanup
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
      }

      // Schedule cleanup for 750ms after last user operation
      cleanupTimerRef.current = setTimeout(() => {
        if (maintenanceRunningRef.current) return;
        maintenanceRunningRef.current = true;
        try {
          editor.run(() => {
            reparentShapesToFrames(editor);
            cleanupIntermediateBlankFrames(editor);
            ensureTrailingEmptyFrame(editor);
            normalizeFrameStack(editor);
          }, { history: "ignore" });
        } finally {
          maintenanceRunningRef.current = false;
        }
      }, 750);
    };

    // Create initial A4 frame if page is empty (fresh canvas)
    const existingFrames = getFramesSorted(editor);
    if (existingFrames.length === 0) {
      createPageFrame(editor, 1);
    }
    editor.run(() => {
      reparentShapesToFrames(editor);
      normalizeFrameStack(editor);
    }, { history: "ignore" });

    // Fit the initial view to show all frames
    editor.zoomToFit();

    editor.sideEffects.registerOperationCompleteHandler((source) => {
      if (source !== "user") return;
      if (maintenanceRunningRef.current) return;

      // Always ensure trailing blank immediately (fast, non-disruptive)
      runImmediateMaintenance();

      // Schedule debounced cleanup of intermediate blanks (disruptive, so delayed)
      scheduleDebouncedCleanup();
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
 *
 * Robustness: Handles the case where users have deleted all frames.
 */
async function handleSnapshotRequest(
  editor: Editor,
  ws: WebSocket,
  msg: SnapshotRequest,
) {
  // Ensure shapes are properly parented before snapshot
  editor.run(() => {
    reparentShapesToFrames(editor);
  }, { history: "ignore" });

  const frames = getFramesSorted(editor);

  // Handle case where all frames have been deleted
  if (frames.length === 0) {
    const response: SnapshotResponse = {
      type: "snapshot-response",
      requestId: msg.requestId,
      page: "NO_FRAMES",
      png: "",
    };
    ws.send(JSON.stringify(response));
    return;
  }

  // Find requested frame by name, or default to first
  let targetFrame = frames[0];
  if (msg.page) {
    const found = frames.find(
      (f) => f.id === msg.page || (f.props as { name: string }).name === msg.page,
    );
    if (found) targetFrame = found;
  }

  // This shouldn't happen if frames.length > 0, but check anyway
  if (!targetFrame) {
    const response: SnapshotResponse = {
      type: "snapshot-response",
      requestId: msg.requestId,
      page: "ERROR",
      png: "",
    };
    ws.send(JSON.stringify(response));
    return;
  }

  const frameName = (targetFrame.props as { name: string }).name;
  const children = getFrameChildren(editor, targetFrame);

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
 *
 * Robustness: Returns empty pages array if no frames exist (frameless canvas).
 */
async function handleExportRequest(
  editor: Editor,
  ws: WebSocket,
  msg: ExportRequest,
) {
  // Ensure shapes are properly parented before export
  editor.run(() => {
    reparentShapesToFrames(editor);
  }, { history: "ignore" });

  const allFrames = getFramesSorted(editor);

  // Handle case where all frames have been deleted (frameless canvas)
  if (allFrames.length === 0) {
    const response: ExportResponse = {
      type: "export-response",
      requestId: msg.requestId,
      pages: [],
    };
    ws.send(JSON.stringify(response));
    return;
  }

  const frames = trimTrailingBlankFrames(
    allFrames.map((frame) => ({
      frame,
      isBlank: frameIsBlank(editor, frame),
    })),
  ).map((entry) => entry.frame);
  const pageImages: Array<{ name: string; png: string }> = [];

  for (const frame of frames) {
    const frameName = (frame.props as { name: string }).name;
    const children = getFrameChildren(editor, frame);

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
