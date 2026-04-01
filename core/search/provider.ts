export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  lastUpdated?: string;
}

export interface SearchResponse {
  query: string;
  backend: "tavily" | "duckduckgo";
  tier: "anonymous" | "beta";
  isFallback: boolean;
  results: SearchResult[];
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, maxResults?: number): Promise<SearchResponse>;
}
