import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { CloudOCRProvider } from "../core/ocr/cloud.ts";

const CLOUD_URL = "https://test-cloud.example.com";
const CLOUD_SECRET = "test-secret";
const CLIENT_ID = "test-client-id";

describe("CloudOCRProvider", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("has the correct name", () => {
    const provider = new CloudOCRProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    expect(provider.name).toBe("clark-cloud-ocr");
  });

  it("transcribes an image via cloud endpoint", async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe(`${CLOUD_URL}/api/ocr`);
      expect(init?.method).toBe("POST");

      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${CLOUD_SECRET}`);
      expect(headers["X-Clark-Client-Id"]).toBe(CLIENT_ID);

      const body = JSON.parse(init?.body as string);
      expect(body.image).toBeDefined();
      expect(body.mimeType).toBe("image/png");

      return new Response(JSON.stringify({ markdown: "# Transcribed content" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const provider = new CloudOCRProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    const imageBuffer = new ArrayBuffer(10);
    const result = await provider.transcribeImage(imageBuffer, "image/png");
    expect(result).toBe("# Transcribed content");
  });

  it("transcribes a full PDF via cloud endpoint", async () => {
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.pdf).toBeDefined();
      expect(body.image).toBeUndefined();

      return new Response(JSON.stringify({ markdown: "# PDF content", pageCount: 3 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const provider = new CloudOCRProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    const pdfBuffer = new ArrayBuffer(100);
    const result = await provider.transcribePDF(pdfBuffer);
    expect(result.markdown).toBe("# PDF content");
    expect(result.pageCount).toBe(3);
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = async () => {
      return new Response("Server error", { status: 500 });
    };

    const provider = new CloudOCRProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    await expect(provider.transcribeImage(new ArrayBuffer(10), "image/png"))
      .rejects.toThrow("Cloud OCR error (500)");
  });

  it("consolidateTranscript is a pass-through", async () => {
    const provider = new CloudOCRProvider(CLOUD_URL, CLOUD_SECRET, CLIENT_ID);
    const input = "# Page 1\nContent\n\n# Page 2\nMore content";
    const result = await provider.consolidateTranscript(input);
    expect(result).toBe(input);
  });
});
