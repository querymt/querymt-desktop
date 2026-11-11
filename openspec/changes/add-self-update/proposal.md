# Proposal

## Why

QueryMT Desktop has no way to update itself. Users must find, download and reinstall each stable or nightly build by hand. The desktop ships in two channels (stable `vX.Y.Z` tags and a rolling `nightly` prerelease), and both bundle a `qmtcode` sidecar that owns `sessions.db`. A naive updater, or a careless channel switch, could install a `qmtcode` with an older schema over a database that a newer one already migrated.

The release pipelines can't support safe updates yet:
- Desktop nightlies are versioned `<current>-nightly.g<sha>`. That sorts *below* the current stable and in random order between nightlies.
- querymt nightlies are versioned `nightly-<sha>`, which isn't semver, and they report the same version as the next stable. Their asset names contain no comparable version.
- Nothing stops a querymt stable from being tagged on a commit older than the published nightly. Its version would sort higher while its schema is lower.

## What Changes

- Add in-app self-update with the Tauri updater plugin for self-updatable installs: macOS `.app`, Windows NSIS, and Linux AppImage (Wry and CEF). `.deb` and the CEF portable tarball only get a notification and a download link.
- Add **two update channels** with separate signed static feeds:
  - stable: `releases/latest/download/latest.json`
  - nightly: `releases/download/nightly/latest.json`
  
  The build sets the default channel. Users can switch channels in Settings.
- **Never downgrade.** An update is offered only if its desktop version is strictly higher *and* its bundled `qmtcode` version is not lower than the one installed. After a switch from nightly to stable, the app stays on the nightly until a newer stable is released.
- Automatic checks (shortly after start, then every 6h) plus a manual "Check now". Failed checks are ignored quietly.
- Stop the `qmtcode` sidecar before installing an update and before restarting.
- **Anonymous update statistics** through the query.mt Cloudflare worker, controlled by a separate "Send anonymous update statistics" switch (on by default):
  - Checks go to `query.mt/updates/desktop/<channel>/latest.json` (channel, version, target only) and fall back to the GitHub feed.
  - Update downloads go through `query.mt/download/desktop/update/<tag>/<asset>`, with a retry from GitHub if that fails.
  - Recorded in a new Analytics Engine dataset `qmt_desktop_updates`, with no install ID or IP data. With the switch off, the app contacts GitHub only.
- **Desktop release pipeline:**
  - Sign updater artifacts in both workflows (including the hand-packaged CEF AppImage).
  - Create `latest.json` per channel with one shared script. Linux keys are split by runtime (`linux-<arch>-wry`, `linux-<arch>-cef`).
  - Record the bundled `qmtcode` version in each feed.
  - **BREAKING (release naming):** desktop nightly versions become `<base>-nightly.<UTC YYYYMMDDHHMMSS>`. The base is the next patch after the latest stable tag, so every nightly sorts above the stable it follows and nightlies sort in build order. The commit SHA moves to the release notes and the feed.
  - Stable release assets are built with the same scripted build and collect steps as nightly, so asset names are predictable.
- **querymt (upstream) nightly release fixes** (in `querymt/querymt`, which publishes `qmt` and `qmtcode`):
  - Version nightlies with the same `<base>-nightly.<timestamp>` scheme as the desktop, through `QMT_VERSION`. `qmt --version` and `qmtcode --version` then report sortable semver instead of `nightly-<sha>`.
  - Publish a machine-readable `release.json` manifest with each release (version, channel, commit, published time).
  - Fail a stable release if its version is higher than the published nightly's and its tag commit doesn't contain the nightly's commit. This prevents a "future stable" from regressing the schema of users on the "current nightly".
  - Replace the rolling nightly through a staged draft, as the desktop already does, to keep the time without a nightly release short.
  - Send the nightly version in the desktop dispatch payload.

## Capabilities

### New Capabilities
- `desktop-self-update`: in-app update checks, channel selection, the no-downgrade and `qmtcode` gates, install and restart behavior per install kind, the anonymous update statistics setting and its GitHub fallback, and the Settings UI.
- `desktop-release-channels`: how desktop stable and nightly releases are versioned, signed, and published as update feeds that the updater relies on, plus the query.mt statistics redirects and landing-page download names.
- `qmtcode-release-contract`: what the desktop requires from querymt `qmt`/`qmtcode` stable and nightly releases (sortable versions, release manifest, stable-after-nightly ancestry, publish continuity).

### Modified Capabilities
- None.

## Impact

- **Rust:**
  - New `src-tauri/src/updates.rs`.
  - `lib.rs` plugin and command registration.
  - Uses `AcpAgentManager::shutdown_all` (`src-tauri/src/sidecar.rs`).
  - `build.rs` compile-time channel and qmtcode metadata.
  - `Cargo.toml` adds `tauri-plugin-updater` and `tauri-plugin-process`.
- **Config:**
  - `tauri.conf.json` gets `bundle.createUpdaterArtifacts` and `plugins.updater.pubkey`.
  - No `updater:*` permission is given to the webview.
- **Frontend:** Updates group on `src/routes/settings/+page.svelte` (including the statistics switch), an update-available prompt, and an updates store.
- **CI:**
  - `.github/workflows/nightly.yml` and `release.yml`.
  - `scripts/cef/package.sh` (signing).
  - New `scripts/release/*` (version computation, bundle collection, feed generation).
- **Secrets:** `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in this repo. Losing the key ends updates for every installed copy.
- **Website (`querymt-website`):** `worker.js` update check and download routes, `src/data/landing.ts` asset patterns for the D5 names, and a `qmt_desktop_updates` dataset binding in `wrangler.toml`. Must deploy before the first stable with the new asset names.
- **Upstream:** `querymt/querymt` `.github/workflows/nightly.yml`, `release.yml`, `build.yml`. These must land before the desktop updater ships, because the desktop gate depends on comparable qmtcode versions.
- **Users:**
  - Existing installs have no updater and must install one updater-enabled build by hand.
  - Desktop nightly names and versions change format.
  - Update checks and downloads go through query.mt unless the user turns off statistics.
