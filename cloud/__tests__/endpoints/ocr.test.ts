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
      const wantImages = body.include_image_base64 === true;

      const pages = isPdf
        ? [
            {
              markdown: wantImages
                ? "# PDF Page 1\n\n![img-0.jpeg](img-0.jpeg)\n\nContent"
                : "# PDF Page 1\nContent",
              ...(wantImages
                ? {
                    images: [
                      {
                        id: "img-0.jpeg",
                        image_base64: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
                        top_left_x: 10,
                        top_left_y: 20,
                        bottom_right_x: 200,
                        bottom_right_y: 300,
                      },
                    ],
                  }
                : {}),
            },
            {
              markdown: wantImages
                ? "# PDF Page 2\n\n![img-1.png](img-1.png)\n\nMore content"
                : "# PDF Page 2\nMore content",
              ...(wantImages
                ? {
                    images: [
                      {
                        id: "img-1.png",
                        image_base64: "data:image/png;base64,iVBORw0KGgoAAAANS==",
                      },
                    ],
                  }
                : {}),
            },
          ]
        : [
            {
              markdown: "# Image transcription",
              ...(wantImages
                ? { images: [] }
                : {}),
            },
          ];

      return Response.json({ pages });
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
    // Should not include images when extractImages is not set
    expect(body.images).toBeUndefined();
  });

  test("extracts images with Obsidian wikilinks when extractImages is true", async () => {
    const res = await handler(
      clientRequest("/api/ocr", { body: { pdf: "base64pdfdata", extractImages: true } }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);

    // Markdown should use Obsidian wikilink format
    expect(body.markdown).toContain("![[img-0.jpeg]]");
    expect(body.markdown).toContain("![[img-1.png]]");
    // Should NOT contain standard markdown image syntax
    expect(body.markdown).not.toContain("![img-0.jpeg](img-0.jpeg)");

    // Images array should be present
    expect(body.images).toBeArrayOfSize(2);

    // First image
    expect(body.images[0].id).toBe("img-0.jpeg");
    expect(body.images[0].data).toBe("/9j/4AAQSkZJRg==");
    expect(body.images[0].mediaType).toBe("image/jpeg");

    // Second image
    expect(body.images[1].id).toBe("img-1.png");
    expect(body.images[1].data).toBe("iVBORw0KGgoAAAANS==");
    expect(body.images[1].mediaType).toBe("image/png");
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
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url.includes("api.mistral.ai")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return originalFetch(input);
    }) as typeof fetch;
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
