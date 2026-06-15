use crate::sidecar::{AcpAgentManager, AgentLogEntry, AgentRuntimeStatus};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{ipc::Channel, AppHandle, Manager, State};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileTemplateEnableRequest {
    pub profile_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileTemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub enabled: bool,
    pub user_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProfileInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub user_path: String,
}

#[derive(Debug, Deserialize, Default)]
struct ProfileMetadataEnvelope {
    profile: Option<ProfileMetadataBlock>,
}

#[derive(Debug, Deserialize, Default)]
struct ProfileMetadataBlock {
    id: Option<String>,
    name: Option<String>,
    description: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

struct BuiltinProfileTemplate {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    tags: &'static [&'static str],
    toml: &'static str,
}

const BUILTIN_PROFILE_TEMPLATES: &[BuiltinProfileTemplate] = &[
    BuiltinProfileTemplate {
        id: "research",
        name: "Research",
        description: "Read-heavy web and document research with curated MCP hooks.",
        tags: &["research", "mcp", "curated"],
        toml: r#"[profile]
id = "research"
name = "Research"
description = "Read-heavy web and document research with curated MCP hooks."
tags = ["research", "mcp", "curated"]

[agent]
provider = "anthropic"
model = "claude-sonnet-4-5-20250929"
tools = ["question", "todoread", "todowrite", "fetch.*"]
assume_mutating = false

[[mcp]]
name = "fetch"
transport = "stdio"
command = "${QUERYMT_MCP_FETCH}"
"#,
    },
    BuiltinProfileTemplate {
        id: "desktop-lite",
        name: "Desktop Lite",
        description: "Cross-platform clipboard, notification, open-file, and fetch automation.",
        tags: &["desktop", "mcp", "curated"],
        toml: r#"[profile]
id = "desktop-lite"
name = "Desktop Lite"
description = "Cross-platform desktop integration without arbitrary app control."
tags = ["desktop", "mcp", "curated"]

[agent]
provider = "anthropic"
model = "claude-sonnet-4-5-20250929"
tools = ["question", "todoread", "todowrite", "desktop_lite.*", "fetch.*"]
assume_mutating = false
mutating_tools = [
  "desktop_lite_clipboard_read",
  "desktop_lite_clipboard_write",
  "desktop_lite_open_url",
  "desktop_lite_open_file",
]

[[mcp]]
name = "desktop_lite"
transport = "stdio"
command = "${QUERYMT_MCP_DESKTOP_LITE}"

[[mcp]]
name = "fetch"
transport = "stdio"
command = "${QUERYMT_MCP_FETCH}"
"#,
    },
    BuiltinProfileTemplate {
        id: "browser",
        name: "Browser Connector",
        description:
            "Browser automation through an installed browser connector; no bundled Chromium.",
        tags: &["browser", "mcp", "curated"],
        toml: r#"[profile]
id = "browser"
name = "Browser Connector"
description = "Uses an installed browser connector; does not bundle Chromium."
tags = ["browser", "mcp", "curated"]

[agent]
provider = "anthropic"
model = "claude-sonnet-4-5-20250929"
tools = ["question", "browser.*", "fetch.*"]
assume_mutating = false
mutating_tools = ["browser_click", "browser_type", "browser_submit"]

[[mcp]]
name = "browser"
transport = "stdio"
command = "${QUERYMT_MCP_BROWSER_CONNECTOR}"

[[mcp]]
name = "fetch"
transport = "stdio"
command = "${QUERYMT_MCP_FETCH}"
"#,
    },
];

#[tauri::command]
pub fn app_ping() -> PingResponse {
    PingResponse {
        message: "querymt-desktop-tauri-ready",
    }
}

#[tauri::command]
pub fn querymt_profile_templates(app: AppHandle) -> Result<Vec<ProfileTemplateInfo>, String> {
    ensure_profile_template_dirs(&app)?;
    BUILTIN_PROFILE_TEMPLATES
        .iter()
        .map(|template| profile_template_info(&app, template))
        .collect()
}

#[tauri::command]
pub fn querymt_profiles_list(app: AppHandle) -> Result<Vec<ManagedProfileInfo>, String> {
    ensure_profile_template_dirs(&app)?;
    let (_, profiles_dir, _) = profile_dirs(&app)?;
    list_managed_profiles(&profiles_dir)
}

#[tauri::command]
pub fn querymt_profile_enable_template(
    app: AppHandle,
    request: ProfileTemplateEnableRequest,
) -> Result<ProfileTemplateInfo, String> {
    let template = BUILTIN_PROFILE_TEMPLATES
        .iter()
        .find(|template| template.id == request.profile_id)
        .ok_or_else(|| format!("Unknown profile template: {}", request.profile_id))?;
    let (_, profiles_dir, templates_dir) = profile_dirs(&app)?;
    fs::create_dir_all(&profiles_dir).map_err(|error| {
        format!(
            "Failed to create profiles directory {}: {error}",
            profiles_dir.display()
        )
    })?;
    fs::create_dir_all(&templates_dir).map_err(|error| {
        format!(
            "Failed to create profile templates directory {}: {error}",
            templates_dir.display()
        )
    })?;
    let template_path = templates_dir.join(format!("{}.toml", template.id));
    fs::write(&template_path, template.toml).map_err(|error| {
        format!(
            "Failed to write profile template {}: {error}",
            template_path.display()
        )
    })?;
    let user_path = profiles_dir.join(format!("{}.toml", template.id));
    if !user_path.exists() {
        fs::write(&user_path, template.toml).map_err(|error| {
            format!(
                "Failed to enable profile template {}: {error}",
                user_path.display()
            )
        })?;
    }

    profile_template_info(&app, template)
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

            Some((
                score,
                WorkspaceSuggestion {
                    path: path.to_string_lossy().to_string(),
                    name,
                },
            ))
        })
        .collect::<Vec<_>>();

    suggestions.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    Ok(suggestions
        .into_iter()
        .take(limit)
        .map(|(_, suggestion)| suggestion)
        .collect())
}

#[tauri::command]
pub fn querymt_workspace_validate_directory(
    request: WorkspaceValidateRequest,
) -> Result<bool, String> {
    let path = expand_home(&request.path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Failed to inspect workspace path: {error}"))?;
    Ok(metadata.is_dir())
}

fn ensure_profile_template_dirs(app: &AppHandle) -> Result<(), String> {
    let (_, profiles_dir, templates_dir) = profile_dirs(app)?;
    fs::create_dir_all(&profiles_dir).map_err(|error| {
        format!(
            "Failed to create profiles directory {}: {error}",
            profiles_dir.display()
        )
    })?;
    fs::create_dir_all(&templates_dir).map_err(|error| {
        format!(
            "Failed to create profile templates directory {}: {error}",
            templates_dir.display()
        )
    })?;
    for template in BUILTIN_PROFILE_TEMPLATES {
        let template_path = templates_dir.join(format!("{}.toml", template.id));
        if !template_path.exists() {
            fs::write(&template_path, template.toml).map_err(|error| {
                format!(
                    "Failed to write profile template {}: {error}",
                    template_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn profile_template_info(
    app: &AppHandle,
    template: &BuiltinProfileTemplate,
) -> Result<ProfileTemplateInfo, String> {
    let (_, profiles_dir, _) = profile_dirs(app)?;
    let user_path = profiles_dir.join(format!("{}.toml", template.id));
    let enabled = user_path.exists();
    Ok(ProfileTemplateInfo {
        id: template.id.to_string(),
        name: template.name.to_string(),
        description: template.description.to_string(),
        tags: template.tags.iter().map(|tag| (*tag).to_string()).collect(),
        enabled,
        user_path: enabled.then(|| user_path.to_string_lossy().to_string()),
    })
}

fn profile_dirs(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let profiles_root = app_data_dir.join("profiles");
    let profiles_dir = profiles_root.join("user");
    let templates_dir = profiles_root.join("templates");
    Ok((profiles_root, profiles_dir, templates_dir))
}

fn list_managed_profiles(profiles_dir: &Path) -> Result<Vec<ManagedProfileInfo>, String> {
    if !profiles_dir.exists() {
        return Ok(Vec::new());
    }

    let mut profiles = Vec::new();
    for entry in fs::read_dir(profiles_dir).map_err(|error| {
        format!(
            "Failed to read profiles directory {}: {error}",
            profiles_dir.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Failed to read profile directory entry: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("toml") {
            continue;
        }

        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read profile {}: {error}", path.display()))?;
        let envelope: ProfileMetadataEnvelope = toml::from_str(&content)
            .map_err(|error| format!("Failed to parse profile {}: {error}", path.display()))?;
        let metadata = envelope.profile.unwrap_or_default();
        let fallback_id = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("profile")
            .to_string();
        profiles.push(ManagedProfileInfo {
            id: metadata.id.unwrap_or_else(|| fallback_id.clone()),
            name: metadata.name.unwrap_or_else(|| fallback_id.clone()),
            description: metadata.description,
            tags: metadata.tags,
            user_path: path.to_string_lossy().to_string(),
        });
    }

    profiles.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    Ok(profiles)
}

fn expand_home(input: &str) -> String {
    if input == "~" || input.starts_with("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            let suffix = input.strip_prefix('~').unwrap_or("");
            return PathBuf::from(home)
                .join(suffix.trim_start_matches('/'))
                .to_string_lossy()
                .to_string();
        }
    }
    input.to_string()
}

fn split_workspace_input(input: &str) -> (PathBuf, String) {
    if input.is_empty() {
        return (
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
            String::new(),
        );
    }

    let path = Path::new(input);
    if input.ends_with('/') {
        return (path.to_path_buf(), String::new());
    }

    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let partial = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
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
