mod commands;
mod sidecar;
mod stream;

use tauri::Manager;
use sidecar::Sidecar;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

async fn check_and_install_updates(app: tauri::AppHandle) {
    let update = match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(update) => update,
            Err(err) => {
                log::error!("Failed to check for updates: {}", err);
                return;
            }
        },
        Err(err) => {
            log::error!("Failed to create updater: {}", err);
            return;
        }
    };

    let Some(update) = update else {
        log::info!("No update available");
        return;
    };

    log::info!(
        "Update available: current={} latest={}",
        update.current_version,
        update.version
    );

    if let Err(err) = update
        .download_and_install(
            |chunk_length, content_length| {
                log::info!(
                    "Downloading update chunk: {:?} / {:?}",
                    chunk_length,
                    content_length
                );
            },
            || {
                log::info!("Update download finished");
            },
        )
        .await
    {
        log::error!("Failed to download/install update: {}", err);
        return;
    }

    let app_for_restart = app.clone();
    app.dialog()
        .message("An update has been installed. Restart now to use the latest version.")
        .title("Update Installed")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Restart now".to_string(),
            "Later".to_string(),
        ))
        .show(move |restart_now| {
            if restart_now {
                app_for_restart.restart();
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(Sidecar::new(app.handle().clone()));
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

            if !cfg!(debug_assertions) {
                let updater_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    check_and_install_updates(updater_app).await;
                });
            }

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
            commands::write_clipboard_text,
            commands::pick_folder,
            commands::get_onboarding_status,
            commands::complete_onboarding,
            commands::list_ollama_models,
            commands::get_settings,
            commands::update_settings,
            commands::read_file_content,
            commands::write_file_content,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
