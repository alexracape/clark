/**
 * tldraw canvas server.
 *
 * Hosts the tldraw app over HTTP and manages sync via TLSocketRoom.
 * Two WebSocket endpoints:
 *   /sync — tldraw sync protocol (TLSocketRoom <-> useSync)
 *   /ws   — custom JSON messages (CanvasBroker <-> iPad message handler)
 */

import { dirname } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { TLSocketRoom, InMemorySyncStorage, type RoomSnapshot, type WebSocketMinimal } from "@tldraw/sync-core";

// Static Bun HTML import — ensures proper bundling and asset route registration
import indexHtml from "./index.html";

// Types for the WebSocket message broker
export interface SnapshotRequest {
  type: "snapshot-request";
  requestId: string;
  page?: string;
}

export interface SnapshotResponse {
  type: "snapshot-response";
  requestId: string;
  page: string;
  png: string; // base64
}

export interface ExportRequest {
  type: "export-request";
  requestId: string;
}

export interface ExportResponse {
  type: "export-response";
  requestId: string;
  pages: Array<{ name: string; png: string }>;
}

export type CanvasMessage =
  | SnapshotRequest
  | SnapshotResponse
  | ExportRequest
  | ExportResponse;

/**
 * Pending request that's waiting for a response from the iPad client.
 */
interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket message broker for communicating with the iPad client.
 * The MCP server uses this to request snapshots and exports.
 */
/** Minimal WebSocket interface for the broker (works with Bun ServerWebSocket). */
interface BrokerSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export class CanvasBroker {
  private pendingSnapshots = new Map<string, PendingRequest<SnapshotResponse>>();
  private pendingExports = new Map<string, PendingRequest<ExportResponse>>();
  private clientSocket: BrokerSocket | null = null;
  private requestCounter = 0;

  /** Register the iPad client's WebSocket connection (wrapped for Bun compatibility) */
  setClientSocket(ws: { send(data: string): void; close(code?: number, reason?: string): void } | null) {
    this.clientSocket = ws ? { send: (d: string) => ws.send(d), close: (c?, r?) => ws.close(c, r) } : null;
  }

  /** Handle an incoming message from the iPad client */
  handleMessage(data: string): boolean {
    let msg: CanvasMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return false; // Not a JSON message, let tldraw sync handle it
    }

    if (msg.type === "snapshot-response") {
      const pending = this.pendingSnapshots.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingSnapshots.delete(msg.requestId);
        pending.resolve(msg);
      }
      return true;
    }

    if (msg.type === "export-response") {
      const pending = this.pendingExports.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingExports.delete(msg.requestId);
        pending.resolve(msg);
      }
      return true;
    }

    return false; // Not a canvas broker message
  }

  /** Request a snapshot of a canvas page from the iPad client */
  async requestSnapshot(page?: string, timeoutMs = 15000): Promise<SnapshotResponse> {
    if (!this.clientSocket) {
      throw new Error("No iPad client connected");
    }

    const requestId = `snap-${++this.requestCounter}`;
    const request: SnapshotRequest = { type: "snapshot-request", requestId, page };

    return new Promise<SnapshotResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSnapshots.delete(requestId);
        reject(new Error("Snapshot request timed out"));
      }, timeoutMs);

      this.pendingSnapshots.set(requestId, { resolve, reject, timeout });
      this.clientSocket!.send(JSON.stringify(request));
    });
  }

  /** Request all pages as images for PDF export from the iPad client */
  async requestExport(timeoutMs = 30000): Promise<ExportResponse> {
    if (!this.clientSocket) {
      throw new Error("No iPad client connected");
    }

    const requestId = `export-${++this.requestCounter}`;
    const request: ExportRequest = { type: "export-request", requestId };

    return new Promise<ExportResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingExports.delete(requestId);
        reject(new Error("Export request timed out"));
      }, timeoutMs);

      this.pendingExports.set(requestId, { resolve, reject, timeout });
      this.clientSocket!.send(JSON.stringify(request));
    });
  }

  /** Check if an iPad client is connected */
  get isConnected(): boolean {
    return this.clientSocket !== null;
  }
}

// --- Persistence helpers ---

/** Load a snapshot from disk, or return undefined if none exists. */
export async function loadSnapshot(snapshotPath: string): Promise<RoomSnapshot | undefined> {
  try {
    const file = Bun.file(snapshotPath);
    if (await file.exists()) {
      return await file.json();
    }
  } catch {
    // Corrupt or missing file — start fresh
  }
  return undefined;
}

/** Write a snapshot to disk. */
export async function writeSnapshot(snapshot: RoomSnapshot, snapshotPath: string): Promise<void> {
  await mkdir(dirname(snapshotPath), { recursive: true });
  await Bun.write(snapshotPath, JSON.stringify(snapshot));
}

/**
 * List existing canvas files in a directory.
 * Returns canvas names (without .tldr extension), sorted alphabetically.
 */
export async function listCanvasFiles(canvasDir: string): Promise<string[]> {
  try {
    const entries = await readdir(canvasDir);
    return entries
      .filter((e) => e.endsWith(".tldr"))
      .map((e) => e.replace(/\.tldr$/, ""))
      .sort();
  } catch {
    // Directory doesn't exist yet — no canvases
    return [];
  }
}

// --- WebSocket wrapper ---

/**
 * Wraps a Bun ServerWebSocket to satisfy tldraw's WebSocketMinimal interface.
 * Bun's native WS methods can throw "Illegal invocation" if their `this` context
 * is lost (e.g. when stored in an object property and called later). Binding
 * the methods explicitly prevents this.
 */
function wrapBunSocket(ws: { send(data: string): void; close(code?: number, reason?: string): void; readyState: number }): WebSocketMinimal {
  return {
    send: (data: string) => { ws.send(data); },
    close: (code?: number, reason?: string) => { ws.close(code, reason); },
    get readyState() { return ws.readyState; },
  };
}

// --- Server ---

export interface CanvasServerOptions {
  port: number;
  broker: CanvasBroker;
  /** Full path to the .tldr snapshot file for persistence. */
  snapshotPath: string;
}

export interface CanvasServerResult {
  server: ReturnType<typeof Bun.serve>;
  room: TLSocketRoom;
  saveSnapshot: () => Promise<void>;
}

/**
 * Start the canvas server.
 *
 * Serves the tldraw app at /, handles tldraw sync on /sync,
 * and custom broker messages on /ws.
 */
export async function startCanvasServer(options: CanvasServerOptions): Promise<CanvasServerResult> {
  const { port, broker, snapshotPath } = options;

  // Load persisted snapshot and create storage
  const initialSnapshot = await loadSnapshot(snapshotPath);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const storage = new InMemorySyncStorage({
    snapshot: initialSnapshot,
    onChange() {
      // Debounced auto-save (2s)
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        writeSnapshot(storage.getSnapshot(), snapshotPath);
      }, 2000);
    },
  });

  const room = new TLSocketRoom({ storage });

  /** Manually save current snapshot to disk. */
  async function saveSnapshot(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await writeSnapshot(storage.getSnapshot(), snapshotPath);
  }

  const server = Bun.serve({
    port,
    routes: {
      "/": indexHtml,
    },
    fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/sync") {
        const sessionId = url.searchParams.get("sessionId") ?? crypto.randomUUID();
        const upgraded = server.upgrade(req, {
          data: { type: "sync", sessionId },
        });
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      }

      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, {
          data: { type: "canvas" },
        });
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        const data = ws.data as { type: string; sessionId?: string };
        if (data.type === "sync") {
          // Wrap Bun WS with bound methods for TLSocketRoom compatibility
          room.handleSocketConnect({
            sessionId: data.sessionId!,
            socket: wrapBunSocket(ws),
          });
        } else if (data.type === "canvas") {
          broker.setClientSocket(ws);
        }
      },
      message(ws, message) {
        const data = ws.data as { type: string; sessionId?: string };
        if (data.type === "sync") {
          // Use manual message routing for Bun (no addEventListener on ServerWebSocket)
          room.handleSocketMessage(data.sessionId!, message);
        } else if (data.type === "canvas") {
          const text = typeof message === "string" ? message : new TextDecoder().decode(message);
          broker.handleMessage(text);
        }
      },
      close(ws) {
        const data = ws.data as { type: string; sessionId?: string };
        if (data.type === "sync") {
          room.handleSocketClose(data.sessionId!);
        } else if (data.type === "canvas") {
          broker.setClientSocket(null);
        }
      },
    },
  });

  return { server, room, saveSnapshot };
}
