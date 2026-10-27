use opentelemetry::trace::TraceContextExt;
use opentelemetry::Context;
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    ffi::OsStr,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Emitter, Manager};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::BrowserEngine;
type AppHandle = tauri::AppHandle<BrowserEngine>;
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
    /// Absolute path (or bare command) the agent was last launched from.
    pub resolved_program: Option<String>,
    pub program_source: Option<ProgramSource>,
}

/// Where the program for an agent command was found.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProgramSource {
    /// Shipped inside the application bundle (resolved at every start, never persisted).
    Bundled,
    /// Found by searching `PATH`.
    Path,
    /// The command line already contained a path.
    Explicit,
}

impl ProgramSource {
    fn label(self) -> &'static str {
        match self {
            ProgramSource::Bundled => "bundled",
            ProgramSource::Path => "PATH",
            ProgramSource::Explicit => "explicit path",
        }
    }
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
    stdout_generation: u64,
    logs: VecDeque<AgentLogEntry>,
    session_updates: VecDeque<serde_json::Value>,
    pending_requests: HashMap<String, PendingAcpRequest>,
    state: ManagedAgentState,
}

struct PendingAcpRequest {
    span: tracing::Span,
    started: Instant,
    notification_count: u64,
    notification_bytes: u64,
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
    resolved_program: Option<String>,
    program_source: Option<ProgramSource>,
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
            resolved_program: None,
            program_source: None,
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
            resolved_program: self.resolved_program,
            program_source: self.program_source,
        }
    }
}

impl ManagedAgentProcess {
    fn new(agent_id: &str, command_line: String) -> Self {
        Self {
            child: None,
            stdin: None,
            stdout_channel: None,
            stdout_generation: 0,
            logs: VecDeque::new(),
            session_updates: VecDeque::new(),
            pending_requests: HashMap::new(),
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

        // Any failure from here on must leave the agent in `Failed`, never stuck in `Starting`.
        let LaunchedAgent {
            child,
            stdin,
            stdout,
            stderr,
            program,
        } = match launch_agent(app, &command_line) {
            Ok(launched) => launched,
            Err(error) => {
                let entry = record_start_failure(process, &error);
                let _ = app.emit(
                    LOG_EVENT,
                    AgentLogEvent {
                        agent_id: agent_id.clone(),
                        entry,
                    },
                );
                return Err(error);
            }
        };

        let pid = child.id();
        process.stdin = Some(stdin);
        process.child = Some(child);
        close_pending_requests(process, "agent_restarted");
        process.session_updates.clear();
        process.state.state = AgentState::Running;
        process.state.pid = Some(pid);
        process.state.version = None;
        process.state.resolved_program = Some(program.path.display().to_string());
        process.state.program_source = Some(program.source);
        process.state.message = "ACP stdio agent is running.".to_string();
        process.state.last_error = None;
        push_log(
            &mut process.logs,
            "system",
            &format!(
                "Agent process started with pid {pid} from {} ({}).",
                program.path.display(),
                program.source.label()
            ),
        );

        spawn_stdout_reader(
            agent_id.clone(),
            Arc::clone(&self.inner),
            stdout,
            app.clone(),
        );
        spawn_stderr_reader(
            agent_id.clone(),
            Arc::clone(&self.inner),
            stderr,
            app.clone(),
        );
        spawn_version_probe(agent_id, Arc::clone(&self.inner), program.path, pid);

        Ok(process.state.clone().into_status())
    }

    pub fn stop(&self, agent_id: String) -> Result<AgentRuntimeStatus, String> {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let process = inner
            .entry(agent_id.clone())
            .or_insert_with(|| ManagedAgentProcess::new(&agent_id, String::new()));

        reconcile_child_state(process);

        let Some(mut child) = process.child.take() else {
            process.stdout_channel = None;
            process.state.state = AgentState::Stopped;
            process.state.message = "Agent is not running.".to_string();
            process.state.pid = None;
            return Ok(process.state.clone().into_status());
        };

        process.stdin = None;
        process.stdout_channel = None;
        process.state.state = AgentState::Stopping;
        process.state.message = "Stopping ACP stdio agent...".to_string();

        child
            .kill()
            .map_err(|error| format!("Failed to stop agent: {error}"))?;
        let _ = child.wait();

        process.session_updates.clear();
        close_pending_requests(process, "agent_stopped");
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
                process.stdout_channel = None;
                process.session_updates.clear();
                process.state.state = AgentState::Stopped;
                process.state.pid = None;
                process.state.message = "Agent is not running.".to_string();
                continue;
            };

            process.stdin = None;
            process.stdout_channel = None;
            process.state.state = AgentState::Stopping;
            process.state.message = "Stopping ACP stdio agent during app shutdown...".to_string();

            let _ = child.kill();
            let _ = child.wait();

            process.session_updates.clear();
            close_pending_requests(process, "application_shutdown");
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

    pub fn attach_stdout_channel(&self, agent_id: String, channel: Channel<String>) -> u64 {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let process = inner
            .entry(agent_id.clone())
            .or_insert_with(|| ManagedAgentProcess::new(&agent_id, String::new()));
        process.stdout_generation = next_stdout_generation(process.stdout_generation);
        process.stdout_channel = Some(channel);
        process.stdout_generation
    }

    pub fn detach_stdout_channel(&self, agent_id: String, generation: Option<u64>) {
        let Some(expected) = generation else {
            return;
        };
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        if let Some(process) = inner.get_mut(&agent_id) {
            if stdout_generation_matches(process.stdout_generation, expected) {
                process.stdout_channel = None;
            }
        }
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

    pub fn write_acp_line(
        &self,
        agent_id: String,
        line: String,
        operation_parent: Option<Context>,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().expect("agent manager lock poisoned");
        let process = inner
            .get_mut(&agent_id)
            .ok_or_else(|| format!("No process registered for agent {agent_id}"))?;

        reconcile_child_state(process);
        let (line, pending) = instrument_acp_request(&agent_id, &line, operation_parent)?;
        push_log(&mut process.logs, "system", &summarize_acp_in_line(&line));

        if let Some((request_id, pending)) = pending {
            process.pending_requests.insert(request_id, pending);
        }

        let write_result = (|| {
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
                .map_err(|error| format!("Failed to flush ACP line: {error}"))
        })();
        if write_result.is_err() {
            fail_pending_request_for_line(process, &line, "stdin_write_failed");
        }
        write_result
    }
}

fn request_id_key(value: &serde_json::Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| value.to_string())
}

fn instrument_acp_request(
    agent_id: &str,
    line: &str,
    operation_parent: Option<Context>,
) -> Result<(String, Option<(String, PendingAcpRequest)>), String> {
    let Ok(mut message) = serde_json::from_str::<serde_json::Value>(line) else {
        return Ok((line.to_string(), None));
    };
    let Some(id) = message.get("id").cloned() else {
        return Ok((line.to_string(), None));
    };
    let Some(method) = message
        .get("method")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
    else {
        return Ok((line.to_string(), None));
    };
    let session_id = message
        .pointer("/params/sessionId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    let span = tracing::info_span!(
        "desktop.acp.request",
        rpc.system = "jsonrpc",
        rpc.method = %method,
        agent.id = %agent_id,
        session.id = %session_id,
        request.bytes = line.len() as i64,
        response.bytes = tracing::field::Empty,
        response.elapsed_ms = tracing::field::Empty,
        notification.count = tracing::field::Empty,
        notification.bytes = tracing::field::Empty,
        request.status = tracing::field::Empty,
    );
    if let Some(parent) = operation_parent {
        let _ = span.set_parent(parent);
    }
    let context = span.context();
    let context_span = context.span();
    let span_context = context_span.span_context();
    if span_context.is_valid() {
        let flags = if span_context.is_sampled() {
            "01"
        } else {
            "00"
        };
        let traceparent = format!(
            "00-{}-{}-{flags}",
            span_context.trace_id(),
            span_context.span_id()
        );
        let params = message
            .as_object_mut()
            .ok_or_else(|| "ACP request must be a JSON object".to_string())?
            .entry("params")
            .or_insert_with(|| serde_json::json!({}));
        let params = params
            .as_object_mut()
            .ok_or_else(|| "ACP request params must be a JSON object".to_string())?;
        let meta = params
            .entry("_meta")
            .or_insert_with(|| serde_json::json!({}));
        let meta = meta
            .as_object_mut()
            .ok_or_else(|| "ACP request _meta must be a JSON object".to_string())?;
        meta.entry("traceparent".to_string())
            .or_insert(serde_json::Value::String(traceparent));
        let tracestate = span_context.trace_state().header();
        if !tracestate.is_empty() {
            meta.entry("tracestate".to_string())
                .or_insert(serde_json::Value::String(tracestate));
        }
    }
    let line = serde_json::to_string(&message)
        .map_err(|error| format!("Failed to serialize traced ACP request: {error}"))?;
    Ok((
        line,
        Some((
            request_id_key(&id),
            PendingAcpRequest {
                span,
                started: Instant::now(),
                notification_count: 0,
                notification_bytes: 0,
            },
        )),
    ))
}

fn finish_pending_request(process: &mut ManagedAgentProcess, id: &serde_json::Value, bytes: usize) {
    let Some(pending) = process.pending_requests.remove(&request_id_key(id)) else {
        return;
    };
    pending.span.record("response.bytes", bytes as i64);
    pending.span.record(
        "response.elapsed_ms",
        pending.started.elapsed().as_millis() as i64,
    );
    pending
        .span
        .record("notification.count", pending.notification_count as i64);
    pending
        .span
        .record("notification.bytes", pending.notification_bytes as i64);
    pending.span.record("request.status", "ok");
}

fn fail_pending_request_for_line(
    process: &mut ManagedAgentProcess,
    line: &str,
    status: &'static str,
) {
    let Ok(message) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    let Some(id) = message.get("id") else {
        return;
    };
    if let Some(pending) = process.pending_requests.remove(&request_id_key(id)) {
        pending.span.record("request.status", status);
    }
}

fn close_pending_requests(process: &mut ManagedAgentProcess, status: &'static str) {
    for (_, pending) in process.pending_requests.drain() {
        pending.span.record("request.status", status);
    }
}

/// A program resolved from the first token of an agent command line.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedProgram {
    path: PathBuf,
    source: ProgramSource,
}

struct LaunchedAgent {
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    program: ResolvedProgram,
}

/// Base name of the agent binary shipped inside the application bundle.
const BUNDLED_AGENT_NAME: &str = "qmtcode";

fn launch_agent(app: &AppHandle, command_line: &str) -> Result<LaunchedAgent, String> {
    let parts = shlex::split(command_line)
        .ok_or_else(|| "Could not parse command line for ACP agent.".to_string())?;
    let (program, args) = parts
        .split_first()
        .ok_or_else(|| "ACP command line cannot be empty.".to_string())?;

    // Resolved on every start, never persisted, so the app keeps working after it is moved.
    let resolved = resolve_program(
        program,
        &bundle_search_dirs(app),
        std::env::var_os("PATH").as_deref(),
    )?;

    let mut command = Command::new(&resolved.path);
    command.args(args);
    if is_querymt_agent(&resolved.path) {
        apply_querymt_desktop_environment(app, command_line, &mut command)?;
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Failed to start agent '{}' ({}): {error}",
            resolved.path.display(),
            resolved.source.label()
        )
    })?;

    match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
        (Some(stdin), Some(stdout), Some(stderr)) => Ok(LaunchedAgent {
            child,
            stdin,
            stdout,
            stderr,
            program: resolved,
        }),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            Err("Failed to capture agent stdio pipes".to_string())
        }
    }
}

/// Directories that may contain the bundled agent, relative to the running app.
fn bundle_search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut push = |dir: PathBuf| {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    };

    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        push(exe_dir.clone());
        push(exe_dir.join("binaries"));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        push(resource_dir.clone());
        push(resource_dir.join("binaries"));
    }
    dirs
}

/// File names the bundled agent may have: the plain name Tauri installs for
/// `externalBin`, and the target-suffixed name used by the CEF packaging.
fn bundled_agent_file_names() -> [String; 2] {
    let suffix = executable_suffix();
    [
        format!("{BUNDLED_AGENT_NAME}{suffix}"),
        format!("{BUNDLED_AGENT_NAME}-{}{suffix}", current_target_triple()),
    ]
}

fn is_bundled_agent_command(program: &str) -> bool {
    program == BUNDLED_AGENT_NAME || program == format!("{BUNDLED_AGENT_NAME}.exe")
}

/// Whether the resolved program is a qmtcode binary (and so understands `--profiles-dir`).
fn is_querymt_agent(path: &Path) -> bool {
    path.file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.starts_with(BUNDLED_AGENT_NAME))
}

/// Resolve the program of an agent command.
///
/// - Anything containing a path separator is used as written (`Explicit`).
/// - A bare `qmtcode` prefers the copy shipped with the app (`Bundled`), then `PATH`.
/// - Any other bare name is left to the OS `PATH` lookup (`Path`).
fn resolve_program(
    program: &str,
    bundle_dirs: &[PathBuf],
    path_var: Option<&OsStr>,
) -> Result<ResolvedProgram, String> {
    let configured = Path::new(program);
    if configured.is_absolute() || configured.components().count() > 1 {
        return Ok(ResolvedProgram {
            path: configured.to_path_buf(),
            source: ProgramSource::Explicit,
        });
    }

    if !is_bundled_agent_command(program) {
        return Ok(ResolvedProgram {
            path: configured.to_path_buf(),
            source: ProgramSource::Path,
        });
    }

    let names = bundled_agent_file_names();
    let mut searched = Vec::new();
    for dir in bundle_dirs {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(ResolvedProgram {
                    path: candidate,
                    source: ProgramSource::Bundled,
                });
            }
            searched.push(candidate);
        }
    }

    if let Some(found) = path_var.and_then(|path| find_on_path(&names[0], path)) {
        return Ok(ResolvedProgram {
            path: found,
            source: ProgramSource::Path,
        });
    }

    let searched = searched
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Could not find the '{BUNDLED_AGENT_NAME}' agent. It is not bundled with this app and is not on PATH. \
         Looked in: [{searched}]. Reinstall QueryMT Desktop, or set the agent command to the full path of a qmtcode binary."
    ))
}

fn find_on_path(file_name: &str, path_var: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_var)
        .map(|dir| dir.join(file_name))
        .find(|candidate| candidate.is_file())
}

fn apply_querymt_desktop_environment(
    app: &AppHandle,
    command_line: &str,
    command: &mut Command,
) -> Result<(), String> {
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

fn run_version_command(program: &Path) -> Option<String> {
    let output = Command::new(program)
        .arg("--version")
        .stdin(Stdio::null())
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

/// Query the agent version off the start path so it never blocks the manager lock.
fn spawn_version_probe(
    agent_id: String,
    inner: Arc<Mutex<HashMap<String, ManagedAgentProcess>>>,
    program: PathBuf,
    pid: u32,
) {
    std::thread::spawn(move || {
        let Some(version) = run_version_command(&program) else {
            return;
        };
        let mut locked = inner.lock().expect("agent manager lock poisoned");
        if let Some(process) = locked.get_mut(&agent_id) {
            if process.state.pid == Some(pid) {
                process.state.version = Some(version);
            }
        }
    });
}

/// Move a failed start out of `Starting` and return the log entry describing it.
fn record_start_failure(process: &mut ManagedAgentProcess, error: &str) -> AgentLogEntry {
    process.child = None;
    process.stdin = None;
    process.state.state = AgentState::Failed;
    process.state.pid = None;
    process.state.message = "Failed to start ACP stdio agent.".to_string();
    process.state.last_error = Some(error.to_string());

    let entry = AgentLogEntry {
        timestamp: unix_timestamp(),
        stream: "system".to_string(),
        message: error.to_string(),
    };
    if process.logs.len() >= MAX_LOG_LINES {
        process.logs.pop_front();
    }
    process.logs.push_back(entry.clone());
    entry
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
            let expected_stop = matches!(
                process.state.state,
                AgentState::Stopping | AgentState::Stopped
            );
            push_log(
                &mut process.logs,
                "system",
                &format!("Agent process exited with status {exit}."),
            );
            process.child = None;
            process.stdin = None;
            process.stdout_channel = None;
            process.session_updates.clear();
            close_pending_requests(process, "agent_exited");
            process.state.pid = None;
            if expected_stop {
                process.state.state = AgentState::Stopped;
                process.state.message = "ACP stdio agent is not running.".to_string();
                process.state.last_error = None;
            } else {
                process.state.state = AgentState::Failed;
                process.state.last_error =
                    Some(format!("Agent process exited with status {exit}."));
                process.state.message = "ACP stdio agent exited unexpectedly.".to_string();
            }
        }
        Ok(None) => {}
        Err(error) => {
            close_pending_requests(process, "agent_poll_failed");
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
                        for pending in process.pending_requests.values_mut() {
                            pending.notification_count += 1;
                            pending.notification_bytes += line.len() as u64;
                        }
                    } else if is_acp_response(&value) {
                        if let Some(id) = value.get("id") {
                            finish_pending_request(process, id, line.len());
                        }
                    }
                }

                let delivered = process
                    .stdout_channel
                    .as_ref()
                    .is_some_and(|channel| channel.send(line.clone()).is_ok());
                if let Some(value) = recovery_session_update(&line, delivered) {
                    if process.session_updates.len() >= MAX_SESSION_UPDATES {
                        process.session_updates.pop_front();
                    }
                    process.session_updates.push_back(value);
                }
            }

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

fn is_acp_response(value: &serde_json::Value) -> bool {
    value.get("id").is_some() && value.get("method").is_none()
}

fn recovery_session_update(line: &str, delivered: bool) -> Option<serde_json::Value> {
    if delivered {
        return None;
    }
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    (value.get("method").and_then(serde_json::Value::as_str) == Some("session/update"))
        .then_some(value)
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

    // Cut on a char boundary; slicing mid-codepoint would panic.
    let mut end = MAX_LEN;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &value[..end])
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn next_stdout_generation(current: u64) -> u64 {
    current.wrapping_add(1).max(1)
}

fn stdout_generation_matches(current: u64, expected: u64) -> bool {
    current != 0 && current == expected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acp_instrumentation_preserves_existing_meta() {
        let input = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "session/load",
            "params": {
                "sessionId": "session-1",
                "_meta": {
                    "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
                    "custom": "value"
                }
            }
        })
        .to_string();
        let (output, pending) = instrument_acp_request("agent-1", &input, None).unwrap();
        let output: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert_eq!(
            output
                .pointer("/params/_meta/custom")
                .and_then(|v| v.as_str()),
            Some("value")
        );
        assert_eq!(
            output
                .pointer("/params/_meta/traceparent")
                .and_then(|v| v.as_str()),
            Some("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")
        );
        assert_eq!(pending.unwrap().0, "7");
    }

    #[test]
    fn notifications_are_not_tracked_as_pending_requests() {
        let input = r#"{"jsonrpc":"2.0","method":"session/cancel","params":{}}"#;
        let (output, pending) = instrument_acp_request("agent-1", input, None).unwrap();
        assert_eq!(output, input);
        assert!(pending.is_none());
    }

    #[test]
    fn response_detection_excludes_agent_initiated_requests() {
        assert!(is_acp_response(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 7,
            "result": {}
        })));
        assert!(!is_acp_response(&serde_json::json!({
            "jsonrpc": "2.0",
            "id": 8,
            "method": "session/request_permission",
            "params": {}
        })));
    }

    #[test]
    fn successful_channel_delivery_does_not_enter_recovery_queue() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}}}"#;
        assert!(recovery_session_update(line, true).is_none());
        assert!(recovery_session_update(line, false).is_some());
    }

    #[test]
    fn stdout_generation_skips_zero_after_wrap() {
        assert_eq!(next_stdout_generation(0), 1);
        assert_eq!(next_stdout_generation(1), 2);
        assert_eq!(next_stdout_generation(u64::MAX), 1);
        assert!(!stdout_generation_matches(0, 0));
        assert!(stdout_generation_matches(2, 2));
        assert!(!stdout_generation_matches(2, 1));
    }

    #[test]
    fn detach_stdout_channel_is_idempotent() {
        let manager = AcpAgentManager::default();
        manager.detach_stdout_channel("missing".to_string(), Some(1));
        manager.detach_stdout_channel("missing".to_string(), None);
    }

    #[test]
    fn stale_detach_does_not_clear_replacement_stdout_channel() {
        let manager = AcpAgentManager::default();
        let first = dummy_stdout_channel();
        let second = dummy_stdout_channel();

        let first_generation = manager.attach_stdout_channel("agent-1".to_string(), first);
        let second_generation = manager.attach_stdout_channel("agent-1".to_string(), second);
        assert_ne!(first_generation, second_generation);

        manager.detach_stdout_channel("agent-1".to_string(), None);
        manager.detach_stdout_channel("agent-1".to_string(), Some(first_generation));
        {
            let inner = manager.inner.lock().expect("agent manager lock poisoned");
            let process = inner.get("agent-1").expect("agent process");
            assert!(process.stdout_channel.is_some());
            assert_eq!(process.stdout_generation, second_generation);
        }

        manager.detach_stdout_channel("agent-1".to_string(), Some(second_generation));
        {
            let inner = manager.inner.lock().expect("agent manager lock poisoned");
            let process = inner.get("agent-1").expect("agent process");
            assert!(process.stdout_channel.is_none());
            assert_eq!(process.stdout_generation, second_generation);
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qmt-sidecar-{label}-{}-{}",
            std::process::id(),
            unix_timestamp()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(dir: &Path, name: &str) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, b"#!/bin/sh\n").unwrap();
        path
    }

    #[test]
    fn bare_qmtcode_resolves_to_plain_bundled_name() {
        let root = temp_dir("plain");
        let name = bundled_agent_file_names()[0].clone();
        let expected = touch(&root, &name);

        let resolved = resolve_program("qmtcode", std::slice::from_ref(&root), None).unwrap();
        assert_eq!(resolved.path, expected);
        assert_eq!(resolved.source, ProgramSource::Bundled);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bare_qmtcode_resolves_to_target_suffixed_bundled_name() {
        let root = temp_dir("suffixed");
        let name = bundled_agent_file_names()[1].clone();
        let expected = touch(&root, &name);

        let resolved = resolve_program("qmtcode", std::slice::from_ref(&root), None).unwrap();
        assert_eq!(resolved.path, expected);
        assert_eq!(resolved.source, ProgramSource::Bundled);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bundled_copy_wins_over_path() {
        let root = temp_dir("bundled-first");
        let bundled = touch(&root.join("app"), &bundled_agent_file_names()[0]);
        let on_path = root.join("bin");
        touch(&on_path, &bundled_agent_file_names()[0]);
        let path_var = std::env::join_paths([&on_path]).unwrap();

        let resolved =
            resolve_program("qmtcode", &[root.join("app")], Some(path_var.as_os_str())).unwrap();
        assert_eq!(resolved.path, bundled);
        assert_eq!(resolved.source, ProgramSource::Bundled);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn plain_name_wins_over_suffixed_name_in_same_dir() {
        let root = temp_dir("both-names");
        let plain = touch(&root, &bundled_agent_file_names()[0]);
        touch(&root, &bundled_agent_file_names()[1]);

        let resolved = resolve_program("qmtcode", std::slice::from_ref(&root), None).unwrap();
        assert_eq!(resolved.path, plain);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn falls_back_to_path_when_not_bundled() {
        let root = temp_dir("path-fallback");
        let on_path = root.join("bin");
        let expected = touch(&on_path, &bundled_agent_file_names()[0]);
        let path_var = std::env::join_paths([&on_path]).unwrap();

        let resolved = resolve_program(
            "qmtcode",
            &[root.join("missing")],
            Some(path_var.as_os_str()),
        )
        .unwrap();
        assert_eq!(resolved.path, expected);
        assert_eq!(resolved.source, ProgramSource::Path);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_qmtcode_errors_listing_searched_locations() {
        let root = temp_dir("missing");
        let dir = root.join("Contents").join("MacOS");

        let error = resolve_program("qmtcode", std::slice::from_ref(&dir), None).unwrap_err();
        assert!(
            error.contains("Could not find the 'qmtcode' agent"),
            "{error}"
        );
        assert!(error.contains(&dir.display().to_string()), "{error}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn moved_app_still_resolves_from_its_new_location() {
        let root = temp_dir("moved");
        let first = root.join("Applications").join("A.app").join("MacOS");
        let name = bundled_agent_file_names()[0].clone();
        touch(&first, &name);
        let second = root.join("Elsewhere").join("B.app").join("MacOS");
        fs::create_dir_all(second.parent().unwrap()).unwrap();
        fs::rename(first.parent().unwrap(), second.parent().unwrap()).unwrap();

        // The resolver only sees the current directory, so a stale location is never used.
        let resolved = resolve_program("qmtcode", std::slice::from_ref(&second), None).unwrap();
        assert_eq!(resolved.path, second.join(&name));
        assert!(resolve_program("qmtcode", &[first], None).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_paths_are_used_as_written() {
        let resolved = resolve_program("/opt/tools/qmtcode", &[], None).unwrap();
        assert_eq!(resolved.path, PathBuf::from("/opt/tools/qmtcode"));
        assert_eq!(resolved.source, ProgramSource::Explicit);

        let resolved = resolve_program("./bin/qmtcode", &[], None).unwrap();
        assert_eq!(resolved.source, ProgramSource::Explicit);
    }

    #[test]
    fn other_bare_commands_are_left_to_the_os_path_lookup() {
        let resolved = resolve_program("npx", &[], None).unwrap();
        assert_eq!(resolved.path, PathBuf::from("npx"));
        assert_eq!(resolved.source, ProgramSource::Path);
    }

    #[test]
    fn profiles_dir_is_injected_by_resolved_file_name() {
        assert!(is_querymt_agent(Path::new("/x/Contents/MacOS/qmtcode")));
        assert!(is_querymt_agent(Path::new(
            "/x/qmtcode-aarch64-apple-darwin"
        )));
        assert!(!is_querymt_agent(Path::new("/x/qmtcode-tools/other-agent")));
        assert!(!is_querymt_agent(Path::new("npx")));
    }

    #[test]
    fn start_failure_moves_agent_out_of_starting() {
        let mut process = ManagedAgentProcess::new("agent-1", "qmtcode --acp".to_string());
        process.state.state = AgentState::Starting;
        process.state.message = "Starting ACP stdio agent...".to_string();

        let entry = record_start_failure(&mut process, "boom");
        assert_eq!(process.state.state, AgentState::Failed);
        assert_eq!(process.state.last_error.as_deref(), Some("boom"));
        assert_ne!(process.state.message, "Starting ACP stdio agent...");
        assert_eq!(entry.message, "boom");
        assert_eq!(
            process.logs.back().map(|l| l.message.as_str()),
            Some("boom")
        );
    }

    #[test]
    fn truncate_for_log_respects_char_boundaries() {
        let value = "é".repeat(200);
        let truncated = truncate_for_log(&value);
        assert!(truncated.ends_with("..."));
        assert_eq!(truncate_for_log("short"), "short");
    }

    fn dummy_stdout_channel() -> Channel<String> {
        Channel::new(|_| Ok(()))
    }
}
