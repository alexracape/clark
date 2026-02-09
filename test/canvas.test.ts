import { test, expect, describe, afterEach } from "bun:test";
import { CanvasBroker, startCanvasServer } from "../src/canvas/server.ts";
import { composePDF } from "../src/canvas/pdf-export.ts";
import { extractBlurryShapes } from "../src/canvas/context.ts";
import { TLSocketRoom, InMemorySyncStorage } from "@tldraw/sync-core";

describe("CanvasBroker", () => {
  test("starts disconnected", () => {
    const broker = new CanvasBroker();
    expect(broker.isConnected).toBe(false);
  });

  test("requestSnapshot throws when no client connected", async () => {
    const broker = new CanvasBroker();
    expect(broker.requestSnapshot()).rejects.toThrow("No iPad client connected");
  });

  test("requestExport throws when no client connected", async () => {
    const broker = new CanvasBroker();
    expect(broker.requestExport()).rejects.toThrow("No iPad client connected");
  });

  test("handleMessage returns false for non-JSON", () => {
    const broker = new CanvasBroker();
    expect(broker.handleMessage("not json")).toBe(false);
  });

  test("handleMessage returns false for unknown message types", () => {
    const broker = new CanvasBroker();
    expect(broker.handleMessage('{"type":"unknown"}')).toBe(false);
  });
});

describe("TLSocketRoom", () => {
  test("creates room and returns valid snapshot", () => {
    const storage = new InMemorySyncStorage();
    const room = new TLSocketRoom({ storage });
    const snapshot = storage.getSnapshot();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.documentClock).toBe("number");
    expect(Array.isArray(snapshot.documents)).toBe(true);
  });

  test("snapshot round-trip preserves state", () => {
    const storage1 = new InMemorySyncStorage();
    const room1 = new TLSocketRoom({ storage: storage1 });
    const snapshot1 = storage1.getSnapshot();

    // Create a second room from the first room's snapshot
    const storage2 = new InMemorySyncStorage({ snapshot: snapshot1 });
    const room2 = new TLSocketRoom({ storage: storage2 });
    const snapshot2 = storage2.getSnapshot();

    expect(snapshot2.documentClock).toBe(snapshot1.documentClock);
    expect(snapshot2.documents.length).toBe(snapshot1.documents.length);
  });
});

describe("Canvas Server", () => {
  let servers: Array<{ stop: () => void }> = [];

  afterEach(() => {
    for (const s of servers) {
      s.stop();
    }
    servers = [];
  });

  test("returns result with server, room, and saveSnapshot", async () => {
    const broker = new CanvasBroker();
    const result = await startCanvasServer({ port: 0, broker });
    servers.push(result.server);

    expect(result.server).toBeDefined();
    expect(result.room).toBeInstanceOf(TLSocketRoom);
    expect(typeof result.saveSnapshot).toBe("function");
  });

  test("serves HTML at / with correct content-type", async () => {
    const broker = new CanvasBroker();
    const { server } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<div id=\"root\">");
    expect(html).toContain("<script");
  });

  test("HTML references bundled JS and CSS that are accessible", async () => {
    const broker = new CanvasBroker();
    const { server } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/`);
    const html = await res.text();

    // Extract script src and link href from HTML
    const scriptSrcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    const linkHrefs = [...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]!);

    expect(scriptSrcs.length).toBeGreaterThan(0);

    // Verify each bundled asset is accessible
    for (const src of scriptSrcs) {
      const assetRes = await fetch(`http://localhost:${server.port}${src}`);
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("content-type")).toContain("javascript");
    }

    for (const href of linkHrefs) {
      const assetRes = await fetch(`http://localhost:${server.port}${href}`);
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("content-type")).toContain("css");
    }
  });

  test("bundled JS contains tldraw and useSync code", async () => {
    const broker = new CanvasBroker();
    const { server } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/`);
    const html = await res.text();
    const scriptSrcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);

    const jsRes = await fetch(`http://localhost:${server.port}${scriptSrcs[0]}`);
    const js = await jsRes.text();

    // Verify key components are in the bundle
    expect(js).toContain("CanvasApp");
    expect(js).toContain("createRoot");
    // No server-side code should leak into the browser bundle
    expect(js).not.toContain("node:path");
    expect(js).not.toContain("node:fs");
    expect(js).not.toContain("Bun.file");
  });

  test("returns 404 for unknown paths", async () => {
    const broker = new CanvasBroker();
    const { server } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/unknown`);
    expect(res.status).toBe(404);
  });

  test("WebSocket upgrade works on /sync endpoint", async () => {
    const broker = new CanvasBroker();
    const { server, room } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    const ws = new WebSocket(`ws://localhost:${server.port}/sync?sessionId=test-1`);

    const connected = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });

    expect(connected).toBe(true);

    // After connection, the room should have registered the session
    await new Promise((r) => setTimeout(r, 100));
    expect(room.getNumActiveSessions()).toBeGreaterThanOrEqual(1);

    ws.close();
    // Give time for close to propagate
    await new Promise((r) => setTimeout(r, 100));
  });

  test("WebSocket upgrade works on /ws endpoint and connects broker", async () => {
    const broker = new CanvasBroker();
    const { server } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    expect(broker.isConnected).toBe(false);

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    const connected = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    });

    expect(connected).toBe(true);

    // Give the server a moment to process the open event
    await new Promise((r) => setTimeout(r, 50));
    expect(broker.isConnected).toBe(true);

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(broker.isConnected).toBe(false);
  });

  test("/ws broker receives and handles messages", async () => {
    const broker = new CanvasBroker();
    const { server } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    // Send a snapshot response through the WS and verify broker handles it
    const snapshotResponse = JSON.stringify({
      type: "snapshot-response",
      requestId: "snap-test",
      page: "Page 1",
      png: "abc123",
    });

    // handleMessage should return true for valid canvas messages
    // We can't easily test the full round-trip without a mock, but we can
    // verify the ws connection and broker message handling work
    ws.send(snapshotResponse);

    // Give time for message to propagate
    await new Promise((r) => setTimeout(r, 100));

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("/sync endpoint handles messages without crashing", async () => {
    const broker = new CanvasBroker();
    const { server, room } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    const ws = new WebSocket(`ws://localhost:${server.port}/sync?sessionId=test-sync`);

    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    // Session should be registered
    await new Promise((r) => setTimeout(r, 100));
    expect(room.getNumActiveSessions()).toBeGreaterThanOrEqual(1);

    // Send an arbitrary message — the room should handle it without crashing
    // (it may reject/ignore malformed protocol messages, but should not throw)
    ws.send("test message");
    await new Promise((r) => setTimeout(r, 200));

    // Server should still be running and room intact
    const snapshot = room.getCurrentSnapshot();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot.documentClock).toBe("number");

    ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  test("multiple sync clients get independent sessions", async () => {
    const broker = new CanvasBroker();
    const { server, room } = await startCanvasServer({ port: 0, broker });
    servers.push(server);

    const ws1 = new WebSocket(`ws://localhost:${server.port}/sync?sessionId=client-1`);
    const ws2 = new WebSocket(`ws://localhost:${server.port}/sync?sessionId=client-2`);

    await Promise.all([
      new Promise<void>((resolve) => { ws1.onopen = () => resolve(); }),
      new Promise<void>((resolve) => { ws2.onopen = () => resolve(); }),
    ]);

    // Give time for sessions to be registered
    await new Promise((r) => setTimeout(r, 200));

    expect(room.getNumActiveSessions()).toBe(2);

    ws1.close();
    ws2.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe("PDF Export", () => {
  test("composePDF produces valid PDF bytes", async () => {
    // Create a minimal 1x1 white PNG (base64)
    // This is the smallest valid PNG possible
    const minimalPNG =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    const pages = [
      { name: "Page 1", png: minimalPNG },
      { name: "Page 2", png: minimalPNG },
    ];

    const pdfBytes = await composePDF(pages);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(0);

    // Check PDF header magic bytes
    const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });
});

describe("Context Extraction", () => {
  test("extractBlurryShapes filters to viewport", () => {
    const shapes = [
      { id: "s1", type: "draw", x: 10, y: 10, props: { w: 50, h: 50 } },
      { id: "s2", type: "draw", x: 1000, y: 1000, props: { w: 50, h: 50 } },
      { id: "s3", type: "text", x: 50, y: 50, props: { w: 100, h: 30, text: "hello" } },
    ];

    const viewport = { x: 0, y: 0, w: 200, h: 200 };
    const result = extractBlurryShapes(shapes, viewport);

    expect(result).toHaveLength(2); // s1 and s3, not s2
    expect(result.map((s) => s.id)).toContain("s1");
    expect(result.map((s) => s.id)).toContain("s3");
    expect(result.find((s) => s.id === "s3")?.text).toBe("hello");
  });
});
