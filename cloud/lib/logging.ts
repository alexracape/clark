import { hashClientId, previewForLogging } from "./dev-logging.js";

type LogFields = Record<string, unknown>;

export interface CloudLogContext {
  endpoint: string;
  clientId?: string | null;
  request?: LogFields;
  details?: LogFields;
  error?: unknown;
}

export interface NormalizedCloudError {
  kind: "rate_limit" | "timeout" | "upstream" | "invalid_input" | "internal";
  message: string;
  name?: string;
  code?: string;
  upstreamStatus?: number;
  causeName?: string;
  causeMessage?: string;
}

function compactObject<T extends LogFields>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function maybeCompactObject(value?: LogFields): LogFields | undefined {
  if (!value) return undefined;
  const compact = compactObject(value);
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function pickNumber(value: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function pickString(value: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function describeUnknown(value: unknown): string {
  if (typeof value === "string") return value;

  const record = asRecord(value);
  if (!record) return String(value);

  try {
    return previewForLogging(JSON.stringify(record), 300);
  } catch {
    return "[unserializable object]";
  }
}

function extractStatus(value: unknown): number | undefined {
  const record = asRecord(value);
  const direct = pickNumber(record, ["statusCode", "status"]);
  if (direct !== undefined) return direct;
  return pickNumber(asRecord(record?.cause), ["statusCode", "status"]);
}

function extractCode(value: unknown): string | undefined {
  const record = asRecord(value);
  const direct = pickString(record, ["code", "type"]);
  if (direct) return direct;
  return pickString(asRecord(record?.cause), ["code", "type"]);
}

export function normalizeCloudError(error: unknown): NormalizedCloudError {
  const record = asRecord(error);
  const cause = asRecord(record?.cause);
  const name = error instanceof Error
    ? error.name
    : pickString(record, ["name"]);
  const message = error instanceof Error
    ? error.message
    : pickString(record, ["message"]) ?? describeUnknown(error);
  const upstreamStatus = extractStatus(error);
  const code = extractCode(error);
  const causeName = pickString(cause, ["name"]);
  const causeMessage = pickString(cause, ["message"]);
  const lower = message.toLowerCase();

  let kind: NormalizedCloudError["kind"] = "internal";
  if (upstreamStatus === 429 || lower.includes("rate limit")) {
    kind = "rate_limit";
  } else if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    name === "AbortError" ||
    name === "TimeoutError"
  ) {
    kind = "timeout";
  } else if (upstreamStatus !== undefined) {
    kind = "upstream";
  } else if (error instanceof SyntaxError) {
    kind = "invalid_input";
  }

  return compactObject({
    kind,
    message: previewForLogging(message, 300),
    name,
    code,
    upstreamStatus,
    causeName,
    causeMessage: causeMessage ? previewForLogging(causeMessage, 200) : undefined,
  });
}

function buildPayload(context: CloudLogContext): LogFields {
  return compactObject({
    endpoint: context.endpoint,
    clientIdHash: context.clientId ? hashClientId(context.clientId) : undefined,
    request: maybeCompactObject(context.request),
    details: maybeCompactObject(context.details),
    error: context.error === undefined ? undefined : normalizeCloudError(context.error),
  });
}

export function logCloudError(event: string, context: CloudLogContext): void {
  console.error(`[cloud] ${event}`, buildPayload(context));
}

export function logCloudWarn(event: string, context: CloudLogContext): void {
  console.warn(`[cloud] ${event}`, buildPayload(context));
}

export function logCloudInfo(event: string, context: CloudLogContext): void {
  console.info(`[cloud] ${event}`, buildPayload(context));
}
