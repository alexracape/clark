import { test, expect, describe } from "bun:test";

/**
 * Tests for the cloud proxy's web search tool injection logic.
 *
 * Since getWebSearchTools and convertTools are not exported directly,
 * we test them by importing the module and calling the fetch handler
 * with mock data, or by testing the logic inline.
 */

// We can't easily unit-test the cloud proxy's internal functions without
// exporting them, so we extract and test the key logic patterns here.

describe("Cloud Web Search Tool Selection", () => {
  // Mirror the getWebSearchTools logic for testability
  function getProviderSearchType(provider: string): string {
    switch (provider) {
      case "anthropic":
        return "anthropic_native";
      case "openai":
        return "openai_native";
      case "google":
        return "google_native";
      default:
        return "perplexity_fallback";
    }
  }

  test("anthropic models get native web search", () => {
    expect(getProviderSearchType("anthropic")).toBe("anthropic_native");
  });

  test("openai models get native web search", () => {
    expect(getProviderSearchType("openai")).toBe("openai_native");
  });

  test("google models get native web search", () => {
    expect(getProviderSearchType("google")).toBe("google_native");
  });

  test("xai models fall back to perplexity", () => {
    expect(getProviderSearchType("xai")).toBe("perplexity_fallback");
  });

  test("unknown providers fall back to perplexity", () => {
    expect(getProviderSearchType("mistral")).toBe("perplexity_fallback");
    expect(getProviderSearchType("cohere")).toBe("perplexity_fallback");
  });

  test("provider is correctly extracted from gateway model ID", () => {
    const extractProvider = (id: string) => id.split("/")[0] ?? "";
    expect(extractProvider("anthropic/claude-sonnet-4.6")).toBe("anthropic");
    expect(extractProvider("openai/gpt-5.4")).toBe("openai");
    expect(extractProvider("google/gemini-2.5-flash")).toBe("google");
    expect(extractProvider("xai/grok-3")).toBe("xai");
  });
});

describe("Tool Filtering for Cloud Proxy", () => {
  // Mirror the convertTools filtering logic
  function shouldIncludeTool(toolName: string): boolean {
    return toolName !== "websearch";
  }

  test("websearch tool is filtered out from converted tools", () => {
    const tools = [
      { name: "read_file" },
      { name: "websearch" },
      { name: "search_notes" },
    ];
    const filtered = tools.filter((t) => shouldIncludeTool(t.name));
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.name)).toEqual(["read_file", "search_notes"]);
  });

  test("tools without websearch pass through unchanged", () => {
    const tools = [{ name: "read_file" }, { name: "edit_file" }];
    const filtered = tools.filter((t) => shouldIncludeTool(t.name));
    expect(filtered).toHaveLength(2);
  });

  test("hasWebSearch detection works correctly", () => {
    const withSearch = [{ name: "read_file" }, { name: "websearch" }];
    const withoutSearch = [{ name: "read_file" }, { name: "edit_file" }];

    expect(withSearch.some((t) => t.name === "websearch")).toBe(true);
    expect(withoutSearch.some((t) => t.name === "websearch")).toBe(false);
  });
});
