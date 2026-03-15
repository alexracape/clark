import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

const SIDECAR_URL = "http://localhost:3456";

type InvokeArgs = Record<string, unknown>;
type Route = { method: "GET" | "POST"; path: string };

const ROUTE_MAP: Record<string, Route> = {
  send_message: { method: "POST", path: "/api/chat" },
  slash_command: { method: "POST", path: "/api/command" },
  ingest_file: { method: "POST", path: "/api/ingest" },
  get_status: { method: "GET", path: "/api/status" },
  list_files: { method: "GET", path: "/api/files" },
  list_files_at: { method: "GET", path: "/api/files" },
  switch_provider: { method: "POST", path: "/api/provider" },
  list_models: { method: "GET", path: "/api/models" },
  list_canvases: { method: "GET", path: "/api/canvases" },
  open_canvas: { method: "POST", path: "/api/canvas/open" },
  get_context: { method: "GET", path: "/api/context" },
  get_history: { method: "GET", path: "/api/history" },
  get_onboarding_status: { method: "GET", path: "/api/onboarding-status" },
  complete_onboarding: { method: "POST", path: "/api/complete-onboarding" },
  list_ollama_models: { method: "GET", path: "/api/ollama-models" },
  get_settings: { method: "GET", path: "/api/settings" },
  update_settings: { method: "POST", path: "/api/settings" },
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function invokeCommand(cmd: string, args: InvokeArgs = {}): Promise<unknown> {
  if (isTauriRuntime()) {
    return tauriInvoke(cmd, args);
  }

  // Non-Tauri fallback: direct HTTP to sidecar
  const route = ROUTE_MAP[cmd];
  if (!route) throw new Error(`Unknown command: ${cmd}`);

  // For GET requests with args, append as query parameters
  let url = `${SIDECAR_URL}${route.path}`;
  if (route.method === "GET" && Object.keys(args).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) {
      if (v != null) params.set(k, String(v));
    }
    url += `?${params.toString()}`;
  }

  const resp = await fetch(url, {
    method: route.method,
    headers: route.method === "POST" ? { "Content-Type": "application/json" } : {},
    body: route.method === "POST" ? JSON.stringify(args) : undefined,
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Sidecar ${route.path} failed (${resp.status}): ${body}`);
  }

  return resp.json();
}

export async function listenEvent(
  event: string,
  handler: (e: { payload: string }) => void,
): Promise<() => void> {
  if (isTauriRuntime()) {
    const unlisten = await tauriListen<string>(event, (e) => {
      handler({ payload: e.payload });
    });
    return () => unlisten();
  }

  // Non-Tauri fallback: direct WebSocket to sidecar
  const ws = new WebSocket(`ws://localhost:3456/api/stream`);
  ws.onmessage = (e) => {
    handler({ payload: e.data });
  };
  return () => ws.close();
}
