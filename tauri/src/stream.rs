//! WebSocket stream forwarder.
//!
//! Connects to the Bun sidecar's /api/stream WebSocket and re-emits
//! events as Tauri events so the React frontend can subscribe via `listen()`.

use futures_util::StreamExt;
use tauri::Emitter;
use tokio_tungstenite::connect_async;

const RECONNECT_DELAY_SECS: u64 = 2;

pub(crate) fn event_name_for_payload(text: &str) -> Option<String> {
    let event = serde_json::from_str::<serde_json::Value>(text).ok()?;
    let event_type = event
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");
    Some(format!("sidecar:{}", event_type))
}

/// Connect to the sidecar WebSocket and forward events to the Tauri frontend.
pub async fn start_stream_forwarder(app_handle: tauri::AppHandle, sidecar_port: u16) {
    let ws_url = format!("ws://localhost:{}/api/stream", sidecar_port);

    loop {
        log::info!("Connecting to sidecar stream at {}", ws_url);

        match connect_async(&ws_url).await {
            Ok((ws_stream, _)) => {
                log::info!("Connected to sidecar stream");
                let (_, mut read) = ws_stream.split();

                while let Some(msg) = read.next().await {
                    match msg {
                        Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                            if let Some(event_name) = event_name_for_payload(&text) {
                                if let Err(e) = app_handle.emit(&event_name, text.to_string()) {
                                    log::error!("Failed to emit event {}: {}", event_name, e);
                                }

                                // Also emit a catch-all event
                                if let Err(e) = app_handle.emit("sidecar:event", text.to_string()) {
                                    log::error!("Failed to emit catch-all event: {}", e);
                                }
                            }
                        }
                        Ok(_) => {} // Ignore non-text messages
                        Err(e) => {
                            log::error!("WebSocket error: {}", e);
                            break;
                        }
                    }
                }

                log::warn!("Sidecar stream disconnected, reconnecting in 2s...");
            }
            Err(e) => {
                log::error!("Failed to connect to sidecar stream: {}", e);
            }
        }

        // Wait before reconnecting
        tokio::time::sleep(std::time::Duration::from_secs(RECONNECT_DELAY_SECS)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::event_name_for_payload;

    #[test]
    fn maps_valid_event_type_to_prefixed_name() {
        let payload = r#"{"type":"streaming_text","text":"hello"}"#;
        let event = event_name_for_payload(payload);
        assert_eq!(event.as_deref(), Some("sidecar:streaming_text"));
    }

    #[test]
    fn uses_unknown_when_type_is_missing() {
        let payload = r#"{"text":"hello"}"#;
        let event = event_name_for_payload(payload);
        assert_eq!(event.as_deref(), Some("sidecar:unknown"));
    }

    #[test]
    fn ignores_malformed_json() {
        let payload = r#"{"type": "streaming_text""#;
        let event = event_name_for_payload(payload);
        assert!(event.is_none());
    }

    #[test]
    fn reconnect_delay_is_stable_for_contract_tests() {
        assert_eq!(super::RECONNECT_DELAY_SECS, 2);
    }
}
