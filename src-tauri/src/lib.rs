pub mod commands;
pub mod deep_links;
pub mod keychain;
mod session_load_telemetry;
pub mod sidecar;
mod telemetry;

use session_load_telemetry::SessionLoadTelemetry;
use sidecar::AcpAgentManager;
use tauri::Manager;

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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AcpAgentManager::default())
        .manage(session_load_telemetry)
        .invoke_handler(tauri::generate_handler![
            commands::app_ping,
            commands::querymt_profile_templates,
            commands::querymt_profiles_list,
            commands::querymt_profile_enable_template,
            commands::querymt_agent_status,
            commands::querymt_agent_start,
            commands::querymt_agent_stop,
            commands::querymt_agent_restart,
            commands::querymt_agent_logs,
            commands::querymt_agent_attach_stdout,
            commands::querymt_agent_drain_session_updates,
            commands::querymt_agent_write_acp_line,
            commands::querymt_session_load_start,
            commands::querymt_session_load_checkpoint,
            commands::querymt_session_load_heartbeat,
            commands::querymt_session_load_finish,
            commands::querymt_workspace_suggest_paths,
            commands::querymt_workspace_validate_directory
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                let manager = app.state::<AcpAgentManager>();
                manager.shutdown_all();
                app.state::<SessionLoadTelemetry>()
                    .close_all("application_shutdown");
                tauri::async_runtime::block_on(async { telemetry::flush() });
            }
        });
}
