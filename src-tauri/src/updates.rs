//! Self-update: channel feeds, version/qmtcode gating, preferences, commands and scheduler.
//!
//! All update policy lives here. The webview only displays [`UpdateState`] and asks
//! for actions through the `updates_*` commands; it is granted no `updater:*`
//! permission, so it cannot pick endpoints, keys or version rules.
//!
//! The decision logic (`updater_target`, `detect_install_kind`, `evaluate`,
//! preferences, scheduling policy) is pure and unit tested; the Tauri glue below it
//! only wires those decisions to the updater plugin.

use crate::{sidecar::AcpAgentManager, BrowserEngine};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

type AppHandle = tauri::AppHandle<BrowserEngine>;

pub const STATE_EVENT: &str = "updates://state";
const PREFERENCES_FILE: &str = "updates.json";
const STABLE_FEED: &str =
    "https://github.com/querymt/querymt-desktop/releases/latest/download/latest.json";
const NIGHTLY_FEED: &str =
    "https://github.com/querymt/querymt-desktop/releases/download/nightly/latest.json";
const RELEASES_URL: &str = "https://github.com/querymt/querymt-desktop/releases";

/// First automatic check after start, then every [`CHECK_INTERVAL`].
pub const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Deadline for one feed request, so a hung server cannot leave a check stuck.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// Deadline for downloading one update package.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Channel this build was published on (`QMT_RELEASE_CHANNEL`, default `stable`).
const BUILD_CHANNEL: &str = env!("QMT_RELEASE_CHANNEL");
/// qmtcode version bundled with this build. `None` for development builds, which
/// skip the qmtcode gate; release builds cannot be compiled without it (build.rs).
const EMBEDDED_QMTCODE: Option<&str> = option_env!("QMTCODE_VERSION");

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Nightly,
}

impl UpdateChannel {
    /// Maps the build-time channel name to a channel; anything but `nightly` is stable.
    pub fn from_build(value: &str) -> Self {
        if value == "nightly" {
            Self::Nightly
        } else {
            Self::Stable
        }
    }

    /// The only feed a check on this channel may request.
    pub fn feed_url(self) -> &'static str {
        match self {
            Self::Stable => STABLE_FEED,
            Self::Nightly => NIGHTLY_FEED,
        }
    }
}

/// Link to the release page of `version`, shown for notify-only installs.
pub fn release_url(channel: UpdateChannel, version: &str) -> String {
    match channel {
        UpdateChannel::Stable => format!("{RELEASES_URL}/tag/v{version}"),
        UpdateChannel::Nightly => format!("{RELEASES_URL}/tag/nightly"),
    }
}

/// Feed platform key for this build: `darwin-<arch>`, `windows-<arch>` or
/// `linux-<arch>-wry|cef`. Linux keys carry the runtime so a CEF build never
/// installs a Wry artifact and vice versa.
pub fn updater_target(os: &str, arch: &str, cef_runtime: bool) -> Option<String> {
    let arch = match arch {
        "x86_64" | "aarch64" => arch,
        _ => return None,
    };
    match os {
        "macos" => Some(format!("darwin-{arch}")),
        "windows" => Some(format!("windows-{arch}")),
        "linux" => Some(format!(
            "linux-{arch}-{}",
            if cef_runtime { "cef" } else { "wry" }
        )),
        _ => None,
    }
}

/// The updater platform key for this build, if updates are supported.
fn current_target() -> Option<String> {
    updater_target(
        std::env::consts::OS,
        std::env::consts::ARCH,
        cfg!(all(feature = "cef", target_os = "linux")),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallKind {
    /// macOS `.app` bundle.
    MacApp,
    /// Windows NSIS install.
    Nsis,
    /// Linux AppImage.
    AppImage,
    /// Linux `.deb` (installed under `/usr` or `/opt/querymt-desktop`).
    Deb,
    /// Portable tarball, development builds, anything else.
    Portable,
}

impl InstallKind {
    /// Whether the app can replace itself in place. Other kinds only notify.
    pub fn self_installs(self) -> bool {
        matches!(self, Self::MacApp | Self::Nsis | Self::AppImage)
    }
}

pub struct InstallProbe<'a> {
    pub os: &'a str,
    pub exe: &'a Path,
    /// Whether the `APPIMAGE` environment variable is set.
    pub appimage: bool,
}

/// Classifies the running install from the probe.
pub fn detect_install_kind(probe: &InstallProbe<'_>) -> InstallKind {
    match probe.os {
        "macos" => {
            if probe.exe.to_string_lossy().contains(".app/Contents/MacOS/") {
                InstallKind::MacApp
            } else {
                InstallKind::Portable
            }
        }
        "windows" => InstallKind::Nsis,
        "linux" => {
            if probe.appimage {
                InstallKind::AppImage
            } else if probe.exe.starts_with("/usr") || probe.exe.starts_with("/opt/querymt-desktop")
            {
                InstallKind::Deb
            } else {
                InstallKind::Portable
            }
        }
        _ => InstallKind::Portable,
    }
}

/// Probes the running process and classifies its install kind.
fn current_install_kind() -> InstallKind {
    let exe = std::env::current_exe().unwrap_or_default();
    detect_install_kind(&InstallProbe {
        os: std::env::consts::OS,
        exe: &exe,
        appimage: std::env::var_os("APPIMAGE").is_some(),
    })
}

/// What a feed entry announces.
pub struct Offered<'a> {
    pub version: &'a str,
    pub qmtcode_version: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefusalReason {
    QmtcodeDowngrade,
    QmtcodeMissing,
    InvalidVersion,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Offer,
    /// The feed's desktop version is not strictly greater than the running one.
    NotNewer,
    Refused {
        reason: RefusalReason,
        message: String,
    },
}

/// The "never downgrade" gate.
///
/// 1. The desktop version must be strictly greater under semver precedence.
/// 2. When this build knows its bundled qmtcode version, the feed must report a
///    qmtcode version that is present, valid and not lower. Missing is refused.
///    Development builds (no embedded version) skip this part.
pub fn evaluate(running: &str, embedded_qmtcode: Option<&str>, offered: &Offered<'_>) -> Verdict {
    let invalid = |what: &str, value: &str| Verdict::Refused {
        reason: RefusalReason::InvalidVersion,
        message: format!("The update feed has an invalid {what} version `{value}`."),
    };

    let Ok(running) = Version::parse(running) else {
        return invalid("running", running);
    };
    let Ok(offered_version) = Version::parse(offered.version) else {
        return invalid("desktop", offered.version);
    };
    if offered_version <= running {
        return Verdict::NotNewer;
    }

    let Some(embedded) = embedded_qmtcode else {
        return Verdict::Offer;
    };
    let Ok(embedded) = Version::parse(embedded) else {
        return invalid("embedded qmtcode", embedded);
    };
    let Some(feed_qmtcode) = offered.qmtcode_version else {
        return Verdict::Refused {
            reason: RefusalReason::QmtcodeMissing,
            message: format!(
                "Version {} does not say which qmtcode it bundles, so it was not offered.",
                offered.version
            ),
        };
    };
    let Ok(feed_qmtcode_version) = Version::parse(feed_qmtcode) else {
        return invalid("qmtcode", feed_qmtcode);
    };
    if feed_qmtcode_version < embedded {
        return Verdict::Refused {
            reason: RefusalReason::QmtcodeDowngrade,
            message: format!(
                "Version {} bundles qmtcode {feed_qmtcode}, which would downgrade the qmtcode {embedded} you are running.",
                offered.version
            ),
        };
    }
    Verdict::Offer
}

/// Persisted user choices (`updates.json` in the app config dir).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePreferences {
    /// `None` until the user picks one: the channel of the running build applies.
    pub channel: Option<UpdateChannel>,
    pub auto_check: bool,
    pub skipped_version: Option<String>,
}

impl Default for UpdatePreferences {
    /// Stable channel preferences with automatic checks on.
    fn default() -> Self {
        Self {
            channel: None,
            auto_check: true,
            skipped_version: None,
        }
    }
}

impl UpdatePreferences {
    /// The saved channel, or the build channel when none was chosen.
    pub fn effective_channel(&self, build: UpdateChannel) -> UpdateChannel {
        self.channel.unwrap_or(build)
    }
}

/// Missing or unreadable preferences fall back to the defaults: a broken file
/// must never stop the app from checking for updates.
pub fn load_preferences(path: &Path) -> UpdatePreferences {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|error| {
            eprintln!("Ignoring invalid {}: {error}", path.display());
            UpdatePreferences::default()
        }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => UpdatePreferences::default(),
        Err(error) => {
            eprintln!("Failed to read {}: {error}", path.display());
            UpdatePreferences::default()
        }
    }
}

/// Writes the preferences file, creating its directory.
pub fn save_preferences(path: &Path, preferences: &UpdatePreferences) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(preferences).map_err(io::Error::other)?;
    // Write beside the target and rename so a crash never leaves half a file.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body)?;
    fs::rename(&tmp, path)
}

/// Whether the scheduler should run a check now.
pub fn scheduled_check_due(preferences: &UpdatePreferences) -> bool {
    preferences.auto_check
}

/// Whether an available update must not interrupt the user. Automatic checks stay
/// quiet about a skipped version; "Check now" always shows it.
pub fn is_suppressed(manual: bool, skipped: Option<&str>, offered: &str) -> bool {
    !manual && skipped == Some(offered)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureKind {
    /// Could not reach the feed.
    Network,
    /// The feed does not exist (HTTP error, e.g. 404 while the nightly is replaced).
    FeedMissing,
    /// The feed is not valid, or has no entry for this platform.
    InvalidFeed,
    Other,
}

/// Maps an updater error to a user-facing failure kind.
pub fn categorize_failure(error: &tauri_plugin_updater::Error) -> FailureKind {
    use tauri_plugin_updater::Error as E;
    match error {
        E::Reqwest(_) | E::Network(_) => FailureKind::Network,
        E::ReleaseNotFound => FailureKind::FeedMissing,
        E::Serialization(_)
        | E::Semver(_)
        | E::TargetNotFound(_)
        | E::TargetsNotFound(_)
        | E::InsecureTransportProtocol => FailureKind::InvalidFeed,
        _ => FailureKind::Other,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureHandling {
    /// Log and record the status only; no dialog, no toast.
    LogOnly,
    /// Return the error so the UI shows it.
    Show,
}

/// A failed automatic check (offline, 404, invalid feed) never interrupts the user;
/// a failed manual check is shown.
pub fn failure_handling(manual: bool) -> FailureHandling {
    if manual {
        FailureHandling::Show
    } else {
        FailureHandling::LogOnly
    }
}

/// Builds the message shown for a failed check.
fn failure_message(kind: FailureKind, detail: &str) -> String {
    match kind {
        FailureKind::Network => format!("Could not reach the update server: {detail}"),
        FailureKind::FeedMissing => {
            "No update feed is published for this channel right now.".into()
        }
        FailureKind::InvalidFeed => format!("The update feed is not usable: {detail}"),
        FailureKind::Other => detail.to_string(),
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateState {
    Idle,
    Checking,
    UpToDate,
    /// The feed offers a version that is not newer than the running one.
    Waiting {
        running: String,
        offered: String,
    },
    Available {
        version: String,
        notes: Option<String>,
        date: Option<String>,
        qmtcode_version: Option<String>,
        can_install: bool,
        release_url: String,
        /// Skipped by the user: automatic checks do not prompt for it.
        skipped: bool,
    },
    Refused {
        version: String,
        reason: RefusalReason,
        message: String,
    },
    Installing {
        version: String,
    },
    Installed {
        version: String,
    },
    Error {
        message: String,
        failure: FailureKind,
        manual: bool,
    },
}

/// A check that found nothing newer: equal means up to date, anything else means
/// the feed is behind the running build (stable feed older than a nightly).
pub fn classify_not_newer(running: &str, offered: Option<&str>) -> UpdateState {
    match offered {
        Some(offered) if offered != running => UpdateState::Waiting {
            running: running.to_string(),
            offered: offered.to_string(),
        },
        _ => UpdateState::UpToDate,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum InstallProgress {
    Started { content_length: Option<u64> },
    Progress { chunk_length: usize },
    Finished,
    Installed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatesStatus {
    pub channel: UpdateChannel,
    pub build_channel: UpdateChannel,
    pub current_version: String,
    pub qmtcode_version: Option<String>,
    pub install_kind: InstallKind,
    pub auto_check: bool,
    pub skipped_version: Option<String>,
    /// Unix seconds of the last finished check.
    pub last_check: Option<u64>,
    pub state: UpdateState,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesPatch {
    pub channel: Option<UpdateChannel>,
    pub auto_check: Option<bool>,
    /// `Some("")` clears the skipped version.
    pub skipped_version: Option<String>,
}

pub struct UpdateManager {
    preferences_path: PathBuf,
    preferences: Mutex<UpdatePreferences>,
    state: Mutex<UpdateState>,
    pending: Mutex<Option<Update>>,
    last_check: Mutex<Option<u64>>,
    checking: AtomicBool,
    /// Bumped when the selected channel changes; a check only commits its result if the
    /// generation it started with is still current.
    generation: AtomicU64,
}

/// Whether an install owns the update state.
fn is_installing(state: &UpdateState) -> bool {
    matches!(
        state,
        UpdateState::Installing { .. } | UpdateState::Installed { .. }
    )
}

impl UpdateManager {
    /// Loads the preferences and starts idle.
    pub fn load(preferences_path: PathBuf) -> Self {
        let preferences = load_preferences(&preferences_path);
        Self {
            preferences_path,
            preferences: Mutex::new(preferences),
            state: Mutex::new(UpdateState::Idle),
            pending: Mutex::new(None),
            last_check: Mutex::new(None),
            checking: AtomicBool::new(false),
            generation: AtomicU64::new(0),
        }
    }

    /// A snapshot of the preferences.
    fn preferences(&self) -> UpdatePreferences {
        self.preferences
            .lock()
            .expect("update preferences lock")
            .clone()
    }

    /// A snapshot of the update state.
    fn state(&self) -> UpdateState {
        self.state.lock().expect("update state lock").clone()
    }

    /// Stores a state and notifies the webview.
    fn set_state(&self, app: &AppHandle, state: UpdateState) -> UpdateState {
        *self.state.lock().expect("update state lock") = state.clone();
        let _ = app.emit(STATE_EVENT, &state);
        state
    }

    /// Moves to `Checking` unless an install owns the state. Returns whether it did.
    fn begin_check(&self, app: &AppHandle) -> bool {
        {
            let mut state = self.state.lock().expect("update state lock");
            if is_installing(&state) {
                return false;
            }
            *state = UpdateState::Checking;
        }
        let _ = app.emit(STATE_EVENT, &UpdateState::Checking);
        true
    }

    /// Records a check outcome and its pending update atomically. Returns `None`, and
    /// changes nothing, when the channel changed since the check started or an install
    /// has taken over the state.
    fn commit_check(
        &self,
        app: &AppHandle,
        generation: u64,
        state: UpdateState,
        pending: Option<Update>,
    ) -> Option<UpdateState> {
        {
            let mut current = self.state.lock().expect("update state lock");
            if self.generation.load(Ordering::SeqCst) != generation || is_installing(&current) {
                return None;
            }
            *self.pending.lock().expect("pending update lock") = pending;
            *current = state.clone();
        }
        let _ = app.emit(STATE_EVENT, &state);
        Some(state)
    }

    /// Invalidates running checks and any pending update after a channel switch,
    /// unless an install is already in progress.
    fn reset_for_channel_change(&self, app: &AppHandle) {
        let reset = {
            let mut current = self.state.lock().expect("update state lock");
            self.generation.fetch_add(1, Ordering::SeqCst);
            if is_installing(&current) {
                false
            } else {
                *self.pending.lock().expect("pending update lock") = None;
                *current = UpdateState::Idle;
                true
            }
        };
        if reset {
            let _ = app.emit(STATE_EVENT, &UpdateState::Idle);
        }
    }

    /// Validates the state, takes the pending update and marks the install as started,
    /// all under the state lock, so concurrent installs cannot claim the same update.
    fn claim_install(&self, app: &AppHandle) -> Result<(Update, String), String> {
        const NONE: &str = "There is no update to install.";
        let (update, version) = {
            let mut state = self.state.lock().expect("update state lock");
            let UpdateState::Available {
                version,
                can_install: true,
                ..
            } = &*state
            else {
                return Err(NONE.into());
            };
            let version = version.clone();
            let Some(update) = self.pending.lock().expect("pending update lock").take() else {
                return Err(NONE.into());
            };
            *state = UpdateState::Installing {
                version: version.clone(),
            };
            (update, version)
        };
        let _ = app.emit(
            STATE_EVENT,
            &UpdateState::Installing {
                version: version.clone(),
            },
        );
        Ok((update, version))
    }

    /// The full status shown in Settings.
    fn status(&self, app: &AppHandle) -> UpdatesStatus {
        let preferences = self.preferences();
        UpdatesStatus {
            channel: preferences.effective_channel(UpdateChannel::from_build(BUILD_CHANNEL)),
            build_channel: UpdateChannel::from_build(BUILD_CHANNEL),
            current_version: app.package_info().version.to_string(),
            qmtcode_version: EMBEDDED_QMTCODE.map(str::to_string),
            install_kind: current_install_kind(),
            auto_check: preferences.auto_check,
            skipped_version: preferences.skipped_version,
            last_check: *self.last_check.lock().expect("update last check lock"),
            state: self.state(),
        }
    }
}

/// Seconds since the Unix epoch.
fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

/// Stops the managed agents and refuses new launches until [`resume_sidecars`].
fn stop_sidecars(app: &AppHandle) {
    app.state::<AcpAgentManager>().begin_maintenance();
}

/// Allows agent launches again after an update attempt that did not replace the app.
fn resume_sidecars(app: &AppHandle) {
    app.state::<AcpAgentManager>().end_maintenance();
}

/// Runs one check against the selected channel's feed and records the outcome.
///
/// Returns the new state. A failed *manual* check returns the error so the UI can
/// show it; a failed *automatic* check is only logged and recorded as status.
pub async fn run_check(app: &AppHandle, manual: bool) -> Result<UpdateState, String> {
    let manager = app.state::<UpdateManager>();
    if manager.checking.swap(true, Ordering::SeqCst) {
        return Ok(manager.state());
    }
    if !manager.begin_check(app) {
        manager.checking.store(false, Ordering::SeqCst);
        return Ok(manager.state());
    }
    let result = check_inner(app, &manager, manual).await;
    *manager.last_check.lock().expect("update last check lock") = Some(now_seconds());
    manager.checking.store(false, Ordering::SeqCst);
    result
}

/// One check against the selected channel; commits its result only if the channel is unchanged.
async fn check_inner(
    app: &AppHandle,
    manager: &UpdateManager,
    manual: bool,
) -> Result<UpdateState, String> {
    // Read before the preferences: a channel switch saves them before bumping the
    // generation, so a stale generation is the only way to see stale preferences.
    let generation = manager.generation.load(Ordering::SeqCst);
    let preferences = manager.preferences();
    let channel = preferences.effective_channel(UpdateChannel::from_build(BUILD_CHANNEL));

    // Commits the outcome unless the channel changed or an install took over meanwhile.
    let finish = |state: UpdateState, pending: Option<Update>| -> UpdateState {
        manager
            .commit_check(app, generation, state, pending)
            .unwrap_or_else(|| manager.state())
    };

    let fail = |kind: FailureKind, detail: String| -> Result<UpdateState, String> {
        let message = failure_message(kind, &detail);
        eprintln!("Update check failed ({kind:?}): {detail}");
        let committed = manager.commit_check(
            app,
            generation,
            UpdateState::Error {
                message: message.clone(),
                failure: kind,
                manual,
            },
            None,
        );
        match (committed, failure_handling(manual)) {
            (None, _) => Ok(manager.state()),
            (Some(_), FailureHandling::Show) => Err(message),
            (Some(_), FailureHandling::LogOnly) => Ok(manager.state()),
        }
    };

    let Some(target) = current_target() else {
        return fail(
            FailureKind::Other,
            "updates are not available on this platform".into(),
        );
    };

    // The feed's version is recorded by the comparator so a feed that is *behind*
    // the running build (stable older than a nightly) can be reported as such.
    let observed = Arc::new(Mutex::new(None::<String>));
    let record = observed.clone();
    let hook_app = app.clone();
    let endpoint = tauri::Url::parse(channel.feed_url()).map_err(|e| e.to_string())?;
    let updater = match app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .timeout(CHECK_TIMEOUT)
        .target(target)
        .version_comparator(move |current, release| {
            *record.lock().expect("observed version lock") = Some(release.version.to_string());
            release.version > current
        })
        // Windows exits during the install: stop the sidecar first.
        .on_before_exit(move || {
            stop_sidecars(&hook_app);
            hook_app.cleanup_before_exit();
        })
        .build()
    {
        Ok(updater) => updater,
        Err(error) => return fail(categorize_failure(&error), error.to_string()),
    };

    let running = app.package_info().version.to_string();
    let checked = updater.check().await;
    let update = match checked {
        Ok(update) => update,
        Err(error) => return fail(categorize_failure(&error), error.to_string()),
    };

    let Some(update) = update else {
        let offered = observed.lock().expect("observed version lock").clone();
        return Ok(finish(
            classify_not_newer(&running, offered.as_deref()),
            None,
        ));
    };

    let feed_qmtcode = update
        .raw_json
        .get("qmtcode_version")
        .and_then(|value| value.as_str());
    let verdict = evaluate(
        &update.current_version,
        EMBEDDED_QMTCODE,
        &Offered {
            version: &update.version,
            qmtcode_version: feed_qmtcode,
        },
    );
    match verdict {
        Verdict::Offer => {
            let kind = current_install_kind();
            let skipped = is_suppressed(
                manual,
                preferences.skipped_version.as_deref(),
                &update.version,
            );
            let state = UpdateState::Available {
                version: update.version.clone(),
                notes: update.body.clone().filter(|n| !n.is_empty()),
                date: update.date.map(|d| d.to_string()),
                qmtcode_version: feed_qmtcode.map(str::to_string),
                can_install: kind.self_installs(),
                release_url: release_url(channel, &update.version),
                skipped,
            };
            Ok(finish(state, Some(update)))
        }
        Verdict::NotNewer => Ok(finish(
            classify_not_newer(&running, Some(&update.version)),
            None,
        )),
        Verdict::Refused { reason, message } => Ok(finish(
            UpdateState::Refused {
                version: update.version.clone(),
                reason,
                message,
            },
            None,
        )),
    }
}

/// Starts the background scheduler: first check after [`FIRST_CHECK_DELAY`], then
/// every [`CHECK_INTERVAL`] while automatic checks are on. Automatic failures are
/// logged and recorded as status only.
pub fn spawn_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            let due = scheduled_check_due(&app.state::<UpdateManager>().preferences());
            if due {
                let _ = run_check(&app, false).await;
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn updates_status(app: AppHandle, manager: State<'_, UpdateManager>) -> UpdatesStatus {
    manager.status(&app)
}

#[tauri::command]
pub fn updates_set_preferences(
    app: AppHandle,
    manager: State<'_, UpdateManager>,
    patch: PreferencesPatch,
) -> Result<UpdatesStatus, String> {
    let changed_channel = {
        let mut preferences = manager.preferences.lock().expect("update preferences lock");
        let build = UpdateChannel::from_build(BUILD_CHANNEL);
        let before = preferences.effective_channel(build);
        if let Some(channel) = patch.channel {
            preferences.channel = Some(channel);
        }
        if let Some(auto_check) = patch.auto_check {
            preferences.auto_check = auto_check;
        }
        if let Some(skipped) = patch.skipped_version {
            preferences.skipped_version = (!skipped.is_empty()).then_some(skipped);
        }
        save_preferences(&manager.preferences_path, &preferences)
            .map_err(|error| format!("Failed to save update preferences: {error}"))?;
        preferences.effective_channel(build) != before
    };

    // A result from the old channel's feed must not be installed after switching, and a
    // check still running for it must not publish its result.
    if changed_channel {
        manager.reset_for_channel_change(&app);
    }
    Ok(manager.status(&app))
}

#[tauri::command]
pub async fn updates_check(
    app: AppHandle,
    manager: State<'_, UpdateManager>,
    manual: bool,
) -> Result<UpdatesStatus, String> {
    run_check(&app, manual).await?;
    Ok(manager.status(&app))
}

/// Downloads, verifies and installs the update found by the last check. Nothing is
/// downloaded without this explicit call.
#[tauri::command]
pub async fn updates_install(
    app: AppHandle,
    manager: State<'_, UpdateManager>,
    on_event: Channel<InstallProgress>,
) -> Result<(), String> {
    let (mut update, version) = manager.claim_install(&app)?;
    update.timeout = Some(DOWNLOAD_TIMEOUT);

    let fail = |message: String| {
        *manager.pending.lock().expect("pending update lock") = None;
        manager.set_state(
            &app,
            UpdateState::Error {
                message: message.clone(),
                failure: FailureKind::Other,
                manual: true,
            },
        );
        Err(message)
    };

    // `download` verifies the signature before returning; a failure aborts here and
    // the installed version is untouched.
    let mut started = false;
    let progress = on_event.clone();
    let finished = on_event.clone();
    let bytes = match update
        .download(
            move |chunk, total| {
                if !started {
                    started = true;
                    let _ = progress.send(InstallProgress::Started {
                        content_length: total,
                    });
                }
                let _ = progress.send(InstallProgress::Progress {
                    chunk_length: chunk,
                });
            },
            move || {
                let _ = finished.send(InstallProgress::Finished);
            },
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(error) => return fail(format!("Update download failed: {error}")),
    };

    // No file may be replaced while a sidecar runs or can start: agent launches stay
    // refused from here until the install has finished.
    stop_sidecars(&app);
    let installed = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result.map_err(|error| format!("Update install failed: {error}")));
    // The guard covers only the file replacement; agents may launch again once it is done
    // (a user who postpones the restart keeps a working app).
    resume_sidecars(&app);
    if let Err(message) = installed {
        return fail(message);
    }

    *manager.pending.lock().expect("pending update lock") = None;
    manager.set_state(&app, UpdateState::Installed { version });
    let _ = on_event.send(InstallProgress::Installed);
    Ok(())
}

/// Stops the managed agents and relaunches into the installed version.
#[tauri::command]
pub fn updates_restart(app: AppHandle) -> Result<(), String> {
    stop_sidecars(&app);
    app.restart()
}

/// Builds the manager from the app config dir; called once from `setup`.
pub fn manager_for(app: &AppHandle) -> UpdateManager {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("com.querymt.desktop"));
    UpdateManager::load(dir.join(PREFERENCES_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offered<'a>(version: &'a str, qmtcode: Option<&'a str>) -> Offered<'a> {
        Offered {
            version,
            qmtcode_version: qmtcode,
        }
    }

    fn refusal(verdict: Verdict) -> RefusalReason {
        match verdict {
            Verdict::Refused { reason, .. } => reason,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    // --- channel -> endpoint ------------------------------------------------

    #[test]
    fn channels_use_only_their_own_feed() {
        assert_eq!(
            UpdateChannel::Stable.feed_url(),
            "https://github.com/querymt/querymt-desktop/releases/latest/download/latest.json"
        );
        assert_eq!(
            UpdateChannel::Nightly.feed_url(),
            "https://github.com/querymt/querymt-desktop/releases/download/nightly/latest.json"
        );
        assert_eq!(UpdateChannel::from_build("nightly"), UpdateChannel::Nightly);
        assert_eq!(UpdateChannel::from_build("stable"), UpdateChannel::Stable);
        assert_eq!(UpdateChannel::from_build(""), UpdateChannel::Stable);
    }

    #[test]
    fn release_links() {
        assert_eq!(
            release_url(UpdateChannel::Stable, "0.1.11"),
            "https://github.com/querymt/querymt-desktop/releases/tag/v0.1.11"
        );
        assert_eq!(
            release_url(UpdateChannel::Nightly, "0.1.11-nightly.1"),
            "https://github.com/querymt/querymt-desktop/releases/tag/nightly"
        );
    }

    // --- updater target -----------------------------------------------------

    #[test]
    fn updater_targets() {
        assert_eq!(
            updater_target("macos", "aarch64", false).as_deref(),
            Some("darwin-aarch64")
        );
        assert_eq!(
            updater_target("macos", "x86_64", false).as_deref(),
            Some("darwin-x86_64")
        );
        assert_eq!(
            updater_target("windows", "x86_64", false).as_deref(),
            Some("windows-x86_64")
        );
        assert_eq!(
            updater_target("linux", "x86_64", false).as_deref(),
            Some("linux-x86_64-wry")
        );
        assert_eq!(
            updater_target("linux", "aarch64", false).as_deref(),
            Some("linux-aarch64-wry")
        );
        assert_eq!(
            updater_target("linux", "x86_64", true).as_deref(),
            Some("linux-x86_64-cef")
        );
        assert_eq!(
            updater_target("linux", "aarch64", true).as_deref(),
            Some("linux-aarch64-cef")
        );
        assert_eq!(updater_target("freebsd", "x86_64", false), None);
        assert_eq!(updater_target("linux", "x86", false), None);
    }

    #[test]
    fn cef_build_never_resolves_the_wry_key() {
        let cef = updater_target("linux", "x86_64", true).unwrap();
        assert!(cef.ends_with("-cef") && !cef.ends_with("-wry"));
    }

    // --- install kind -------------------------------------------------------

    fn kind(os: &str, exe: &str, appimage: bool) -> InstallKind {
        detect_install_kind(&InstallProbe {
            os,
            exe: Path::new(exe),
            appimage,
        })
    }

    #[test]
    fn install_kinds() {
        assert_eq!(
            kind(
                "macos",
                "/Applications/QueryMT Desktop.app/Contents/MacOS/querymt-desktop",
                false
            ),
            InstallKind::MacApp
        );
        assert_eq!(
            kind("macos", "/Users/me/src/target/debug/querymt-desktop", false),
            InstallKind::Portable
        );
        assert_eq!(
            kind(
                "windows",
                "C:\\Users\\me\\AppData\\Local\\QueryMT\\querymt-desktop.exe",
                false
            ),
            InstallKind::Nsis
        );
        assert_eq!(
            kind("linux", "/tmp/.mount_abc/usr/bin/querymt-desktop", true),
            InstallKind::AppImage
        );
        assert_eq!(
            kind("linux", "/usr/bin/querymt-desktop", false),
            InstallKind::Deb
        );
        assert_eq!(
            kind("linux", "/opt/querymt-desktop/querymt-desktop", false),
            InstallKind::Deb
        );
        assert_eq!(
            kind(
                "linux",
                "/home/me/QueryMT-Desktop-cef-v1-linux-x86_64/querymt-desktop",
                false
            ),
            InstallKind::Portable
        );
        // `/optional` is not `/opt/querymt-desktop`.
        assert_eq!(
            kind("linux", "/opt/querymt-desktop-old/x", false),
            InstallKind::Portable
        );
    }

    #[test]
    fn only_replaceable_installs_self_install() {
        for (kind, expected) in [
            (InstallKind::MacApp, true),
            (InstallKind::Nsis, true),
            (InstallKind::AppImage, true),
            (InstallKind::Deb, false),
            (InstallKind::Portable, false),
        ] {
            assert_eq!(kind.self_installs(), expected, "{kind:?}");
        }
    }

    // --- the gate: desktop never downgrades ---------------------------------

    #[test]
    fn older_stable_after_nightly_is_not_offered() {
        let v = evaluate(
            "0.1.8-nightly.20261106143200",
            Some("0.6.0"),
            &offered("0.1.7", Some("0.6.0")),
        );
        assert_eq!(v, Verdict::NotNewer);
    }

    #[test]
    fn newer_stable_after_nightly_is_offered() {
        let v = evaluate(
            "0.1.8-nightly.20261106143200",
            Some("0.6.0"),
            &offered("0.1.8", Some("0.6.0")),
        );
        assert_eq!(v, Verdict::Offer);
    }

    #[test]
    fn older_stable_on_stable_is_not_offered() {
        assert_eq!(
            evaluate("0.1.8", Some("0.6.0"), &offered("0.1.7", Some("0.6.0"))),
            Verdict::NotNewer
        );
    }

    #[test]
    fn same_version_is_not_offered() {
        assert_eq!(
            evaluate("0.1.8", None, &offered("0.1.8", None)),
            Verdict::NotNewer
        );
        let n = "0.1.8-nightly.20261106143200";
        assert_eq!(evaluate(n, None, &offered(n, None)), Verdict::NotNewer);
    }

    #[test]
    fn later_nightly_is_offered_over_earlier() {
        let v = evaluate(
            "0.1.8-nightly.20261106143200",
            None,
            &offered("0.1.8-nightly.20261106143201", None),
        );
        assert_eq!(v, Verdict::Offer);
        // Numeric, not lexical: a longer timestamp identifier is larger.
        let v = evaluate(
            "0.1.8-nightly.99999999999999",
            None,
            &offered("0.1.8-nightly.100000000000000", None),
        );
        assert_eq!(v, Verdict::Offer);
    }

    #[test]
    fn nightly_sorts_between_stables() {
        assert_eq!(
            evaluate(
                "0.1.7",
                None,
                &offered("0.1.8-nightly.20261106143200", None)
            ),
            Verdict::Offer
        );
        assert_eq!(
            evaluate(
                "0.1.8-nightly.20261106143200",
                None,
                &offered("0.1.8", None)
            ),
            Verdict::Offer
        );
        assert_eq!(
            evaluate(
                "0.1.8",
                None,
                &offered("0.1.8-nightly.20261106143200", None)
            ),
            Verdict::NotNewer
        );
    }

    // --- the gate: qmtcode never downgrades ---------------------------------

    #[test]
    fn stable_bundling_older_qmtcode_is_refused() {
        let v = evaluate(
            "0.1.8-nightly.1",
            Some("0.6.0-nightly.20261105111147"),
            &offered("0.1.9", Some("0.5.2")),
        );
        match v {
            Verdict::Refused { reason, message } => {
                assert_eq!(reason, RefusalReason::QmtcodeDowngrade);
                assert!(
                    message.contains("0.5.2") && message.contains("0.6.0-nightly.20261105111147")
                );
            }
            other => panic!("expected refusal, got {other:?}"),
        }
    }

    #[test]
    fn equal_or_newer_qmtcode_is_accepted() {
        assert_eq!(
            evaluate("0.1.8", Some("0.6.0"), &offered("0.1.9", Some("0.6.0"))),
            Verdict::Offer
        );
        assert_eq!(
            evaluate("0.1.8", Some("0.6.0"), &offered("0.1.9", Some("0.6.1"))),
            Verdict::Offer
        );
        assert_eq!(
            evaluate(
                "0.1.8",
                Some("0.6.0-nightly.1"),
                &offered("0.1.9", Some("0.6.0"))
            ),
            Verdict::Offer
        );
        assert_eq!(
            evaluate(
                "0.1.8",
                Some("0.6.0-nightly.1"),
                &offered("0.1.9", Some("0.6.0-nightly.2"))
            ),
            Verdict::Offer
        );
    }

    #[test]
    fn missing_qmtcode_version_is_refused() {
        let v = evaluate("0.1.8", Some("0.6.0"), &offered("0.1.9", None));
        assert_eq!(refusal(v), RefusalReason::QmtcodeMissing);
    }

    #[test]
    fn invalid_versions_are_refused() {
        assert_eq!(
            refusal(evaluate(
                "0.1.8",
                Some("0.6.0"),
                &offered("0.1.9", Some("nightly-abc"))
            )),
            RefusalReason::InvalidVersion
        );
        assert_eq!(
            refusal(evaluate(
                "0.1.8",
                Some("0.6.0"),
                &offered("nightly", Some("0.6.0"))
            )),
            RefusalReason::InvalidVersion
        );
        assert_eq!(
            refusal(evaluate(
                "0.1.8",
                Some("junk"),
                &offered("0.1.9", Some("0.6.0"))
            )),
            RefusalReason::InvalidVersion
        );
    }

    #[test]
    fn qmtcode_is_not_checked_when_the_desktop_is_not_newer() {
        // A feed that is behind is reported as such, not as a qmtcode refusal.
        assert_eq!(
            evaluate("0.1.8", Some("0.6.0"), &offered("0.1.7", Some("0.5.2"))),
            Verdict::NotNewer
        );
    }

    #[test]
    fn development_builds_skip_the_qmtcode_gate() {
        assert_eq!(
            evaluate("0.1.8", None, &offered("0.1.9", None)),
            Verdict::Offer
        );
    }

    // --- not-newer classification -------------------------------------------

    #[test]
    fn waiting_for_a_newer_stable() {
        assert_eq!(
            classify_not_newer("0.1.8-nightly.20261106143200", Some("0.1.7")),
            UpdateState::Waiting {
                running: "0.1.8-nightly.20261106143200".into(),
                offered: "0.1.7".into()
            }
        );
        assert_eq!(
            classify_not_newer("0.1.8", Some("0.1.8")),
            UpdateState::UpToDate
        );
        assert_eq!(classify_not_newer("0.1.8", None), UpdateState::UpToDate);
    }

    // --- preferences --------------------------------------------------------

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("qmt-updates-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join(PREFERENCES_FILE)
    }

    #[test]
    fn preferences_default_to_the_build_channel_with_auto_check_on() {
        let prefs = load_preferences(&temp_path("missing"));
        assert_eq!(prefs, UpdatePreferences::default());
        assert!(prefs.auto_check);
        assert_eq!(prefs.skipped_version, None);
        assert_eq!(
            prefs.effective_channel(UpdateChannel::Nightly),
            UpdateChannel::Nightly
        );
        assert_eq!(
            prefs.effective_channel(UpdateChannel::Stable),
            UpdateChannel::Stable
        );
    }

    #[test]
    fn preferences_round_trip() {
        let path = temp_path("round-trip");
        let prefs = UpdatePreferences {
            channel: Some(UpdateChannel::Nightly),
            auto_check: false,
            skipped_version: Some("0.1.9".into()),
        };
        save_preferences(&path, &prefs).unwrap();
        assert_eq!(load_preferences(&path), prefs);
        // The saved choice wins over the build channel.
        assert_eq!(
            prefs.effective_channel(UpdateChannel::Stable),
            UpdateChannel::Nightly
        );
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn preferences_file_uses_camel_case_and_tolerates_missing_fields() {
        let path = temp_path("camel");
        save_preferences(
            &path,
            &UpdatePreferences {
                skipped_version: Some("1.0.0".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(
            raw.contains("autoCheck") && raw.contains("skippedVersion"),
            "{raw}"
        );

        fs::write(&path, r#"{"channel":"nightly"}"#).unwrap();
        let prefs = load_preferences(&path);
        assert_eq!(prefs.channel, Some(UpdateChannel::Nightly));
        assert!(prefs.auto_check);
    }

    #[test]
    fn corrupt_preferences_fall_back_to_defaults() {
        let path = temp_path("corrupt");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(load_preferences(&path), UpdatePreferences::default());
        fs::write(&path, r#"{"channel":"beta"}"#).unwrap();
        assert_eq!(load_preferences(&path), UpdatePreferences::default());
    }

    // --- scheduling policy --------------------------------------------------

    #[test]
    fn scheduler_timing_defaults() {
        assert_eq!(FIRST_CHECK_DELAY, Duration::from_secs(30));
        assert_eq!(CHECK_INTERVAL, Duration::from_secs(6 * 3600));
    }

    #[test]
    fn automatic_checks_follow_the_preference() {
        let mut prefs = UpdatePreferences::default();
        assert!(scheduled_check_due(&prefs));
        prefs.auto_check = false;
        assert!(!scheduled_check_due(&prefs));
    }

    #[test]
    fn skipped_version_only_silences_automatic_checks() {
        assert!(is_suppressed(false, Some("0.1.9"), "0.1.9"));
        assert!(
            !is_suppressed(true, Some("0.1.9"), "0.1.9"),
            "Check now still shows it"
        );
        assert!(
            !is_suppressed(false, Some("0.1.9"), "0.1.10"),
            "a later version prompts"
        );
        assert!(!is_suppressed(false, None, "0.1.9"));
    }

    #[test]
    fn automatic_failures_are_quiet_and_manual_failures_are_shown() {
        assert_eq!(failure_handling(false), FailureHandling::LogOnly);
        assert_eq!(failure_handling(true), FailureHandling::Show);
    }

    #[test]
    fn failures_are_categorised() {
        use tauri_plugin_updater::Error as E;
        // HTTP 404 (nightly being replaced) surfaces as ReleaseNotFound.
        assert_eq!(
            categorize_failure(&E::ReleaseNotFound),
            FailureKind::FeedMissing
        );
        assert_eq!(
            categorize_failure(&E::Network("down".into())),
            FailureKind::Network
        );
        assert_eq!(
            categorize_failure(&E::TargetNotFound("linux-x86_64-cef".into())),
            FailureKind::InvalidFeed
        );
        assert_eq!(
            categorize_failure(&E::TargetsNotFound(vec![])),
            FailureKind::InvalidFeed
        );
        let bad_json = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
        assert_eq!(
            categorize_failure(&E::Serialization(bad_json)),
            FailureKind::InvalidFeed
        );
        assert_eq!(categorize_failure(&E::EmptyEndpoints), FailureKind::Other);
        assert!(failure_message(FailureKind::FeedMissing, "x").contains("No update feed"));
    }

    // --- serialized shapes the frontend relies on ---------------------------

    #[test]
    fn state_serializes_with_a_kind_tag_and_camel_case_fields() {
        let json = serde_json::to_value(UpdateState::Available {
            version: "0.1.9".into(),
            notes: None,
            date: None,
            qmtcode_version: Some("0.6.0".into()),
            can_install: false,
            release_url: "https://example.test".into(),
            skipped: false,
        })
        .unwrap();
        assert_eq!(json["kind"], "available");
        assert_eq!(json["canInstall"], false);
        assert_eq!(json["releaseUrl"], "https://example.test");
        assert_eq!(json["qmtcodeVersion"], "0.6.0");

        let json = serde_json::to_value(UpdateState::Refused {
            version: "0.1.9".into(),
            reason: RefusalReason::QmtcodeDowngrade,
            message: "m".into(),
        })
        .unwrap();
        assert_eq!(json["kind"], "refused");
        assert_eq!(json["reason"], "qmtcodeDowngrade");

        let json = serde_json::to_value(InstallProgress::Started {
            content_length: Some(5),
        })
        .unwrap();
        assert_eq!(json["event"], "started");
        assert_eq!(json["contentLength"], 5);
    }
}
