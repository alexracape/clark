import { createHash } from "node:crypto";

export function isDevLoggingEnabled(): boolean {
  return process.env.CLARK_DEV_LOGGING === "1";
}

export function hashClientId(clientId: string): string {
  return hashForLogging(clientId);
}

export function hashForLogging(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function previewForLogging(value: string, maxChars = 80): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

export function logDevEvent(event: string, payload: Record<string, unknown>): void {
  if (!isDevLoggingEnabled()) return;
  console.log(`[dev] ${event}`, payload);
}
