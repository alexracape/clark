//! WebSocket stream forwarder.
//!
//! Connects to the Bun sidecar's /api/stream WebSocket and re-emits
//! events as Tauri events so the React frontend can subscribe via `listen()`.

use futures_util::StreamExt;
use tauri::Emitter;
use tokio_tungstenite::connect_async;

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
                            // Parse the event type for the Tauri event name
                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&text) {
                                let event_type = event
                                    .get("type")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("unknown");

                                let event_name = format!("sidecar:{}", event_type);

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
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}
