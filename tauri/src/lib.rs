mod commands;
mod sidecar;
mod stream;

use tauri::Manager;
use sidecar::Sidecar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Sidecar::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Spawn sidecar and start stream forwarder
            let app_handle = app.handle().clone();
            let sidecar = app.state::<Sidecar>().inner().clone();

            tauri::async_runtime::spawn(async move {
                match sidecar.spawn().await {
                    Ok(port) => {
                        log::info!("Sidecar ready on port {}", port);
                        // Start forwarding stream events to the frontend
                        stream::start_stream_forwarder(app_handle, port).await;
                    }
                    Err(e) => {
                        log::error!("Failed to start sidecar: {}", e);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::send_message,
            commands::slash_command,
            commands::ingest_file,
            commands::get_status,
            commands::list_files,
            commands::list_files_at,
            commands::switch_provider,
            commands::pick_file,
            commands::list_models,
            commands::list_canvases,
            commands::open_canvas,
            commands::get_context,
            commands::get_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
