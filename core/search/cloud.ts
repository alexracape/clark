import type { SearchResponse, WebSearchProvider } from "./provider.ts";

function isSearchResultArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => {
    return item
      && typeof item === "object"
      && typeof (item as Record<string, unknown>).title === "string"
      && typeof (item as Record<string, unknown>).url === "string"
      && typeof (item as Record<string, unknown>).snippet === "string";
  });
}

function isSearchResponse(value: unknown): value is SearchResponse {
  const record = value as Record<string, unknown>;
  return !!value
    && typeof value === "object"
    && typeof record.query === "string"
    && (record.backend === "tavily" || record.backend === "duckduckgo")
    && (record.tier === "anonymous" || record.tier === "beta")
    && typeof record.isFallback === "boolean"
    && isSearchResultArray(record.results);
}

export class CloudSearchProvider implements WebSearchProvider {
  readonly name = "clark-cloud-search";

  constructor(
    private cloudUrl: string,
    private clientId: string,
  ) {}

  async search(query: string, maxResults = 5): Promise<SearchResponse> {
    const res = await fetch(`${this.cloudUrl}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Clark-Client-Id": this.clientId,
      },
      body: JSON.stringify({ query, maxResults }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloud search error (${res.status}): ${text}`);
    }

    const result = await res.json() as unknown;
    if (!isSearchResponse(result)) {
      throw new Error("Cloud search error: invalid response shape from /api/search");
    }

    return result;
  }
}
