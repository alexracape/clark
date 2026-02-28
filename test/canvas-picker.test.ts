import { afterEach, describe, expect, test } from "bun:test";
import { openCanvasAndCopy } from "../gui/src/components/CanvasPicker.tsx";

const originalNavigator = globalThis.navigator;

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText } },
    configurable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
  });
});

describe("CanvasPicker openCanvasAndCopy", () => {
  test("returns open-stage error when open_canvas fails", async () => {
    setClipboard(async () => {});
    const invoke = async () => {
      throw new Error("open failed");
    };

    const out = await openCanvasAndCopy(invoke, "HW1");
    expect(out.ok).toBe(false);
    expect(out.stage).toBe("open");
    expect(out.error).toContain("open failed");
  });

  test("returns copy-stage error when clipboard write fails", async () => {
    setClipboard(async () => {
      throw new Error("clipboard denied");
    });
    const invoke = async () => ({ name: "HW1", url: "http://127.0.0.1:3000/?token=abc" });

    const out = await openCanvasAndCopy(invoke, "HW1");
    expect(out.ok).toBe(false);
    expect(out.stage).toBe("copy");
    expect(out.info).toEqual({ name: "HW1", url: "http://127.0.0.1:3000/?token=abc" });
    expect(out.error).toContain("clipboard denied");
  });

  test("returns success with canvas info when copy succeeds", async () => {
    let copied = "";
    setClipboard(async (text) => {
      copied = text;
    });
    const invoke = async () => ({ name: "HW2", url: "http://127.0.0.1:3000/?token=xyz" });

    const out = await openCanvasAndCopy(invoke, "HW2");
    expect(out.ok).toBe(true);
    expect(out.info).toEqual({ name: "HW2", url: "http://127.0.0.1:3000/?token=xyz" });
    expect(copied).toBe("http://127.0.0.1:3000/?token=xyz");
  });
});

