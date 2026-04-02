import { authenticate } from "../lib/auth.js";
import { hashClientId, hashForLogging, logDevEvent } from "../lib/dev-logging.js";
import { errorResponse, methodNotAllowed } from "../lib/errors.js";
import { logCloudError } from "../lib/logging.js";
import { createRateLimiter, checkRateLimit } from "../lib/rate-limit.js";
import {
  normalizeMaxResults,
  type SearchBackend,
  type SearchResponse,
  searchDuckDuckGo,
  searchTavily,
} from "../lib/search.js";

const SEARCH_RATE_LIMIT = { limit: 10, window: "60 s" } as const;

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const searchLimiter = createRateLimiter(SEARCH_RATE_LIMIT.limit, SEARCH_RATE_LIMIT.window);
    const rateLimited = await checkRateLimit(searchLimiter, auth.clientId);
    if (rateLimited) return rateLimited;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return errorResponse(400, "Missing required field: query");
    }

    const maxResults = normalizeMaxResults(body.maxResults, 5);
    const startedAt = Date.now();
    const queryHash = hashForLogging(query);

    try {
      let backend: SearchBackend;
      let isFallback: boolean;
      let results: SearchResponse["results"];

      if (auth.tier === "beta") {
        const tavilyKey = process.env.TAVILY_API_KEY;
        if (!tavilyKey) {
          logCloudError("search_missing_tavily_key", {
            endpoint: "/api/search",
            clientId: auth.clientId,
            request: {
              tier: auth.tier,
              queryHash,
              maxResults,
            },
            error: new Error("Server misconfigured: missing TAVILY_API_KEY"),
          });
          return errorResponse(500, "Server misconfigured: missing TAVILY_API_KEY");
        }
        backend = "tavily";
        isFallback = false;
        results = await searchTavily(query, maxResults, tavilyKey);
      } else {
        backend = "duckduckgo";
        isFallback = true;
        results = await searchDuckDuckGo(query, maxResults);
      }

      const responseBody: SearchResponse = {
        query,
        backend,
        tier: auth.tier,
        isFallback,
        results,
      };

      logDevEvent("search_request_complete", {
        clientIdHash: hashClientId(auth.clientId),
        tier: auth.tier,
        backend,
        isFallback,
        fallbackReason: isFallback ? "anonymous_tier" : null,
        queryHash,
        maxResults,
        latencyMs: Date.now() - startedAt,
        resultCount: results.length,
      });

      return new Response(
        JSON.stringify(responseBody),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logDevEvent("search_request_failed", {
        clientIdHash: hashClientId(auth.clientId),
        tier: auth.tier,
        queryHash,
        fallbackReason: auth.tier === "anonymous" ? "anonymous_tier" : null,
        latencyMs: Date.now() - startedAt,
        error: message,
      });
      logCloudError("search_failed", {
        endpoint: "/api/search",
        clientId: auth.clientId,
        request: {
          tier: auth.tier,
          queryHash,
          maxResults,
        },
        details: {
          fallbackReason: auth.tier === "anonymous" ? "anonymous_tier" : undefined,
        },
        error: err,
      });
      const status = auth.tier === "beta" ? 502 : 500;
      return errorResponse(status, message);
    }
  },
};
