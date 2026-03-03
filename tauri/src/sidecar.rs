//! Bun sidecar process management.
//!
//! Spawns the compiled sidecar binary on startup, monitors its health,
//! and ensures clean shutdown when the app exits.
//!
//! All IPC commands call `base_url()` which awaits a readiness signal,
//! so requests are never sent before the sidecar is listening.

use std::sync::Arc;
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{Mutex, Notify};

/// Manages the sidecar process lifecycle.
#[derive(Clone)]
pub struct Sidecar {
    app_handle: AppHandle,
    child: Arc<Mutex<Option<CommandChild>>>,
    port: Arc<Mutex<Option<u16>>>,
    ready: Arc<Notify>,
}

impl Sidecar {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            child: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(None)),
            ready: Arc::new(Notify::new()),
        }
    }

    /// Spawn the sidecar process and wait for it to report its port.
    pub async fn spawn(&self) -> Result<u16, String> {
        let workspace_dir = Self::resolve_workspace_dir();
        log::info!("Sidecar workspace dir: {}", workspace_dir);

        let cmd = self
            .app_handle
            .shell()
            .sidecar("clark-sidecar")
            .map_err(|e| format!("Failed to create sidecar command: {}", e))?
            .env("CLARK_SIDECAR_PORT", "0")
            .env("CLARK_WORKSPACE_DIR", &workspace_dir);

        let (mut rx, child) = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        log::info!("Sidecar process spawned (pid {})", child.pid());

        // Wait for the sidecar to report its port (max 15 seconds)
        let port_notify = self.port.clone();
        let ready_notify = self.ready.clone();
        let child_store = self.child.clone();

        // Store child immediately so we can kill it on shutdown
        *child_store.lock().await = Some(child);

        let detected_port = tokio::time::timeout(std::time::Duration::from_secs(15), async {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes);
                        let line = line.trim();
                        log::info!("[sidecar] {}", line);
                        if let Some(port_str) = line.strip_prefix("CLARK_SIDECAR_PORT=") {
                            if let Ok(p) = port_str.trim().parse::<u16>() {
                                *port_notify.lock().await = Some(p);
                                ready_notify.notify_waiters();

                                // Continue forwarding stdout in the background
                                tokio::spawn(async move {
                                    while let Some(event) = rx.recv().await {
                                        match event {
                                            CommandEvent::Stdout(bytes) => {
                                                let l = String::from_utf8_lossy(&bytes);
                                                log::info!("[sidecar] {}", l.trim());
                                            }
                                            CommandEvent::Stderr(bytes) => {
                                                let l = String::from_utf8_lossy(&bytes);
                                                log::warn!("[sidecar stderr] {}", l.trim());
                                            }
                                            CommandEvent::Error(e) => {
                                                log::error!("[sidecar error] {}", e);
                                            }
                                            CommandEvent::Terminated(payload) => {
                                                log::info!(
                                                    "[sidecar] terminated (code: {:?}, signal: {:?})",
                                                    payload.code,
                                                    payload.signal
                                                );
                                            }
                                            _ => {}
                                        }
                                    }
                                });

                                return Ok(p);
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        log::warn!("[sidecar stderr] {}", line.trim());
                    }
                    CommandEvent::Error(e) => {
                        log::error!("[sidecar error] {}", e);
                        return Err(format!("Sidecar error: {}", e));
                    }
                    CommandEvent::Terminated(payload) => {
                        return Err(format!(
                            "Sidecar exited before reporting port (code: {:?}, signal: {:?})",
                            payload.code, payload.signal
                        ));
                    }
                    _ => {}
                }
            }
            Err("Sidecar event stream ended without reporting port".to_string())
        })
        .await
        .map_err(|_| "Timeout waiting for sidecar to start".to_string())??;

        log::info!("Sidecar ready on port {}", detected_port);
        Ok(detected_port)
    }

    /// Get the sidecar's HTTP base URL.
    /// Blocks until the sidecar is ready.
    pub async fn base_url(&self) -> Result<String, String> {
        // Fast path: port already known
        if let Some(port) = *self.port.lock().await {
            return Ok(format!("http://localhost:{}", port));
        }

        // Wait for readiness (with timeout so we don't hang forever)
        match tokio::time::timeout(std::time::Duration::from_secs(20), self.ready.notified()).await
        {
            Ok(_) => {}
            Err(_) => return Err("Sidecar not ready (timed out)".to_string()),
        }

        let port = self
            .port
            .lock()
            .await
            .ok_or_else(|| "Sidecar port not set after ready signal".to_string())?;
        Ok(format!("http://localhost:{}", port))
    }

    /// Shut down the sidecar process.
    #[allow(dead_code)]
    pub async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        if let Some(c) = child.take() {
            log::info!("Shutting down sidecar");
            let _ = c.kill();
        }
    }

    /// Resolve the workspace directory for the sidecar.
    ///
    /// Priority:
    /// 1. CLARK_WORKSPACE_DIR env var (set explicitly by dev workflow)
    /// 2. ~/Clark (default for production desktop app)
    fn resolve_workspace_dir() -> String {
        if let Ok(dir) = std::env::var("CLARK_WORKSPACE_DIR") {
            if !dir.trim().is_empty() {
                return dir;
            }
        }

        // Production default: ~/Clark
        if let Some(home) = dirs::home_dir() {
            return home.join("Clark").to_string_lossy().to_string();
        }

        // Last resort
        ".".to_string()
    }
}
