import { describe, test, expect } from "bun:test";
import handler from "../../api/models.ts";
import { useFetchMock } from "../helpers.ts";

describe("GET /api/models", () => {
  useFetchMock((url) => {
    if (url.includes("ai-gateway.vercel.sh/v1/models")) {
      return Response.json({
        data: [
          {
            id: "anthropic/claude-sonnet-4.6",
            name: "Claude Sonnet 4.6",
            type: "language",
            context_window: 200000,
            max_tokens: 128000,
            tags: ["tool-use", "vision"],
            owned_by: "anthropic",
          },
          {
            id: "openai/gpt-4.1-mini",
            name: "GPT-4.1 Mini",
            type: "language",
            context_window: 1048576,
            max_tokens: 32768,
            owned_by: "openai",
          },
        ],
      });
    }
    return null;
  });

  test("rejects non-GET methods", async () => {
    const res = await handler.fetch(new Request("https://test.clark.dev/api/models", {
      method: "POST",
    }));
    expect(res.status).toBe(405);
  });

  test("skips malformed entries that do not include tags", async () => {
    const res = await handler.fetch(new Request("https://test.clark.dev/api/models", {
      method: "GET",
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { models: Array<{ id: string }> };
    expect(body.models).toHaveLength(1);
    expect(body.models[0]?.id).toBe("anthropic/claude-sonnet-4.6");
  });
});
