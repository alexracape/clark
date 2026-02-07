import { test, expect, describe } from "bun:test";
import { CanvasBroker } from "../src/canvas/server.ts";
import { composePDF } from "../src/canvas/pdf-export.ts";
import { extractBlurryShapes } from "../src/canvas/context.ts";

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
