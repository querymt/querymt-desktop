pub mod app_reset;
pub mod commands;
pub mod deep_links;
pub mod keychain;
mod session_load_telemetry;
pub mod sidecar;
mod telemetry;
pub mod updates;
mod websocket;

use session_load_telemetry::SessionLoadTelemetry;
use sidecar::AcpAgentManager;
use tauri::Manager;
use websocket::AcpWebSocketManager;

#[cfg(all(feature = "cef", target_os = "linux"))]
pub type BrowserEngine = tauri_runtime_cef::CefRuntime<tauri::EventLoopMessage>;

#[cfg(not(all(feature = "cef", target_os = "linux")))]
pub type BrowserEngine = tauri::Wry;

/// Application entry point: sets up telemetry, plugins and managed state, then runs the Tauri app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tonic's lazy OTLP channel starts background tasks while it is constructed.
    tauri::async_runtime::block_on(async { telemetry::setup() });
    let session_load_telemetry = SessionLoadTelemetry::default();
    let heartbeat_telemetry = session_load_telemetry.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            interval.tick().await;
            heartbeat_telemetry.report_still_running().await;
        }
    });

    let context = tauri::generate_context!();
    // Apply a scheduled desktop data reset before any webview opens its storage.
    let identifier = context.config().identifier.clone();
    if let Some(dirs) = app_reset::AppDirs::resolve(&identifier) {
        match app_reset::apply_pending(&dirs, &identifier) {
            Ok(true) => eprintln!("Desktop app data was reset."),
            Ok(false) => {}
            Err(error) => eprintln!("Desktop app data reset failed: {error}"),
        }
    }
    #[cfg(all(feature = "cef", target_os = "linux"))]
    let context = {
        let mut context = context;
        if let Some(window) = context
            .config_mut()
            .app
            .windows
            .iter_mut()
            .find(|window| window.label == "main")
        {
            window.visible = false;
            window.transparent = false;
        }
        context
    };

    tauri::Builder::<BrowserEngine>::new()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AcpAgentManager::default())
        .manage(AcpWebSocketManager::default())
        .manage(session_load_telemetry)
        // The plugin is registered for its updater machinery only. No `updater:*`
        // permission is granted in capabilities/, so the webview cannot call it
        // directly; it goes through the `updates_*` commands, which apply the
        // channel and gating rules.
        .plugin(
            tauri_plugin_updater::Builder::new()
                // Never let the plugin's own comparator allow a downgrade.
                .default_version_comparator(|current, release| release.version > current)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::app_ping,
            commands::app_runtime,
            commands::querymt_profile_templates,
            commands::querymt_profiles_list,
            commands::querymt_profile_enable_template,
            commands::querymt_agent_status,
            commands::querymt_agent_start,
            commands::querymt_agent_stop,
            commands::querymt_agent_restart,
            commands::querymt_agent_logs,
            commands::querymt_agent_attach_stdout,
            commands::querymt_agent_detach_stdout,
            commands::querymt_agent_drain_session_updates,
            commands::querymt_agent_write_acp_line,
            commands::querymt_websocket_connect,
            commands::querymt_websocket_send,
            commands::querymt_websocket_close,
            commands::querymt_session_load_start,
            commands::querymt_session_load_checkpoint,
            commands::querymt_session_load_heartbeat,
            commands::querymt_session_load_finish,
            commands::querymt_workspace_suggest_paths,
            commands::querymt_workspace_validate_directory,
            commands::querymt_app_reset_data,
            updates::updates_status,
            updates::updates_set_preferences,
            updates::updates_check,
            updates::updates_install,
            updates::updates_restart
        ])
        .setup(|_app| {
            _app.manage(updates::manager_for(_app.handle()));
            updates::spawn_scheduler(_app.handle().clone());
            #[cfg(all(feature = "cef", target_os = "linux"))]
            {
                let handle = _app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let Some(window) = handle.get_webview_window("main") else {
                        return;
                    };
                    if window.is_visible().unwrap_or(false) {
                        return;
                    }

                    eprintln!(
                        "Frontend did not show the main window within 5 seconds; force-showing it."
                    );
                    let _ = window.show();
                    let _ = window.set_focus();
                });
            }
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                let manager = app.state::<AcpAgentManager>();
                manager.shutdown_all();
                app.state::<AcpWebSocketManager>().close_all();
                app.state::<SessionLoadTelemetry>()
                    .close_all("application_shutdown");
                tauri::async_runtime::block_on(async { telemetry::flush() });
            }
        });
}
