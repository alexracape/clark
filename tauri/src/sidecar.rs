//! Bun sidecar process management.
//!
//! Spawns the Bun sidecar on startup, monitors its health,
//! and ensures clean shutdown when the app exits.
//!
//! All IPC commands call `base_url()` which awaits a readiness signal,
//! so requests are never sent before the sidecar is listening.

use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, Notify};

/// Manages the Bun sidecar process lifecycle.
#[derive(Clone)]
pub struct Sidecar {
    child: Arc<Mutex<Option<Child>>>,
    port: Arc<Mutex<Option<u16>>>,
    ready: Arc<Notify>,
}

impl Sidecar {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(None)),
            ready: Arc::new(Notify::new()),
        }
    }

    /// Spawn the Bun sidecar process and wait for it to report its port.
    pub async fn spawn(&self) -> Result<u16, String> {
        let sidecar_path = Self::resolve_sidecar_path()?;

        log::info!("Starting Bun sidecar: {}", sidecar_path);

        let mut child = Command::new("bun")
            .arg("run")
            .arg(&sidecar_path)
            .env("CLARK_SIDECAR_PORT", "0")
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn Bun sidecar: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture sidecar stdout")?;

        let mut reader = BufReader::new(stdout).lines();

        // Wait for the sidecar to report its port (max 15 seconds)
        let detected_port = tokio::time::timeout(std::time::Duration::from_secs(15), async {
            while let Ok(Some(line)) = reader.next_line().await {
                log::info!("[sidecar] {}", line);
                if let Some(port_str) = line.strip_prefix("CLARK_SIDECAR_PORT=") {
                    if let Ok(p) = port_str.trim().parse::<u16>() {
                        return Ok(p);
                    }
                }
            }
            Err("Sidecar exited without reporting port".to_string())
        })
        .await
        .map_err(|_| "Timeout waiting for sidecar to start".to_string())??;

        // Store port and signal readiness
        *self.port.lock().await = Some(detected_port);
        *self.child.lock().await = Some(child);
        self.ready.notify_waiters();

        // Forward remaining stdout in background
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                log::info!("[sidecar] {}", line);
            }
        });

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
    pub async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        if let Some(ref mut c) = *child {
            log::info!("Shutting down sidecar");
            let _ = c.kill().await;
            *child = None;
        }
    }

    /// Resolve the path to the sidecar TypeScript file.
    fn resolve_sidecar_path() -> Result<String, String> {
        let candidates: Vec<std::path::PathBuf> = std::env::current_dir()
            .into_iter()
            .flat_map(|cwd| {
                // cwd may be the project root or the tauri/ subdirectory
                vec![cwd.join("gui/sidecar.ts"), cwd.join("../gui/sidecar.ts")]
            })
            .chain(std::env::current_exe().into_iter().flat_map(|exe| {
                let dir = exe.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
                vec![
                    dir.join("../gui/sidecar.ts"),
                    dir.join("gui/sidecar.ts"),
                ]
            }))
            .collect();

        for path in &candidates {
            if path.exists() {
                // Canonicalize to avoid ../ in the path
                let resolved = path.canonicalize().unwrap_or_else(|_| path.clone());
                return Ok(resolved.to_string_lossy().to_string());
            }
        }

        Err(format!(
            "Cannot find gui/sidecar.ts (searched: {:?})",
            candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()
        ))
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        let child = self.child.clone();
        tokio::spawn(async move {
            let mut guard = child.lock().await;
            if let Some(ref mut c) = *guard {
                let _ = c.kill().await;
            }
        });
    }
}
