pub mod commands;
pub mod deep_links;
pub mod keychain;
pub mod sidecar;

use sidecar::AcpAgentManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AcpAgentManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_ping,
            commands::querymt_agent_status,
            commands::querymt_agent_start,
            commands::querymt_agent_stop,
            commands::querymt_agent_restart,
            commands::querymt_agent_logs,
            commands::querymt_agent_attach_stdout,
            commands::querymt_agent_drain_session_updates,
            commands::querymt_agent_write_acp_line,
            commands::querymt_workspace_suggest_paths,
            commands::querymt_workspace_validate_directory
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
                let manager = app.state::<AcpAgentManager>();
                manager.shutdown_all();
            }
        });
}
