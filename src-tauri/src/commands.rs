use crate::sidecar::{AcpAgentManager, AgentLogEntry, AgentRuntimeStatus};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};
use tauri::{ipc::Channel, AppHandle, State};

#[derive(Serialize)]
pub struct PingResponse {
    message: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchRequest {
    pub agent_id: String,
    pub command_line: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionDrainRequest {
    pub agent_id: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWriteRequest {
    pub agent_id: String,
    pub line: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLogsRequest {
    pub agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSuggestRequest {
    pub input: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceValidateRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSuggestion {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub fn app_ping() -> PingResponse {
    PingResponse {
        message: "querymt-desktop-tauri-ready",
    }
}

#[tauri::command]
pub fn querymt_agent_status(
    agents: State<'_, AcpAgentManager>,
    request: AgentLaunchRequest,
) -> AgentRuntimeStatus {
    agents.status(request.agent_id, request.command_line)
}

#[tauri::command]
pub fn querymt_agent_start(
    app: AppHandle,
    agents: State<'_, AcpAgentManager>,
    request: AgentLaunchRequest,
) -> Result<AgentRuntimeStatus, String> {
    agents.start(&app, request.agent_id, request.command_line)
}

#[tauri::command]
pub fn querymt_agent_stop(
    agents: State<'_, AcpAgentManager>,
    request: AgentLogsRequest,
) -> Result<AgentRuntimeStatus, String> {
    agents.stop(request.agent_id)
}

#[tauri::command]
pub fn querymt_agent_restart(
    app: AppHandle,
    agents: State<'_, AcpAgentManager>,
    request: AgentLaunchRequest,
) -> Result<AgentRuntimeStatus, String> {
    agents.restart(&app, request.agent_id, request.command_line)
}

#[tauri::command]
pub fn querymt_agent_logs(
    agents: State<'_, AcpAgentManager>,
    request: AgentLogsRequest,
) -> Vec<AgentLogEntry> {
    agents.logs(request.agent_id)
}

#[tauri::command]
pub fn querymt_agent_attach_stdout(
    agents: State<'_, AcpAgentManager>,
    agent_id: String,
    channel: Channel<String>,
) {
    agents.attach_stdout_channel(agent_id, channel);
}

#[tauri::command]
pub fn querymt_agent_drain_session_updates(
    agents: State<'_, AcpAgentManager>,
    request: AgentSessionDrainRequest,
) -> Vec<serde_json::Value> {
    agents.drain_session_updates(request.agent_id, request.session_id)
}

#[tauri::command]
pub fn querymt_agent_write_acp_line(
    agents: State<'_, AcpAgentManager>,
    request: AgentWriteRequest,
) -> Result<(), String> {
    agents.write_acp_line(request.agent_id, request.line)
}

#[tauri::command]
pub fn querymt_workspace_suggest_paths(
    request: WorkspaceSuggestRequest,
) -> Result<Vec<WorkspaceSuggestion>, String> {
    let limit = request.limit.unwrap_or(12).clamp(1, 50);
    let expanded = expand_home(&request.input);
    let (base_dir, partial) = split_workspace_input(&expanded);
    let read_dir = fs::read_dir(&base_dir)
        .map_err(|error| format!("Failed to read directory {}: {error}", base_dir.display()))?;

    let partial_lower = partial.to_lowercase();
    let mut suggestions = read_dir
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                return None;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let name_lower = name.to_lowercase();
            let score = score_workspace_name(&name_lower, &partial_lower)?;

            Some((score, WorkspaceSuggestion {
                path: path.to_string_lossy().to_string(),
                name,
            }))
        })
        .collect::<Vec<_>>();

    suggestions.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    Ok(suggestions.into_iter().take(limit).map(|(_, suggestion)| suggestion).collect())
}

#[tauri::command]
pub fn querymt_workspace_validate_directory(
    request: WorkspaceValidateRequest,
) -> Result<bool, String> {
    let path = expand_home(&request.path);
    let metadata = fs::metadata(&path).map_err(|error| format!("Failed to inspect workspace path: {error}"))?;
    Ok(metadata.is_dir())
}

fn expand_home(input: &str) -> String {
    if input == "~" || input.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            let suffix = input.strip_prefix('~').unwrap_or("");
            return PathBuf::from(home).join(suffix.trim_start_matches('/')).to_string_lossy().to_string();
        }
    }
    input.to_string()
}

fn split_workspace_input(input: &str) -> (PathBuf, String) {
    if input.is_empty() {
        return (std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")), String::new());
    }

    let path = Path::new(input);
    if input.ends_with('/') {
        return (path.to_path_buf(), String::new());
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let partial = path.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default();
    (parent, partial)
}

fn score_workspace_name(name_lower: &str, partial_lower: &str) -> Option<i32> {
    if partial_lower.is_empty() {
        return Some(0);
    }

    if name_lower.starts_with(partial_lower) {
        return Some(1000 - name_lower.len() as i32);
    }

    if let Some(index) = name_lower.find(partial_lower) {
        return Some(700 - index as i32);
    }

    if is_ordered_subsequence(name_lower, partial_lower) {
        return Some(400 - (name_lower.len() as i32 - partial_lower.len() as i32).max(0));
    }

    None
}

fn is_ordered_subsequence(value: &str, query: &str) -> bool {
    let mut q = 0;
    let chars: Vec<char> = query.chars().collect();
    for current in value.chars() {
        if q < chars.len() && current == chars[q] {
            q += 1;
        }
    }
    q == chars.len()
}
