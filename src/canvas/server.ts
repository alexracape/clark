/**
 * tldraw canvas server.
 *
 * Hosts the tldraw app over HTTP and manages sync via TLSocketRoom.
 * Handles custom WebSocket messages for snapshot/export requests
 * alongside the tldraw sync protocol.
 */

import { resolve } from "node:path";

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
export class CanvasBroker {
  private pendingSnapshots = new Map<string, PendingRequest<SnapshotResponse>>();
  private pendingExports = new Map<string, PendingRequest<ExportResponse>>();
  private clientSocket: WebSocket | null = null;
  private requestCounter = 0;

  /** Register the iPad client's WebSocket connection */
  setClientSocket(ws: WebSocket | null) {
    this.clientSocket = ws;
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

export interface CanvasServerOptions {
  port: number;
  broker: CanvasBroker;
}

/**
 * Start the canvas server.
 *
 * TODO: Integrate TLSocketRoom for sync, serve tldraw app HTML,
 * and wire up WebSocket handling for both sync and custom messages.
 */
export function startCanvasServer(options: CanvasServerOptions) {
  const { port, broker } = options;

  const server = Bun.serve({
    port,
    routes: {
      "/": new Response("canvas server placeholder", {
        headers: { "Content-Type": "text/html" },
      }),
    },
    websocket: {
      open(ws) {
        broker.setClientSocket(ws as unknown as WebSocket);
      },
      message(ws, message) {
        const data = typeof message === "string" ? message : new TextDecoder().decode(message);
        const handled = broker.handleMessage(data);
        if (!handled) {
          // TODO: Forward to TLSocketRoom for sync protocol handling
        }
      },
      close() {
        broker.setClientSocket(null);
      },
    },
  });

  return server;
}
