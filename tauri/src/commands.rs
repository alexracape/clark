//! Tauri IPC command handlers.
//!
//! Each command proxies to the Bun sidecar HTTP API.
//! `base_url()` blocks until the sidecar is ready, so commands
//! called before startup will wait rather than fail.

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::sidecar::Sidecar;

async fn http_get_json(url: &str, path: &str) -> Result<serde_json::Value, String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Sidecar request failed: {}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    parse_json_response(path, status, &body)
}

async fn http_post_json(
    url: &str,
    path: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let resp = reqwest::Client::new()
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Sidecar request failed: {}", e))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    parse_json_response(path, status, &text)
}

fn parse_json_response(
    path: &str,
    status: reqwest::StatusCode,
    body: &str,
) -> Result<serde_json::Value, String> {
    if !status.is_success() {
        return Err(format!("Sidecar {} failed ({}): {}", path, status, body));
    }
    serde_json::from_str(body).map_err(|e| format!("Invalid JSON from {}: {}", path, e))
}

// --- Helpers ---

/// GET a JSON endpoint on the sidecar, returning the raw JSON value.
async fn sidecar_get(sidecar: &Sidecar, path: &str) -> Result<serde_json::Value, String> {
    let base = sidecar.base_url().await?;
    let url = format!("{}{}", base, path);
    http_get_json(&url, path).await
}

/// POST JSON to a sidecar endpoint, returning the raw JSON value.
async fn sidecar_post(
    sidecar: &Sidecar,
    path: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let base = sidecar.base_url().await?;
    let url = format!("{}{}", base, path);
    http_post_json(&url, path, body).await
}

// --- Response types ---

#[derive(Serialize, Deserialize, Debug)]
pub struct CommandResponse {
    pub result: Option<serde_json::Value>,
    #[serde(rename = "uiAction")]
    pub ui_action: Option<String>,
    pub exit: Option<bool>,
}

// --- Commands ---

#[tauri::command]
pub async fn send_message(
    text: String,
    sidecar: State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    sidecar_post(&sidecar, "/api/chat", serde_json::json!({ "text": text })).await
}

#[tauri::command]
pub async fn slash_command(
    command: String,
    args: String,
    sidecar: State<'_, Sidecar>,
) -> Result<CommandResponse, String> {
    let val = sidecar_post(
        &sidecar,
        "/api/command",
        serde_json::json!({ "command": command, "args": args }),
    )
    .await?;
    serde_json::from_value(val).map_err(|e| format!("Invalid command response: {}", e))
}

#[tauri::command]
pub async fn ingest_file(
    path: String,
    sidecar: State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    sidecar_post(
        &sidecar,
        "/api/ingest",
        serde_json::json!({ "path": path }),
    )
    .await
}

#[tauri::command]
pub async fn get_status(sidecar: State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    sidecar_get(&sidecar, "/api/status").await
}

#[tauri::command]
pub async fn list_files(sidecar: State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    sidecar_get(&sidecar, "/api/files").await
}

#[tauri::command]
pub async fn list_files_at(
    path: String,
    sidecar: State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    let encoded: String = url::form_urlencoded::byte_serialize(path.as_bytes()).collect();
    let endpoint = format!("/api/files?path={}", encoded);
    sidecar_get(&sidecar, &endpoint).await
}

#[tauri::command]
pub async fn switch_provider(
    provider: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    sidecar: State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    sidecar_post(
        &sidecar,
        "/api/provider",
        serde_json::json!({ "provider": provider, "model": model, "apiKey": api_key }),
    )
    .await
}

#[tauri::command]
pub async fn list_models(sidecar: State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    sidecar_get(&sidecar, "/api/models").await
}

#[tauri::command]
pub async fn list_canvases(sidecar: State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    sidecar_get(&sidecar, "/api/canvases").await
}

#[tauri::command]
pub async fn open_canvas(
    name: String,
    sidecar: State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    sidecar_post(
        &sidecar,
        "/api/canvas/open",
        serde_json::json!({ "name": name }),
    )
    .await
}

#[tauri::command]
pub async fn get_context(sidecar: State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    sidecar_get(&sidecar, "/api/context").await
}

#[tauri::command]
pub async fn get_history(sidecar: State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    sidecar_get(&sidecar, "/api/history").await
}

#[tauri::command]
pub async fn pick_file(window: tauri::Window) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();

    window.dialog().file().pick_file(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });

    rx.await
        .map_err(|_| "File picker cancelled".to_string())
}

#[tauri::command]
pub async fn pick_folder(window: tauri::Window) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();

    window.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });

    rx.await
        .map_err(|_| "Folder picker cancelled".to_string())
}

#[tauri::command]
pub async fn get_onboarding_status(
    sidecar: State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    sidecar_get(&sidecar, "/api/onboarding-status").await
}

#[tauri::command]
pub async fn complete_onboarding(
    provider: String,
    api_key: Option<String>,
    workspace_dir: Option<String>,
    model: Option<String>,
    workspace_is_new: Option<bool>,
    sidecar: State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    sidecar_post(
        &sidecar,
        "/api/complete-onboarding",
        serde_json::json!({
            "provider": provider,
            "apiKey": api_key,
            "workspaceDir": workspace_dir,
            "model": model,
            "workspaceIsNew": workspace_is_new,
        }),
    )
    .await
}

#[tauri::command]
pub async fn list_ollama_models(
    sidecar: State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    sidecar_get(&sidecar, "/api/ollama-models").await
}

#[tauri::command]
pub async fn write_clipboard_text(
    text: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Failed to write clipboard text: {}", e))
}

#[cfg(test)]
mod tests {
    use super::parse_json_response;

    #[test]
    fn get_passes_through_valid_json() {
        let out = parse_json_response(
            "/api/status",
            reqwest::StatusCode::OK,
            r#"{"ok":true}"#,
        )
        .unwrap();
        assert_eq!(out["ok"], true);
    }

    #[test]
    fn get_surfaces_non_2xx_status_and_body() {
        let err = parse_json_response(
            "/api/status",
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"boom"}"#,
        )
        .unwrap_err();
        assert!(err.contains("/api/status"));
        assert!(err.contains("500"));
        assert!(err.contains("boom"));
    }

    #[test]
    fn post_reports_invalid_json() {
        let err = parse_json_response("/api/chat", reqwest::StatusCode::OK, "not json").unwrap_err();
        assert!(err.contains("Invalid JSON"));
        assert!(err.contains("/api/chat"));
    }
}
