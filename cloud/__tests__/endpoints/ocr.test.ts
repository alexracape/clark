import { describe, test, expect } from "bun:test";
import ocrHandler from "../../api/ocr.ts";
import {
  useMockRedis,
  useBetaClient,
  useCloudEnv,
  useFetchMock,
  clientRequest,
  anonRequest,
  jsonBody,
} from "../helpers.ts";

const handler = ocrHandler.fetch.bind(ocrHandler);

describe("POST /api/ocr", () => {
  const store = useBetaClient("test-client-uuid");
  useCloudEnv({ MISTRAL_API_KEY: "mistral-test-key" });

  // Mock Mistral OCR API
  useFetchMock((url, init) => {
    if (url.includes("api.mistral.ai/v1/ocr")) {
      const body = JSON.parse(init?.body as string);
      const isPdf = body.document?.type === "document_url";
      return Response.json({
        pages: [
          { markdown: isPdf ? "# PDF Page 1\nContent" : "# Image transcription" },
          ...(isPdf ? [{ markdown: "# PDF Page 2\nMore content" }] : []),
        ],
      });
    }
    return null;
  });

  test("rejects non-POST methods", async () => {
    const res = await handler(clientRequest("/api/ocr", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  test("returns 400 when X-Clark-Client-Id is missing", async () => {
    const res = await handler(
      anonRequest("/api/ocr", { body: { image: "base64data" } }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 403 for anonymous client (beta-gated)", async () => {
    store.clear();
    const res = await handler(
      clientRequest("/api/ocr", { body: { image: "base64data" } }),
    );
    expect(res.status).toBe(403);

    store.set("beta:test-client-uuid", "1");
  });

  test("returns 400 when neither pdf nor image is provided", async () => {
    const res = await handler(
      clientRequest("/api/ocr", { body: {} }),
    );
    expect(res.status).toBe(400);
  });

  test("transcribes an image", async () => {
    const res = await handler(
      clientRequest("/api/ocr", {
        body: { image: "base64imagedata", mimeType: "image/png" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.markdown).toContain("Image transcription");
  });

  test("transcribes a PDF with page count", async () => {
    const res = await handler(
      clientRequest("/api/ocr", { body: { pdf: "base64pdfdata" } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.markdown).toContain("PDF Page 1");
    expect(body.pageCount).toBe(2);
  });

  test("returns 500 when MISTRAL_API_KEY is missing", async () => {
    const original = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    try {
      const res = await handler(
        clientRequest("/api/ocr", { body: { image: "data" } }),
      );
      expect(res.status).toBe(500);
      const body = await jsonBody(res);
      expect(body.error).toContain("MISTRAL_API_KEY");
    } finally {
      if (original) process.env.MISTRAL_API_KEY = original;
    }
  });

  test("returns 502 when Mistral API returns an error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("api.mistral.ai")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return originalFetch(input);
    };
    try {
      const res = await handler(
        clientRequest("/api/ocr", { body: { image: "data" } }),
      );
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
