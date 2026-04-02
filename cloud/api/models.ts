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

import { getRedis } from "../lib/redis.js";
import { errorResponse, methodNotAllowed } from "../lib/errors.js";
import { logCloudError } from "../lib/logging.js";

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

function getTags(model: GatewayModel): string[] {
  return Array.isArray(model.tags)
    ? model.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function getProvider(model: GatewayModel): string | null {
  if (typeof model.owned_by === "string" && model.owned_by.trim()) {
    return model.owned_by.trim();
  }

  const provider = model.id.split("/")[0];
  return provider ? provider : null;
}

function toCloudModelEntry(model: GatewayModel): CloudModelEntry | null {
  const tags = getTags(model);
  const provider = getProvider(model);

  if (model.type !== "language") return null;
  if (!provider) return null;
  if (!tags.includes("tool-use") || !tags.includes("vision")) return null;
  if (!ALLOWED_PROVIDERS.has(provider)) return null;

  return {
    id: model.id,
    name: model.name,
    provider,
    contextWindow: model.context_window,
    maxTokens: model.max_tokens,
    tags,
  };
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

  return models.reduce<CloudModelEntry[]>((entries, model) => {
    const entry = toCloudModelEntry(model);
    if (entry) entries.push(entry);
    return entries;
  }, []);
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
      logCloudError("models_fetch_failed", {
        endpoint: "/api/models",
        error: err,
      });
      return errorResponse(502, `Failed to fetch model catalog: ${msg}`);
    }
  },
};
