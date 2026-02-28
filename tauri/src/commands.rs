//! Tauri IPC command handlers.
//!
//! Each command proxies to the Bun sidecar HTTP API.
//! `base_url()` blocks until the sidecar is ready, so commands
//! called before startup will wait rather than fail.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::sidecar::Sidecar;

// --- Helpers ---

/// GET a JSON endpoint on the sidecar, returning the raw JSON value.
async fn sidecar_get(sidecar: &Sidecar, path: &str) -> Result<serde_json::Value, String> {
    let base = sidecar.base_url().await?;
    let url = format!("{}{}", base, path);
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Sidecar request failed: {}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() {
        return Err(format!("Sidecar {} failed ({}): {}", path, status, body));
    }
    serde_json::from_str(&body).map_err(|e| format!("Invalid JSON from {}: {}", path, e))
}

/// POST JSON to a sidecar endpoint, returning the raw JSON value.
async fn sidecar_post(
    sidecar: &Sidecar,
    path: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let base = sidecar.base_url().await?;
    let url = format!("{}{}", base, path);
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Sidecar request failed: {}", e))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    if !status.is_success() {
        return Err(format!("Sidecar {} failed ({}): {}", path, status, text));
    }
    serde_json::from_str(&text).map_err(|e| format!("Invalid JSON from {}: {}", path, e))
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
