/**
 * tldraw canvas app for iPad.
 *
 * Connects to the server's TLSocketRoom via useSync for real-time collaboration,
 * and opens a separate WebSocket for snapshot/export broker messages.
 */

import React, { useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useSync } from "@tldraw/sync";
import { Tldraw, inlineBase64AssetStore, type Editor } from "tldraw";
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

    // Create A4 frame if current page is empty
    const shapes = editor.getCurrentPageShapes();
    if (shapes.length === 0) {
      editor.createShape({
        type: "frame",
        x: 0,
        y: 0,
        props: {
          w: A4_WIDTH,
          h: A4_HEIGHT,
          name: "Page 1",
        },
      });
    }
    editor.zoomToFit();

    // Add an A4 frame to every newly created page
    editor.sideEffects.registerAfterCreateHandler("page", (page) => {
      setTimeout(() => {
        if (editor.getCurrentPageId() !== page.id) return;
        const pageShapes = editor.getCurrentPageShapes();
        if (!pageShapes.some((s) => s.type === "frame")) {
          editor.createShape({
            type: "frame",
            x: 0,
            y: 0,
            props: {
              w: A4_WIDTH,
              h: A4_HEIGHT,
              name: page.name,
            },
          });
          editor.zoomToFit();
        }
      }, 0);
    });
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw store={store} onMount={handleMount} />
    </div>
  );
}

// --- Snapshot/Export handlers ---

async function handleSnapshotRequest(
  editor: Editor,
  ws: WebSocket,
  msg: SnapshotRequest,
) {
  const originalPage = editor.getCurrentPage();

  // Switch to requested page if specified
  if (msg.page) {
    const pages = editor.getPages();
    const targetPage = pages.find(
      (p) => p.id === msg.page || p.name === msg.page,
    );
    if (targetPage) {
      editor.setCurrentPage(targetPage.id);
    }
  }

  const currentPage = editor.getCurrentPage();
  const shapes = editor.getCurrentPageShapes();

  let png = "";
  if (shapes.length > 0) {
    const result = await editor.toImage(shapes, {
      format: "png",
      pixelRatio: 2,
    });
    png = await blobToBase64(result.blob);
  }

  // Restore original page if we switched
  if (currentPage.id !== originalPage.id) {
    editor.setCurrentPage(originalPage.id);
  }

  const response: SnapshotResponse = {
    type: "snapshot-response",
    requestId: msg.requestId,
    page: currentPage.name,
    png,
  };
  ws.send(JSON.stringify(response));
}

async function handleExportRequest(
  editor: Editor,
  ws: WebSocket,
  msg: ExportRequest,
) {
  const originalPage = editor.getCurrentPage();
  const pages = editor.getPages();
  const pageImages: Array<{ name: string; png: string }> = [];

  for (const page of pages) {
    editor.setCurrentPage(page.id);
    const shapes = editor.getCurrentPageShapes();

    let png = "";
    if (shapes.length > 0) {
      const result = await editor.toImage(shapes, {
        format: "png",
        pixelRatio: 2,
      });
      png = await blobToBase64(result.blob);
    }

    pageImages.push({ name: page.name, png });
  }

  // Restore original page
  editor.setCurrentPage(originalPage.id);

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
