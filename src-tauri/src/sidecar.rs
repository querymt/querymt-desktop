use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

const MAX_LOG_LINES: usize = 200;
const MAX_SESSION_UPDATES: usize = 4000;
pub const LOG_EVENT: &str = "querymt://agent/log";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Idle,
    Starting,
    Running,
    Failed,
    Stopping,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeStatus {
    pub agent_id: String,
    pub state: AgentState,
    pub command_line: String,
    pub pid: Option<u32>,
    pub version: Option<String>,
    pub message: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLogEntry {
    pub timestamp: String,
    pub stream: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLogEvent {
    pub agent_id: String,
    pub entry: AgentLogEntry,
}

#[derive(Default, Clone)]
pub struct AcpAgentManager {
    inner: Arc<Mutex<HashMap<String, ManagedAgentProcess>>>,
}

struct ManagedAgentProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout_channel: Option<Channel<String>>,
    logs: VecDeque<AgentLogEntry>,
    session_updates: VecDeque<serde_json::Value>,
    state: ManagedAgentState,
}

#[derive(Clone)]
struct ManagedAgentState {
    agent_id: String,
    state: AgentState,
    command_line: String,
    pid: Option<u32>,
    version: Option<String>,
    message: String,
    last_error: Option<String>,
}

impl ManagedAgentState {
    fn configured(agent_id: &str, command_line: String) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            state: AgentState::Stopped,
            command_line,
            pid: None,
            version: None,
            message: "Agent is configured but not running.".to_string(),
            last_error: None,
        }
    }

    fn into_status(self) -> AgentRuntimeStatus {
        AgentRuntimeStatus {
            agent_id: self.agent_id,
            state: self.state,
            command_line: self.command_line,
            pid: self.pid,
            version: self.version,
            message: self.message,
            last_error: self.last_error,
        }
    }
}

impl ManagedAgentProcess {
    fn new(agent_id: &str, command_line: String) -> Self {
        Self {
            child: None,
            stdin: None,
            stdout_channel: None,
            logs: VecDeque::new(),
            session_updates: VecDeque::new(),
            state: ManagedAgentState::configured(agent_id, command_line),
        }
    }
}

impl AcpAgentManager {
    pub fn status(&self, agent_id: String, command_line: String) -> AgentRuntimeStatus {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let process = inner
            .entry(agent_id.clone())
            .or_insert_with(|| ManagedAgentProcess::new(&agent_id, command_line.clone()));

        if process.state.command_line != command_line {
            process.state.command_line = command_line;
        }

        reconcile_child_state(process);
        process.state.clone().into_status()
    }

    pub fn start(
        &self,
        app: &AppHandle,
        agent_id: String,
        command_line: String,
    ) -> Result<AgentRuntimeStatus, String> {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let process = inner
            .entry(agent_id.clone())
            .or_insert_with(|| ManagedAgentProcess::new(&agent_id, command_line.clone()));

        process.state.command_line = command_line.clone();
        reconcile_child_state(process);

        if process.child.is_some() {
            return Ok(process.state.clone().into_status());
        }

        process.state.state = AgentState::Starting;
        process.state.message = "Starting ACP stdio agent...".to_string();
        process.state.last_error = None;
        push_log(
            &mut process.logs,
            "system",
            &format!("Starting agent with command: {command_line}"),
        );

        let mut command = build_launch_command(app, &command_line)?;
        apply_querymt_desktop_environment(app, &command_line, &mut command)?;
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start agent: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture agent stdin pipe".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture agent stdout pipe".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture agent stderr pipe".to_string())?;

        let pid = child.id();
        process.stdin = Some(stdin);
        process.child = Some(child);
        process.session_updates.clear();
        process.state.state = AgentState::Running;
        process.state.pid = Some(pid);
        process.state.version = run_version_command(app, command_line.split_whitespace().next());
        process.state.message = "ACP stdio agent is running.".to_string();
        process.state.last_error = None;
        push_log(
            &mut process.logs,
            "system",
            &format!("Agent process started with pid {pid}."),
        );

        spawn_stdout_reader(
            agent_id.clone(),
            Arc::clone(&self.inner),
            stdout,
            app.clone(),
        );
        spawn_stderr_reader(agent_id, Arc::clone(&self.inner), stderr, app.clone());

        Ok(process.state.clone().into_status())
    }

    pub fn stop(&self, agent_id: String) -> Result<AgentRuntimeStatus, String> {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let process = inner
            .entry(agent_id.clone())
            .or_insert_with(|| ManagedAgentProcess::new(&agent_id, String::new()));

        reconcile_child_state(process);

        let Some(mut child) = process.child.take() else {
            process.state.state = AgentState::Stopped;
            process.state.message = "Agent is not running.".to_string();
            process.state.pid = None;
            return Ok(process.state.clone().into_status());
        };

        process.stdin = None;
        process.state.state = AgentState::Stopping;
        process.state.message = "Stopping ACP stdio agent...".to_string();

        child
            .kill()
            .map_err(|error| format!("Failed to stop agent: {error}"))?;
        let _ = child.wait();

        process.session_updates.clear();
        process.state.state = AgentState::Stopped;
        process.state.pid = None;
        process.state.message = "ACP stdio agent stopped.".to_string();
        push_log(&mut process.logs, "system", "Agent process stopped.");

        Ok(process.state.clone().into_status())
    }

    pub fn restart(
        &self,
        app: &AppHandle,
        agent_id: String,
        command_line: String,
    ) -> Result<AgentRuntimeStatus, String> {
        let _ = self.stop(agent_id.clone());
        self.start(app, agent_id, command_line)
    }

    pub fn shutdown_all(&self) {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");

        for process in inner.values_mut() {
            reconcile_child_state(process);

            let Some(mut child) = process.child.take() else {
                process.stdin = None;
                process.session_updates.clear();
                process.state.state = AgentState::Stopped;
                process.state.pid = None;
                process.state.message = "Agent is not running.".to_string();
                continue;
            };

            process.stdin = None;
            process.state.state = AgentState::Stopping;
            process.state.message = "Stopping ACP stdio agent during app shutdown...".to_string();

            let _ = child.kill();
            let _ = child.wait();

            process.session_updates.clear();
            process.state.state = AgentState::Stopped;
            process.state.pid = None;
            process.state.message = "Agent process stopped during app shutdown.".to_string();
            push_log(
                &mut process.logs,
                "system",
                "Agent process stopped during app shutdown.",
            );
        }
    }

    pub fn logs(&self, agent_id: String) -> Vec<AgentLogEntry> {
        let inner = self.inner.lock().expect("agent manager lock poisoned");
        inner
            .get(&agent_id)
            .map(|process| process.logs.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn attach_stdout_channel(&self, agent_id: String, channel: Channel<String>) {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let process = inner
            .entry(agent_id.clone())
            .or_insert_with(|| ManagedAgentProcess::new(&agent_id, String::new()));
        process.stdout_channel = Some(channel);
    }

    pub fn drain_session_updates(
        &self,
        agent_id: String,
        session_id: Option<String>,
    ) -> Vec<serde_json::Value> {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let Some(process) = inner.get_mut(&agent_id) else {
            return Vec::new();
        };

        let mut drained = Vec::new();
        let mut retained = VecDeque::new();

        while let Some(value) = process.session_updates.pop_front() {
            let notification = value.get("params").unwrap_or(&value);
            let matches = session_id.as_ref().map_or(true, |expected| {
                notification
                    .get("sessionId")
                    .or_else(|| notification.get("session_id"))
                    .and_then(serde_json::Value::as_str)
                    .map(|actual| actual == expected)
                    .unwrap_or(false)
            });

            if matches {
                drained.push(notification.clone());
            } else {
                retained.push_back(value);
            }
        }

        process.session_updates = retained;
        drained
    }

    pub fn write_acp_line(&self, agent_id: String, line: String) -> Result<(), String> {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let process = inner
            .get_mut(&agent_id)
            .ok_or_else(|| format!("No process registered for agent {agent_id}"))?;

        reconcile_child_state(process);
        push_log(&mut process.logs, "system", &summarize_acp_in_line(&line));

        let stdin = process
            .stdin
            .as_mut()
            .ok_or_else(|| format!("ACP stdin is not available for agent {agent_id}"))?;

        stdin
            .write_all(line.as_bytes())
            .map_err(|error| format!("Failed to write ACP line: {error}"))?;
        stdin
            .write_all(b"\n")
            .map_err(|error| format!("Failed to terminate ACP line: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("Failed to flush ACP line: {error}"))?;

        Ok(())
    }
}

fn build_launch_command(app: &AppHandle, command_line: &str) -> Result<Command, String> {
    let parts = shlex::split(command_line)
        .ok_or_else(|| "Could not parse command line for ACP agent.".to_string())?;
    let (program, args) = parts
        .split_first()
        .ok_or_else(|| "ACP command line cannot be empty.".to_string())?;

    let mut command = Command::new(resolve_agent_program_path(app, program));
    command.args(args);
    Ok(command)
}

fn apply_querymt_desktop_environment(
    app: &AppHandle,
    command_line: &str,
    command: &mut Command,
) -> Result<(), String> {
    if !command_line.contains("qmtcode") {
        return Ok(());
    }

    let (app_data_dir, profiles_dir, templates_dir) = querymt_desktop_paths(app)?;
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

    command.env("QUERYMT_DESKTOP_HOME", &app_data_dir);
    command.env("QUERYMT_DESKTOP_PROFILES_DIR", &profiles_dir);
    command.env("QUERYMT_DESKTOP_PROFILE_TEMPLATES_DIR", &templates_dir);
    if !command_line.contains("--profiles-dir") {
        command.arg("--profiles-dir");
        command.arg(&profiles_dir);
    }
    Ok(())
}

fn querymt_desktop_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let profiles_root = app_data_dir.join("profiles");
    let profiles_dir = profiles_root.join("user");
    let templates_dir = profiles_root.join("templates");
    Ok((app_data_dir, profiles_dir, templates_dir))
}

fn run_version_command(app: &AppHandle, program: Option<&str>) -> Option<String> {
    let program = program?;
    let output = Command::new(resolve_agent_program_path(app, program))
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        None
    } else {
        Some(stdout)
    }
}

fn resolve_agent_program_path(app: &AppHandle, program: &str) -> PathBuf {
    let configured = PathBuf::from(program);
    if configured.components().count() > 1 || configured.is_absolute() {
        return configured;
    }

    let Some(sidecar_filename) = qmtcode_sidecar_filename(program) else {
        return configured;
    };

    for candidate in qmtcode_sidecar_candidates(app, &sidecar_filename) {
        if candidate.exists() {
            return candidate;
        }
    }

    configured
}

fn qmtcode_sidecar_filename(program: &str) -> Option<String> {
    match program {
        "qmtcode" | "qmtcode.exe" => Some(format!(
            "qmtcode-{}{}",
            current_target_triple(),
            executable_suffix()
        )),
        _ => None,
    }
}

fn qmtcode_sidecar_candidates(app: &AppHandle, sidecar_filename: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(sidecar_filename));
            candidates.push(exe_dir.join("binaries").join(sidecar_filename));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(sidecar_filename));
        candidates.push(resource_dir.join("binaries").join(sidecar_filename));
    }

    candidates
}

#[cfg(target_os = "windows")]
fn executable_suffix() -> &'static str {
    ".exe"
}

#[cfg(not(target_os = "windows"))]
fn executable_suffix() -> &'static str {
    ""
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn current_target_triple() -> &'static str {
    "aarch64-apple-darwin"
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn current_target_triple() -> &'static str {
    "x86_64-apple-darwin"
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn current_target_triple() -> &'static str {
    "x86_64-pc-windows-msvc"
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn current_target_triple() -> &'static str {
    "x86_64-unknown-linux-gnu"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn current_target_triple() -> &'static str {
    "aarch64-unknown-linux-gnu"
}

#[cfg(not(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "macos", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "x86_64"),
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "linux", target_arch = "aarch64")
)))]
fn current_target_triple() -> &'static str {
    "unsupported-target"
}

fn reconcile_child_state(process: &mut ManagedAgentProcess) {
    let Some(child) = process.child.as_mut() else {
        return;
    };

    match child.try_wait() {
        Ok(Some(status)) => {
            let exit = status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "terminated by signal".to_string());
            let expected_stop = matches!(process.state.state, AgentState::Stopping | AgentState::Stopped);
            push_log(
                &mut process.logs,
                "system",
                &format!("Agent process exited with status {exit}."),
            );
            process.child = None;
            process.stdin = None;
            process.session_updates.clear();
            process.state.pid = None;
            if expected_stop {
                process.state.state = AgentState::Stopped;
                process.state.message = "ACP stdio agent is not running.".to_string();
                process.state.last_error = None;
            } else {
                process.state.state = AgentState::Failed;
                process.state.last_error = Some(format!("Agent process exited with status {exit}."));
                process.state.message = "ACP stdio agent exited unexpectedly.".to_string();
            }
        }
        Ok(None) => {}
        Err(error) => {
            process.state.state = AgentState::Failed;
            process.state.last_error = Some(error.to_string());
            push_log(
                &mut process.logs,
                "system",
                &format!("Failed to poll agent runtime state: {error}"),
            );
        }
    }
}

fn spawn_stdout_reader(
    agent_id: String,
    inner: Arc<Mutex<HashMap<String, ManagedAgentProcess>>>,
    stdout: ChildStdout,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let mut should_emit = false;
            {
                let mut locked = inner.lock().expect("agent manager lock poisoned");
                let Some(process) = locked.get_mut(&agent_id) else {
                    continue;
                };

                push_log(
                    &mut process.logs,
                    "system",
                    &format!("ACP-OUT {}", summarize_acp_out_line(&line)),
                );

                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if value.get("method").and_then(serde_json::Value::as_str)
                        == Some("session/update")
                    {
                        if process.session_updates.len() >= MAX_SESSION_UPDATES {
                            process.session_updates.pop_front();
                        }
                        process.session_updates.push_back(value);
                    }
                }

                if let Some(channel) = &process.stdout_channel {
                    let _ = channel.send(line.clone());
                }
                should_emit = true;
            }

            if should_emit {
                let entry = AgentLogEntry {
                    timestamp: unix_timestamp(),
                    stream: "system".to_string(),
                    message: format!("ACP-OUT {}", summarize_acp_out_line(&line)),
                };
                let _ = app.emit(
                    LOG_EVENT,
                    AgentLogEvent {
                        agent_id: agent_id.clone(),
                        entry,
                    },
                );
            }
        }
    });
}

fn spawn_stderr_reader(
    agent_id: String,
    inner: Arc<Mutex<HashMap<String, ManagedAgentProcess>>>,
    stderr: ChildStderr,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            append_log(&agent_id, &inner, "stderr", &line, Some(&app));
        }
    });
}

fn append_log(
    agent_id: &str,
    inner: &Arc<Mutex<HashMap<String, ManagedAgentProcess>>>,
    stream: &str,
    message: &str,
    app: Option<&AppHandle>,
) {
    let entry = AgentLogEntry {
        timestamp: unix_timestamp(),
        stream: stream.to_string(),
        message: message.to_string(),
    };

    {
        let mut locked = inner.lock().expect("agent manager lock poisoned");
        let Some(process) = locked.get_mut(agent_id) else {
            return;
        };
        if process.logs.len() >= MAX_LOG_LINES {
            process.logs.pop_front();
        }
        process.logs.push_back(entry.clone());
    }

    if let Some(app) = app {
        let _ = app.emit(
            LOG_EVENT,
            AgentLogEvent {
                agent_id: agent_id.to_string(),
                entry,
            },
        );
    }
}

fn push_log(logs: &mut VecDeque<AgentLogEntry>, stream: &str, message: &str) {
    if logs.len() >= MAX_LOG_LINES {
        logs.pop_front();
    }
    logs.push_back(AgentLogEntry {
        timestamp: unix_timestamp(),
        stream: stream.to_string(),
        message: message.to_string(),
    });
}

fn summarize_acp_in_line(line: &str) -> String {
    let Ok(message) = serde_json::from_str::<serde_json::Value>(line) else {
        return format!("ACP-IN raw={}", truncate_for_log(line));
    };

    let id = message
        .get("id")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let method = message
        .get("method")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    format!("ACP-IN id={id} method={method}")
}

fn summarize_acp_out_line(line: &str) -> String {
    let Ok(message) = serde_json::from_str::<serde_json::Value>(line) else {
        return truncate_for_log(line);
    };

    if let Some(method) = message.get("method").and_then(serde_json::Value::as_str) {
        return format!("method={method}");
    }

    if let Some(id) = message.get("id") {
        return format!("response id={id}");
    }

    truncate_for_log(line)
}

fn truncate_for_log(value: &str) -> String {
    const MAX_LEN: usize = 180;
    if value.len() <= MAX_LEN {
        return value.to_string();
    }

    format!("{}...", &value[..MAX_LEN])
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
