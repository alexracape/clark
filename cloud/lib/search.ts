import { hashForLogging, logDevEvent } from "./dev-logging.ts";

export type SearchBackend = "tavily" | "duckduckgo";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  lastUpdated?: string;
}

export interface SearchResponse {
  query: string;
  backend: SearchBackend;
  tier: "anonymous" | "beta";
  isFallback: boolean;
  results: SearchResult[];
}

interface CacheEntry {
  results: SearchResult[];
  timestamp: number;
}

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DDG_SEARCH_ENDPOINTS = [
  "https://html.duckduckgo.com/html/?q=",
  "https://lite.duckduckgo.com/lite/?q=",
];
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESULTS = 20;
const DDG_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DDG_RATE_LIMIT_MAX_REQUESTS = 10;

const searchCache = new Map<string, CacheEntry>();
const ddgRateLimitQueue: number[] = [];

function cacheKey(backend: SearchBackend, query: string, maxResults: number): string {
  return `${backend}:${query}:${maxResults}`;
}

function getCachedResults(
  backend: SearchBackend,
  query: string,
  maxResults: number,
): SearchResult[] | null {
  const entry = searchCache.get(cacheKey(backend, query, maxResults));
  if (!entry) return null;
  if (Date.now() - entry.timestamp >= SEARCH_CACHE_TTL_MS) {
    searchCache.delete(cacheKey(backend, query, maxResults));
    return null;
  }
  return entry.results;
}

function setCachedResults(
  backend: SearchBackend,
  query: string,
  maxResults: number,
  results: SearchResult[],
): void {
  searchCache.set(cacheKey(backend, query, maxResults), {
    results,
    timestamp: Date.now(),
  });
}

export function normalizeMaxResults(value: unknown, fallback = 5): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(value)));
}

export async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<SearchResult[]> {
  const cached = getCachedResults("tavily", query, maxResults);
  if (cached) return cached;

  const startedAt = Date.now();
  const queryHash = hashForLogging(query);

  try {
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        topic: "general",
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        auto_parameters: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const raw = await res.text();
    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    if (!res.ok) {
      const message =
        extractTavilyError(body)
        ?? (raw.trim() ? raw : null)
        ?? `Tavily returned ${res.status}`;
      logDevEvent("search_tavily_error", {
        queryHash,
        status: res.status,
        latencyMs: Date.now() - startedAt,
        error: message,
      });
      throw new Error(`Tavily search failed (${res.status}): ${message}`);
    }

    const results = normalizeTavilyResults(body);
    setCachedResults("tavily", query, maxResults, results);
    logDevEvent("search_tavily_success", {
      queryHash,
      latencyMs: Date.now() - startedAt,
      resultCount: results.length,
    });
    return results;
  } catch (err) {
    logDevEvent("search_tavily_exception", {
      queryHash,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function extractTavilyError(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") {
    return body.error.message;
  }
  if (typeof body.detail === "string") return body.detail;
  if (body.detail && typeof body.detail === "object" && typeof body.detail.error === "string") {
    return body.detail.error;
  }
  if (Array.isArray(body.detail)) {
    const firstMessage = body.detail.find((item) =>
      item
      && typeof item === "object"
      && typeof (item as Record<string, unknown>).msg === "string"
    ) as { msg: string } | undefined;
    if (firstMessage) return firstMessage.msg;
  }
  return null;
}

function normalizeTavilyResults(body: any): SearchResult[] {
  if (!body || typeof body !== "object" || !Array.isArray(body.results)) {
    return [];
  }

  return body.results.reduce<SearchResult[]>((acc, result) => {
    if (!result || typeof result !== "object") return acc;
    if (typeof result.title !== "string" || typeof result.url !== "string") return acc;
    const date = typeof result.published_date === "string"
      ? result.published_date
      : typeof result.date === "string"
        ? result.date
        : undefined;
    const lastUpdated = typeof result.lastUpdated === "string"
      ? result.lastUpdated
      : typeof result.last_updated === "string"
        ? result.last_updated
        : undefined;
    acc.push({
      title: result.title,
      url: result.url,
      snippet: typeof result.content === "string"
        ? result.content
        : typeof result.snippet === "string"
          ? result.snippet
          : "",
      ...(date ? { date } : {}),
      ...(lastUpdated ? { lastUpdated } : {}),
    });
    return acc;
  }, []);
}

async function checkDuckDuckGoRateLimit(): Promise<void> {
  const now = Date.now();

  while (
    ddgRateLimitQueue.length > 0 &&
    ddgRateLimitQueue[0]! < now - DDG_RATE_LIMIT_WINDOW_MS
  ) {
    ddgRateLimitQueue.shift();
  }

  if (ddgRateLimitQueue.length >= DDG_RATE_LIMIT_MAX_REQUESTS) {
    const waitTime = ddgRateLimitQueue[0]! + DDG_RATE_LIMIT_WINDOW_MS - now;
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    ddgRateLimitQueue.shift();
  }

  ddgRateLimitQueue.push(now);
}

export async function searchDuckDuckGo(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const cached = getCachedResults("duckduckgo", query, maxResults);
  if (cached) return cached;

  await checkDuckDuckGoRateLimit();

  const queryHash = hashForLogging(query);
  const errors: string[] = [];
  const startedAt = Date.now();

  for (const endpoint of DDG_SEARCH_ENDPOINTS) {
    const searchUrl = `${endpoint}${encodeURIComponent(query)}`;

    try {
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const error = `${searchUrl} returned status ${response.status}`;
        errors.push(error);
        logDevEvent("search_ddg_http_error", {
          queryHash,
          endpoint: searchUrl,
          status: response.status,
          latencyMs: Date.now() - startedAt,
        });
        continue;
      }

      const html = await response.text();
      if (html.includes("anomaly-modal") || html.includes("challenge-form")) {
        const error = `${searchUrl} returned CAPTCHA challenge`;
        errors.push(error);
        logDevEvent("search_ddg_captcha", {
          queryHash,
          endpoint: searchUrl,
          latencyMs: Date.now() - startedAt,
        });
        continue;
      }

      const results = parseDuckDuckGoResults(html, maxResults);
      if (results.length > 0) {
        setCachedResults("duckduckgo", query, maxResults, results);
      }
      logDevEvent("search_ddg_success", {
        queryHash,
        endpoint: searchUrl,
        latencyMs: Date.now() - startedAt,
        resultCount: results.length,
      });
      return results;
    } catch (err) {
      const error = `${searchUrl} failed: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(error);
      logDevEvent("search_ddg_exception", {
        queryHash,
        endpoint: searchUrl,
        latencyMs: Date.now() - startedAt,
        error,
      });
    }
  }

  throw new Error(`Web search failed: ${errors.join(" | ")}`);
}

/**
 * Parse DuckDuckGo HTML results.
 * Simple regex-based extraction keeps the helper dependency-free.
 */
function parseDuckDuckGoResults(
  html: string,
  maxResults: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const resultBlocks = [
    ...html.matchAll(
      /<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ),
    ...html.matchAll(/<tr[\s\S]*?<\/tr>/gi),
  ]
    .map((match) => match[0])
    .filter((block) => /result__a|result-link/i.test(block));

  for (const resultHtml of resultBlocks) {
    if (results.length >= maxResults) break;

    const titleMatch = resultHtml.match(
      /<a[^>]*class="[^"]*(?:result__a|result-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleMatch) continue;

    const url = normalizeDuckDuckGoUrl(titleMatch[1] || "");
    const title = stripHtmlTags(titleMatch[2] || "").trim();
    const snippetMatch = resultHtml.match(
      /<(?:a|div|span|td)[^>]*class="[^"]*(?:result__snippet|result-snippet|snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/i,
    );
    const snippet = stripHtmlTags(snippetMatch?.[1] || "").trim();

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function normalizeDuckDuckGoUrl(rawHref: string): string {
  const decodedHtmlHref = stripHtmlTags(rawHref).replace(/&amp;/g, "&").trim();
  if (!decodedHtmlHref) return "";

  const href = decodedHtmlHref.startsWith("//")
    ? `https:${decodedHtmlHref}`
    : decodedHtmlHref;

  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const isDuckDuckGoRedirect =
      (parsed.hostname === "duckduckgo.com" ||
        parsed.hostname === "www.duckduckgo.com") &&
      parsed.pathname.startsWith("/l/");
    if (isDuckDuckGoRedirect) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return safeDecodeURIComponent(uddg);
    }
    return safeDecodeURIComponent(parsed.toString());
  } catch {
    return safeDecodeURIComponent(href);
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}
