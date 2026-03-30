/**
 * Model Catalog endpoint — returns available models from Vercel AI Gateway.
 *
 * Fetches the full model list from the Gateway, filters to models that
 * support tool-use + vision (required by Clark), applies a provider
 * allowlist, and caches the result in Redis for 1 hour.
 *
 * No auth required — allows new users to see available models before
 * redeeming a beta code.
 */

import { getRedis } from "../lib/redis.ts";
import { errorResponse, methodNotAllowed } from "../lib/errors.ts";

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const CACHE_KEY = "models:catalog";
const CACHE_TTL_SECONDS = 3600; // 1 hour

/**
 * Provider prefixes we expose through Clark Cloud.
 * Models from other providers are filtered out.
 * Add new prefixes here to support new providers — models within
 * allowed providers appear automatically when the Gateway adds them.
 */
const ALLOWED_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "google",
  "xai",
]);

/** Shape returned by the AI Gateway /v1/models endpoint. */
interface GatewayModel {
  id: string;           // e.g. "anthropic/claude-sonnet-4.6"
  name: string;         // e.g. "Claude Sonnet 4.6"
  type: string;         // "language" | "embedding" | "image" | ...
  context_window: number;
  max_tokens: number;
  tags?: unknown;       // ["tool-use", "vision", "reasoning", ...]
  owned_by?: string;    // "anthropic"
  description?: string;
}

/** Shape returned to Clark clients. */
export interface CloudModelEntry {
  id: string;           // Gateway format: "anthropic/claude-sonnet-4.6"
  name: string;         // Human-readable: "Claude Sonnet 4.6"
  provider: string;     // "anthropic"
  contextWindow: number;
  maxTokens: number;
  tags: string[];
}

async function fetchModelsFromGateway(): Promise<CloudModelEntry[]> {
  const res = await fetch(GATEWAY_MODELS_URL, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`AI Gateway returned ${res.status}`);
  }

  const body = await res.json() as { data: GatewayModel[] };
  const models = body.data;

  return models
    .filter((m) => {
      const tags = Array.isArray(m.tags)
        ? m.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
      const provider = typeof m.owned_by === "string" && m.owned_by
        ? m.owned_by
        : m.id.split("/")[0];

      // Must be a language model
      if (m.type !== "language") return false;
      // Must support tool use and vision
      if (!tags.includes("tool-use") || !tags.includes("vision")) return false;
      // Must be from an allowed provider
      if (!ALLOWED_PROVIDERS.has(provider)) return false;
      return true;
    })
    .map((m) => ({
      tags: Array.isArray(m.tags)
        ? m.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      provider: typeof m.owned_by === "string" && m.owned_by
        ? m.owned_by
        : m.id.split("/")[0],
      id: m.id,
      name: m.name,
      contextWindow: m.context_window,
      maxTokens: m.max_tokens,
    }))
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      tags: m.tags,
    }));
}

async function getCachedModels(): Promise<CloudModelEntry[] | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const cached = await Promise.race([
      redis.get<string>(CACHE_KEY),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Redis timeout")), 1000),
      ),
    ]);
    if (!cached) return null;
    return JSON.parse(cached) as CloudModelEntry[];
  } catch {
    return null;
  }
}

async function setCachedModels(models: CloudModelEntry[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await Promise.race([
      redis.set(CACHE_KEY, JSON.stringify(models), { ex: CACHE_TTL_SECONDS }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Redis timeout")), 1000),
      ),
    ]);
  } catch {
    // Cache write failure is non-critical
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "GET") return methodNotAllowed();

    try {
      // Try cache first
      const cached = await getCachedModels();
      if (cached) {
        return new Response(JSON.stringify({ models: cached }), {
          headers: {
            "Content-Type": "application/json",
            "X-Clark-Cache": "hit",
          },
        });
      }

      // Fetch fresh from Gateway
      const models = await fetchModelsFromGateway();

      // Cache in background (don't block response)
      setCachedModels(models);

      return new Response(JSON.stringify({ models }), {
        headers: {
          "Content-Type": "application/json",
          "X-Clark-Cache": "miss",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[models] failed to fetch model catalog", { error: msg });
      return errorResponse(502, `Failed to fetch model catalog: ${msg}`);
    }
  },
};
