# Spec Delta

## Purpose

Lets QueryMT Desktop find, verify and install newer builds of itself on the user's chosen release channel, without ever downgrading the app or the bundled qmtcode that owns the session database.

## ADDED Requirements

### Requirement: Channel-specific update feed
The desktop SHALL check for updates only against the feed of the selected channel: stable uses the latest stable release feed, nightly uses the rolling nightly release feed. A feed MAY be reached through the query.mt statistics redirect for the same channel. The selected channel SHALL default to the channel the running build was published on.

#### Scenario: Stable build checks the stable feed
- **WHEN** a stable build with no saved channel preference checks for updates
- **THEN** it requests only the stable feed (directly or through the stable statistics redirect) and never sees nightly builds

#### Scenario: Nightly build checks the nightly feed
- **WHEN** a nightly build with no saved channel preference checks for updates
- **THEN** it requests only the nightly feed (directly or through the nightly statistics redirect)

### Requirement: User can switch update channel
The desktop SHALL let the user choose stable or nightly in Settings, persist the choice across restarts, and use it for all later checks.

#### Scenario: Switch persists
- **WHEN** the user selects the nightly channel and restarts the app
- **THEN** the nightly channel is still selected and the next check uses the nightly feed

### Requirement: Updates never downgrade the desktop
The desktop SHALL offer an update only when the feed's desktop version is strictly greater than the running version under semver precedence, regardless of channel.

#### Scenario: Older stable after nightly is not offered
- **WHEN** a user running `0.1.8-nightly.20261106143200` switches to stable and the stable feed offers `0.1.7`
- **THEN** no update is offered and the app reports that it is waiting for a stable release newer than the running version

#### Scenario: Newer stable after nightly is offered
- **WHEN** a user running `0.1.8-nightly.20261106143200` on the stable channel sees the stable feed offer `0.1.8`
- **THEN** the `0.1.8` update is offered

#### Scenario: Older stable on stable channel is not offered
- **WHEN** a user running `0.1.8` sees the stable feed offer `0.1.7`
- **THEN** no update is offered

### Requirement: Updates never downgrade the bundled qmtcode
The desktop SHALL refuse an update whose feed reports a bundled qmtcode version lower than the qmtcode version bundled with the running build, or whose feed omits the qmtcode version. A refused update SHALL be reported with its reason and SHALL NOT be downloaded.

#### Scenario: Stable bundling older qmtcode is refused
- **WHEN** a build bundling qmtcode `0.6.0-nightly.20261105111147` sees a newer desktop update that bundles qmtcode `0.5.2`
- **THEN** the update is not offered and the status explains that it would downgrade qmtcode

#### Scenario: Equal or newer qmtcode is accepted
- **WHEN** the feed's desktop version is newer and its qmtcode version is equal to or greater than the running build's
- **THEN** the update is offered

#### Scenario: Missing qmtcode version
- **WHEN** the feed entry has no qmtcode version
- **THEN** the update is not offered

### Requirement: Updates are signature-verified
The desktop SHALL install an update only after verifying the downloaded artifact against the public key embedded in the build. A verification failure SHALL abort the install, leave the current installation unchanged and be shown to the user.

#### Scenario: Tampered artifact
- **WHEN** a downloaded artifact does not match its signature
- **THEN** the install is aborted and the running version stays installed

### Requirement: Runtime-specific update target
On Linux, the desktop SHALL request the update artifact that matches its own runtime (Wry or CEF) and architecture, and SHALL never install an artifact of the other runtime.

#### Scenario: CEF AppImage stays CEF
- **WHEN** a CEF AppImage build on x86_64 checks for updates
- **THEN** it resolves only the `linux-x86_64-cef` entry of the feed

### Requirement: Install kind determines update behavior
The desktop SHALL self-install updates only for installs that can be replaced in place by the user: macOS app bundles, Windows NSIS installs, and Linux AppImages. For `.deb` installs and the CEF portable tarball, it SHALL only notify that an update is available and link to the release page.

#### Scenario: Deb install is notify-only
- **WHEN** a `.deb`-installed build finds an eligible update
- **THEN** it shows the new version with a link to the release and offers no install action

#### Scenario: AppImage self-installs
- **WHEN** an AppImage build finds an eligible update and the user accepts
- **THEN** the AppImage is replaced with the new version

### Requirement: Automatic and manual checks
The desktop SHALL check automatically shortly after start and then periodically while running, unless the user disabled automatic checks, and SHALL offer a manual "Check now" action at all times. The interval SHALL default to 6 hours.

#### Scenario: Automatic check after start
- **WHEN** the app starts with automatic checks enabled
- **THEN** it checks once shortly after start and again every interval while running

#### Scenario: Automatic checks disabled
- **WHEN** automatic checks are disabled
- **THEN** no check happens until the user selects "Check now"

### Requirement: Failed checks are quiet
A failed automatic check (offline, feed missing, invalid feed) SHALL NOT interrupt the user; it SHALL be logged and shown only as status in Settings. A failed manual check SHALL show the error.

#### Scenario: Nightly feed temporarily missing
- **WHEN** an automatic check gets HTTP 404 because the nightly release is being replaced
- **THEN** no dialog or toast is shown and the next scheduled check runs normally

### Requirement: User-controlled install and restart
The desktop SHALL NOT download or install an update without user confirmation. It SHALL show download progress, and SHALL let the user restart now or later. The user SHALL be able to skip a specific version, after which automatic checks do not prompt for that version.

#### Scenario: Skip a version
- **WHEN** the user skips version `0.1.9`
- **THEN** automatic checks do not prompt for `0.1.9` but do prompt for a later version, and "Check now" still shows `0.1.9`

### Requirement: Sidecar is stopped before install and restart
The desktop SHALL stop all managed qmtcode processes before the installer replaces files and before relaunching, so the new build starts with a fresh sidecar and no file is replaced while in use.

#### Scenario: Windows install
- **WHEN** an update is installed on Windows
- **THEN** all managed agent processes are stopped before the installer runs

#### Scenario: Restart after install
- **WHEN** the user chooses to restart after an install
- **THEN** managed agent processes are stopped, the app relaunches, and the new version starts its own sidecar

### Requirement: Updater is not controllable from the webview
The webview SHALL NOT be able to choose update endpoints, download URLs, public keys or version rules. It MAY only switch the statistics preference, which selects between endpoint lists fixed in the desktop build. Update checks and installs SHALL be exposed only through desktop commands that apply the channel and gating rules.

#### Scenario: No direct updater permission
- **WHEN** the frontend capability set is inspected
- **THEN** it grants no `updater:*` permission

### Requirement: Anonymous update statistics setting
The desktop SHALL offer a "Send anonymous update statistics" setting in Settings, separate from automatic checks, enabled by default and persisted across restarts. Settings SHALL describe what is sent. When disabled, the desktop SHALL NOT contact query.mt for checks or downloads.

#### Scenario: Setting described
- **WHEN** the user opens the Updates group in Settings
- **THEN** the statistics switch is shown, on by default, with a description of the data sent

### Requirement: Update requests through query.mt
When statistics are enabled, update checks SHALL go first to the query.mt check URL for the selected channel, carrying only the running version and the update target, and update downloads of GitHub release assets SHALL go through the query.mt update download URL. The desktop SHALL NOT send any install identifier.

#### Scenario: Statistics enabled by default
- **WHEN** a build with no saved statistics preference checks for updates on the stable channel
- **THEN** the first request goes to `https://query.mt/updates/desktop/stable/latest.json` with the running version and target as query parameters

#### Scenario: Statistics disabled
- **WHEN** the user turns statistics off and then checks for and installs an update
- **THEN** the feed and the artifact are requested only from GitHub, and no request goes to query.mt

#### Scenario: Download through query.mt
- **WHEN** statistics are enabled and the user installs an update whose feed URL is `https://github.com/querymt/querymt-desktop/releases/download/<tag>/<asset>`
- **THEN** the artifact is requested from `https://query.mt/download/desktop/update/<tag>/<asset>`

#### Scenario: Setting persists
- **WHEN** the user turns statistics off and restarts the app
- **THEN** statistics are still off

### Requirement: Statistics never block updates
A failure of the query.mt check or download redirect SHALL NOT prevent an update. A failed check request through query.mt SHALL fall back to the GitHub feed for the same channel within the same check, and a failed download through query.mt SHALL be retried once from the GitHub URL in the feed. Signature verification failures SHALL NOT be retried.

#### Scenario: Worker unavailable during check
- **WHEN** statistics are enabled and query.mt returns an error or is unreachable
- **THEN** the same check reads the GitHub feed and reports its result normally

#### Scenario: Worker unavailable during download
- **WHEN** statistics are enabled and the download through query.mt fails
- **THEN** the artifact is downloaded from the GitHub URL, verified and installed

#### Scenario: Tampered artifact through query.mt
- **WHEN** an artifact downloaded through query.mt fails signature verification
- **THEN** the install is aborted without a retry and the running version stays installed
