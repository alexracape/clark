import { join } from "node:path";
import { CanvasBroker, listCanvasFiles, startCanvasServer } from "../canvas/index.ts";
import type { CanvasBrokerEvent } from "../canvas/server.ts";
import type { PageImage } from "../canvas/index.ts";
import { requireValidCanvasName } from "../canvas/name.ts";

export interface ActiveCanvasInfo {
  name: string;
  url: string;
}

interface ActiveCanvasSession {
  name: string;
  url: string;
  broker: CanvasBroker;
  server: ReturnType<typeof Bun.serve>;
  saveSnapshot: () => Promise<void>;
}

export interface CanvasSessionManagerOptions {
  port: number;
  canvasDir: string;
  getHost: () => string;
  bindHost: string;
}

export type CanvasConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "failed";

export interface CanvasConnectionStatus {
  state: CanvasConnectionState;
  sequence: number;
  at: number;
  reason: string;
}

/**
 * Manages exactly one active canvas server at a time.
 * Opening a new canvas will save and close the current one first.
 */
export class CanvasSessionManager {
  private readonly port: number;
  private readonly canvasDir: string;
  private readonly getHost: () => string;
  private readonly bindHost: string;
  private active: ActiveCanvasSession | null = null;
  private connectionStatusValue: CanvasConnectionStatus = {
    state: "disconnected",
    sequence: 0,
    at: Date.now(),
    reason: "initialized",
  };
  private connectionListeners = new Set<(status: CanvasConnectionStatus) => void>();
  private brokerUnsubscribe: (() => void) | null = null;
  private hadConnection = false;
  private isClosing = false;
  private resolvedPort: number | null = null;
  private authToken: string | null = null;

  constructor(options: CanvasSessionManagerOptions) {
    this.port = options.port;
    this.canvasDir = options.canvasDir;
    this.getHost = options.getHost;
    this.bindHost = options.bindHost;
  }

  get broker(): CanvasBroker | null {
    return this.active?.broker ?? null;
  }

  get saveCanvas(): (() => Promise<void>) | null {
    return this.active?.saveSnapshot ?? null;
  }

  get isConnected(): boolean {
    return this.connectionStatusValue.state === "connected";
  }

  get connectionStatus(): CanvasConnectionStatus {
    return this.connectionStatusValue;
  }

  get activeInfo(): ActiveCanvasInfo | null {
    if (!this.active) return null;
    return { name: this.active.name, url: this.active.url };
  }

  async list(): Promise<string[]> {
    return listCanvasFiles(this.canvasDir);
  }

  subscribeConnectionStatus(listener: (status: CanvasConnectionStatus) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionStatusValue);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private setConnectionState(state: CanvasConnectionState, reason: string): void {
    if (this.connectionStatusValue.state === state) return;
    const previous = this.connectionStatusValue.state;
    this.connectionStatusValue = {
      state,
      sequence: this.connectionStatusValue.sequence + 1,
      at: Date.now(),
      reason,
    };
    const isoTime = new Date(this.connectionStatusValue.at).toISOString();
    console.debug(
      `[canvas-status #${this.connectionStatusValue.sequence} ${isoTime}] ${previous} -> ${state} (${reason})`,
    );
    for (const listener of this.connectionListeners) listener(this.connectionStatusValue);
  }

  private handleBrokerEvent(event: CanvasBrokerEvent): void {
    if (event.type === "connected") {
      this.hadConnection = true;
      this.setConnectionState("connected", "client_connected");
      return;
    }

    if (event.type === "request_failed") {
      this.setConnectionState("failed", event.reason);
      return;
    }

    if (!this.active || this.isClosing) {
      this.setConnectionState("disconnected", event.reason);
      return;
    }

    if (this.hadConnection) {
      this.setConnectionState("reconnecting", event.reason);
      return;
    }

    this.setConnectionState("failed", event.reason);
  }

  async open(name: string): Promise<ActiveCanvasInfo> {
    const validatedName = requireValidCanvasName(name);
    if (this.active && this.active.name === validatedName) {
      return { name: this.active.name, url: this.active.url };
    }

    await this.close();
    this.setConnectionState("connecting", "canvas_opened");
    this.hadConnection = false;
    this.isClosing = false;

    const snapshotPath = join(this.canvasDir, `${validatedName}.tldr`);
    const broker = new CanvasBroker();
    this.brokerUnsubscribe = broker.subscribe((event) => this.handleBrokerEvent(event));
    const { server, saveSnapshot, authToken } = await startCanvasServer({
      port: this.resolvedPort ?? this.port,
      host: this.bindHost,
      broker,
      snapshotPath,
      authToken: this.authToken ?? undefined,
    });

    this.resolvedPort = server.port;
    this.authToken = authToken;
    const url = `http://${this.getHost()}:${server.port}/?token=${authToken}`;
    this.active = { name: validatedName, url, broker, server, saveSnapshot };
    return { name: validatedName, url };
  }

  async exportPages(timeoutMs = 30000): Promise<{ pages: PageImage[]; source: "live" }> {
    if (!this.active) {
      throw new Error("No canvas is open. Use /canvas to open one.");
    }
    try {
      const response = await this.active.broker.requestExport(timeoutMs);
      return { pages: response.pages, source: "live" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!this.isClosing && message !== "Canvas session closed") {
        this.setConnectionState("failed", "export_request_failed");
      }
      throw err;
    }
  }

  async save(): Promise<void> {
    if (!this.active) {
      throw new Error("No canvas is open. Use /canvas to open one.");
    }
    await this.active.saveSnapshot();
  }

  async close(): Promise<void> {
    if (!this.active) return;
    this.isClosing = true;

    try {
      await this.active.saveSnapshot();
    } catch {
      // Best effort save before shutdown.
    }

    this.active.broker.shutdown("Canvas session closed");
    this.brokerUnsubscribe?.();
    this.brokerUnsubscribe = null;
    this.active.server.stop();
    this.active = null;
    this.hadConnection = false;
    this.isClosing = false;
    this.setConnectionState("disconnected", "canvas_closed");
  }
}
