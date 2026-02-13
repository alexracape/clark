import { join } from "node:path";
import { CanvasBroker, listCanvasFiles, startCanvasServer } from "../canvas/index.ts";
import type { PageImage } from "../canvas/index.ts";

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
}

/**
 * Manages exactly one active canvas server at a time.
 * Opening a new canvas will save and close the current one first.
 */
export class CanvasSessionManager {
  private readonly port: number;
  private readonly canvasDir: string;
  private readonly getHost: () => string;
  private active: ActiveCanvasSession | null = null;

  constructor(options: CanvasSessionManagerOptions) {
    this.port = options.port;
    this.canvasDir = options.canvasDir;
    this.getHost = options.getHost;
  }

  get broker(): CanvasBroker | null {
    return this.active?.broker ?? null;
  }

  get saveCanvas(): (() => Promise<void>) | null {
    return this.active?.saveSnapshot ?? null;
  }

  get isConnected(): boolean {
    return this.active?.broker.isConnected ?? false;
  }

  get activeInfo(): ActiveCanvasInfo | null {
    if (!this.active) return null;
    return { name: this.active.name, url: this.active.url };
  }

  async list(): Promise<string[]> {
    return listCanvasFiles(this.canvasDir);
  }

  async open(name: string): Promise<ActiveCanvasInfo> {
    if (this.active && this.active.name === name) {
      return { name: this.active.name, url: this.active.url };
    }

    await this.close();

    const snapshotPath = join(this.canvasDir, `${name}.tldr`);
    const broker = new CanvasBroker();
    const { server, saveSnapshot } = await startCanvasServer({
      port: this.port,
      broker,
      snapshotPath,
    });

    const url = `http://${this.getHost()}:${server.port}`;
    this.active = { name, url, broker, server, saveSnapshot };
    return { name, url };
  }

  async exportPages(timeoutMs = 30000): Promise<{ pages: PageImage[]; source: "live" }> {
    if (!this.active) {
      throw new Error("No canvas is open. Use /canvas to open one.");
    }
    const response = await this.active.broker.requestExport(timeoutMs);
    return { pages: response.pages, source: "live" };
  }

  async save(): Promise<void> {
    if (!this.active) {
      throw new Error("No canvas is open. Use /canvas to open one.");
    }
    await this.active.saveSnapshot();
  }

  async close(): Promise<void> {
    if (!this.active) return;

    try {
      await this.active.saveSnapshot();
    } catch {
      // Best effort save before shutdown.
    }

    this.active.server.stop();
    this.active = null;
  }
}
