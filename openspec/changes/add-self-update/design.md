# Design

## Context

See proposal.md (Why). Current state that shapes the approach:

- **Desktop releases.** `release.yml` builds stable releases on `v*.*.*` tags. Wry builds go through `tauri-action` with `releaseAssetNamePattern`; CEF builds go through `scripts/cef/package.sh` and `gh release upload`. `nightly.yml` builds a rolling `nightly` prerelease, stamps `tauri.conf.json` as `<pkg>-nightly.g<sha7>`, and swaps releases through a `nightly-staging` draft. Neither workflow signs anything.
- **Sidecar.** Both workflows download `qmtcode` from querymt: `releases/latest` for stable, `releases/tags/nightly` for nightly. The sidecar is managed by `AcpAgentManager` (`src-tauri/src/sidecar.rs`), which already has `shutdown_all()` and is called on `RunEvent::Exit`. qmtcode owns `sessions.db` under `QUERYMT_DESKTOP_HOME` (app data dir, `sidecar.rs:790`). Both channels share identifier `com.querymt.desktop`, so they share one install and one data dir.
- **querymt today.**
  - `nightly.yml` sets `version_name=nightly-<sha7>`, which `build.yml` passes as `QMT_VERSION`. `crates/agent/build.rs` turns that into `QMT_BUILD_VERSION`, so `qmtcode --version` reports `nightly-d530f82` (not semver).
  - Assets are `qmtcode-nightly-<sha8>-<target>`.
  - The nightly is deleted and recreated in place, so there is a gap with no release during upload.
  - `release.yml` uses `version_name=${{ github.ref_name }}` and has no check against the nightly.
  - Observed on 2026-11-05: latest stable is `v0.5.2` (2026-06-25), the nightly is at workspace `0.6.0`, 372 commits ahead.
- **Tauri updater.** Requires signed artifacts, compares `update.version > current` by default, can override endpoints and target at runtime from Rust, and exposes the full feed entry as `raw_json`. Windows NSIS installs exit the app (`on_before_exit` hook). It tries endpoints in order, moving to the next one on a transport error or non-success status, substitutes `{{current_version}}` and `{{target}}` in endpoint URLs, and exposes `Update::download_url` as a public field.
- **Website analytics.** The `querymt-website` worker already counts GETs on `/download/desktop/<tag>/<asset>` in the Analytics Engine dataset `qmt_installs` (with a salted IP hash) and 302-redirects them to GitHub. `landing.ts` `desktopAssetPackage` only recognises tauri-action names (`QueryMT.Desktop_<ver>_aarch64.dmg`, `QueryMT-Desktop-wry-<ver>-linux-...`), not the D5 names.

## Goals / Non-Goals

**Goals:**
- Version order equals code order, for both desktop and qmtcode, across both channels.
- One shared pipeline for stable and nightly feeds.
- All update policy lives in Rust; the webview only displays state and confirms actions.

**Non-Goals:**
- Separate install or data dir per channel (rejected; see D1).
- Rollback or downgrade, including to roll back a bad release. A fix ships as a newer version.
- An apt repository, Apple notarization, Windows code signing.
- A schema-version guard inside qmtcode that refuses a newer `sessions.db`. Strongly recommended upstream, but not part of this change.
- Delta or differential updates.
- Per-install identifiers or unique-user counts in update statistics.

## Decisions

### D1. One install, channel is a preference, never downgrade
Both channels keep `com.querymt.desktop`. The channel only selects the feed. The default "strictly greater" comparator stays, so switching nightly to stable waits for a newer stable.
- *Alternative: separate nightly identifier/data dir.* Isolates data, but users lose sessions on switch and need an import path, which changes the install model. Rejected by the user.
- *Alternative: allow the downgrade on switch.* Would run an older qmtcode against a migrated `sessions.db`. Rejected.

### D2. Version schemes (shared by desktop and querymt)
`<base>-nightly.<UTC YYYYMMDDHHMMSS>`. Base = project/workspace version, unless tag `v<that>` exists, in which case it is the next patch. Implemented once as `scripts/release/nightly-version.mjs` (desktop), with an equivalent bash/python step in querymt. Both are tested against the same table of cases.
- The timestamp is the workflow start time in UTC. It is a single numeric identifier, so semver compares it numerically and it always increases.
- The SHA is excluded from the version and from `+build` metadata. The Rust `semver` crate orders build metadata, so it would act as a tiebreaker.
- *Alternative: `github.run_number`.* Resets if the workflow is renamed or recreated, and isn't comparable across repos. Timestamps are.

### D3. qmtcode gate via feed metadata, not `--version`
Each `latest.json` gets top-level `qmtcode_version`. Desktop builds embed `QMTCODE_VERSION` at compile time through `build.rs` → `rustc-env`. Development builds without it report `None` and skip the gate, and only for development builds; release builds fail to compile without it (see D9). The updater check reads `update.raw_json["qmtcode_version"]` and rejects the update if that is missing or lower than the embedded version.
- *Alternative: run `qmtcode --version` at runtime.* Breaks when the user points the agent command at a custom qmtcode, and current nightlies aren't semver. Rejected.

The desktop release workflow also checks the reverse direction before publishing: stable must not bundle a qmtcode lower than the current desktop nightly feed's. Users would never receive such a build anyway, but the check keeps it from being published at all.

### D4. Feed layout and Linux runtime targets
Custom updater targets are computed in Rust:
- `darwin-<arch>`
- `windows-<arch>`
- `linux-<arch>-wry` / `linux-<arch>-cef` (chosen by `cfg(feature = "cef")`)

Endpoints:
- stable: `https://github.com/querymt/querymt-desktop/releases/latest/download/latest.json`
- nightly: `https://github.com/querymt/querymt-desktop/releases/download/nightly/latest.json`

`tauri.conf.json` carries only `pubkey`. Endpoints are set per check through `updater_builder().endpoints(..).target(..)`. These GitHub URLs stay the canonical feeds; when update statistics are on, the query.mt check URL is tried first and the GitHub feed second (D11).
- *Alternative: tauri-action's generated feed.* Only covers Wry, doesn't fit the renamed assets or CEF, and nightly doesn't use tauri-action. Rejected in favor of one script, `scripts/release/updater-feed.mjs`.

### D5. Unified build/collect for stable and nightly
`release.yml` drops `tauri-action` and runs the same steps as `nightly.yml`: `npm run tauri:wry build`, then `scripts/release/collect-bundles.sh`. That script copies the installer, updater artifact and `.sig` files into `dist/` with predictable names: `<prefix>-<version_name>-<suffix><ext>`, where `version_name` is `vX.Y.Z` or `nightly`.
- Nightly asset names become `...-nightly-<suffix>`, without a SHA. The rolling release URL stays stable and the feed is the source of truth.
- The publish job in each workflow runs `updater-feed.mjs` over `dist/` with a manifest of expected platform keys. It fails if any key, artifact or signature is missing, then uploads `latest.json` together with the other assets.

### D6. Signing
- `bundle.createUpdaterArtifacts: true`. Wry builds get `TAURI_SIGNING_PRIVATE_KEY` and `..._PASSWORD` from secrets.
- `package.sh` signs the CEF AppImage with `npx tauri signer sign` when the env var is set.
- CI sets `REQUIRE_UPDATER_SIGNATURE=1`, which turns a missing key into an error.
- Local builds without a key still work: Tauri warns and skips signing.

### D7. Install kind detection (Rust)
- macOS: running from a `.app` bundle → self-install.
- Windows: NSIS (the only Windows bundle) → self-install.
- Linux: `APPIMAGE` env var set → self-install.
- Linux, executable under `/usr/` or `/opt/querymt-desktop/` → `deb`, notify-only.
- Anything else (portable tar, dev builds) → notify-only.

The check still runs for notify-only kinds, so they get the release link.

### D8. Commands, state and lifecycle
New module `updates.rs`, all `#[cfg(desktop)]`.
- Commands:
  - `updates_status` → `{ channel, buildChannel, currentVersion, qmtcodeVersion, installKind, autoCheck, sendStatistics, lastCheck, state }`
  - `updates_set_preferences({ channel?, autoCheck?, sendStatistics?, skippedVersion? })`
  - `updates_check({ manual })`
  - `updates_install(onEvent: Channel)`, which downloads, verifies and installs, reporting progress
  - `updates_restart`
- A `PendingUpdate` mutex holds the checked `Update`.
- Preferences are stored as a JSON file under app config dir (`updates.json`). The Rust side reads them before the webview loads, which `localStorage` can't do.
- Scheduler: a Tokio task sleeps 30s, then checks every 6h if auto-check is on. It emits `updates://state` events. Automatic-check failures only update `state` and log.
- Lifecycle:
  - `on_before_exit` calls `AcpAgentManager::shutdown_all()`; Windows exits during install.
  - `updates_restart` calls `shutdown_all()`, then `app.restart()`. The existing `RunEvent::Exit` handler tolerates a second call.
- `tauri-plugin-process` is not needed: `AppHandle::restart` covers it. Only `tauri-plugin-updater` is added. Its plugin is registered, but no `updater:*` permission is granted (spec: webview can't control the updater).

### D9. Compile-time build metadata
`build.rs` forwards `QMT_RELEASE_CHANNEL` (`stable`|`nightly`, default `stable`) and `QMTCODE_VERSION` through `cargo:rustc-env`, with `rerun-if-env-changed`. The workflows set them. A release profile build with `QMT_RELEASE_CHANNEL` set and `QMTCODE_VERSION` missing panics in `build.rs`, so CI can't publish a build that skips the gate.

### D10. Upstream querymt release fixes (`querymt/querymt`)
These land first; the desktop depends on them through `release.json` and comparable versions.

1. **`nightly.yml`.** Compute the version with the D2 algorithm (workspace version from `[workspace.package]`, tags from `git ls-remote --tags`).
   - `version_name` stays as the *asset label* (`nightly`). A new `qmt_version` output is passed to `build.yml` as `QMT_VERSION`.
   - Result: binaries report `0.6.0-nightly.20261105111147`, and assets become `qmtcode-nightly-<target>` (no SHA).
2. **`build.yml`.** Accept separate `version_name` (asset label) and `qmt_version` (embedded version) inputs. `QMT_VERSION` is set from `qmt_version`. Stable passes `vX.Y.Z` for both; `build.rs` already strips `v`.
3. **`release.json`.** Both workflows upload `{ "version", "channel", "commit", "published_at" }`. Desktop workflows read it instead of parsing asset names or notes. Fallback for one transition release: if `release.json` is missing, desktop CI fails rather than guessing.
4. **Stable gate in `release.yml`.** Before building, fetch the published nightly `release.json`. If `semver(tag) >= base(nightly.version)` and `git merge-base --is-ancestor <nightly.commit> <tag commit>` fails, stop with an error naming both commits.
   - Patch releases on older lines (`v0.5.3` while the nightly is `0.6.0-nightly.*`) pass, because they sort below the nightly.
   - Also check that the tag equals the workspace version.
5. **Staged nightly replacement.** Copy the desktop pattern: upload to a `nightly-staging` draft, delete the old `nightly`, retag the draft, publish. If an upload fails, the old nightly stays.
6. **Dispatch payload.** Add `client_payload[querymt_version]`. The desktop nightly logs it but still trusts `release.json` (the dispatch can be manual).

Why the gate checks ancestry and not just version order: the danger is a stable with a *higher* version but *older* code (fewer migrations) than the nightly users already run. Version order alone can't detect that; ancestry can. With base = next patch after an existing tag, every nightly after `v0.6.0` is `0.6.1-nightly.*`, which sorts above `0.6.0`. Users on that nightly therefore wait for `0.6.1`, which the ancestry gate guarantees is newer code.

### D11. Anonymous update statistics through query.mt
Update checks and update downloads go through redirects on the existing query.mt worker, so they show up in Cloudflare Analytics next to installer downloads.

- **Setting.** `sendStatistics` in `updates.json`, default `true` (opt-out). A file without the field reads as `true`. It is separate from `autoCheck`: manual checks follow it too. Settings shows a "Send anonymous update statistics" switch with a short description of what is sent.
- **Checks.** With statistics on, the endpoint list is:
  1. `https://query.mt/updates/desktop/<channel>/latest.json?v={{current_version}}&t={{target}}`
  2. the GitHub feed for the same channel (D4)

  With statistics off, only the GitHub feed is used. Both lists are constants in Rust; the webview only toggles the boolean. A worker that is down or returns an error falls through to GitHub within the same check (worst case two `CHECK_TIMEOUT`s).
- **Downloads.** The feed keeps canonical GitHub URLs (`https://github.com/querymt/querymt-desktop/releases/download/<tag>/<asset>`), so it works without query.mt. With statistics on, Rust rewrites a URL of exactly that form to `https://query.mt/download/desktop/update/<tag>/<asset>` before downloading; any other URL is used unchanged. If the rewritten download fails with a transport or HTTP error, it is retried once from the original GitHub URL. A signature failure is never retried: the install aborts as for any tampered artifact.
- **Worker routes** (`querymt-website/worker.js`):
  - `GET /updates/desktop/<stable|nightly>/latest.json`: validates the channel, caps and validates `v` (semver) and `t` (one of the 7 feed keys, invalid values recorded as `unknown`), records a `check` event, and 302-redirects to the fixed GitHub feed URL for that channel with `Cache-Control: no-store`.
  - `GET /download/desktop/update/<tag>/<asset>`: `<tag>` is `vX.Y.Z` or `nightly`, and `<asset>` must be a known updater artifact name for that tag (D5 names: `.app.tar.gz`, NSIS `-setup.exe`, Wry/CEF `.AppImage`). Records a `download` event with the target derived from the asset name and 302-redirects to the fixed GitHub asset URL. Unknown input → 404, nothing recorded.
  - HEAD requests redirect but are not counted. The update route is matched before the existing `/download/desktop/<tag>/<asset>` route (which only accepts two path segments).
- **Dataset.** New Analytics Engine binding `UPDATES` → dataset `qmt_desktop_updates`, separate from `qmt_installs`. Data point: `indexes: [event]`, `blobs: [event, channel, version, target, country]`, `doubles: [1]`. No IP, IP hash, user agent (the updater's is constant anyway), city or ASN, and the desktop sends no install ID. Counts are therefore checks and downloads, not unique users; roughly 4 checks per running install per day give an estimate of active installs by version, channel and platform.
- **Security.** Redirect targets are built from fixed host and repo prefixes plus validated segments, so the worker can't redirect anywhere else. The version gates run in Rust on the feed contents, and the signature is checked against the embedded key, so a compromised worker can delay updates but can't change what is installed.
- *Alternative: tracking URLs inside `latest.json`.* Would count downloads even with statistics off and make the feed depend on query.mt. Rejected.
- *Alternative: reuse `qmt_installs` with a marker.* Mixes user-initiated installer downloads with background traffic and keeps an IP hash. Rejected by the user.

## Risks / Trade-offs

- [Signing key lost or leaked] → Store the private key with a password in a password manager plus repo secrets. Document key rotation (ship a build with a new pubkey that is signed by the old key) in the README.
- [Users stuck on nightly after switching to stable for a long time] → Settings shows "Waiting for a stable release newer than X". Users can reinstall stable by hand, accepting the data risk, as a documented escape hatch.
- [Nightly feed briefly 404 during replacement] → Automatic checks ignore it quietly (spec), and the staged publish keeps the gap to seconds.
- [Pre-change desktop nightlies `0.1.7-nightly.g*` sort below new stables] → Harmless: those builds have no updater. Users install one updater-enabled build by hand.
- [Desktop stable blocked because querymt stable lags nightly qmtcode] → Intended. The release can't ship until querymt cuts a stable containing the nightly commit, or the desktop nightly falls back. Document this in the release checklist.
- [Clock skew between runners] → Each workflow stamps one timestamp in a single job and passes it to all matrix jobs.
- [`.deb` users never self-update] → Notification and link. A future apt repo is out of scope.
- [macOS app in `/Applications` not writable by a standard user] → The updater falls back to its admin prompt. Accepted.
- [Statistics on by default is telemetry] → Only channel, version, target and country, no identifiers; disclosed in Settings and the README; one switch turns it off and then nothing is sent to query.mt.
- [query.mt down or misconfigured] → Checks fall back to GitHub and downloads retry from GitHub; updates keep working. Rollback is removing the worker routes.
- [Landing page breaks on D5 asset names] → Website patterns are updated and deployed before the first stable with the new names (task group 9).

## Migration Plan

1. Land the upstream querymt changes (D10) and wait for one nightly that publishes `release.json`.
2. Generate the signing keypair, add the secrets, and commit the pubkey.
3. Deploy the `querymt-website` changes (landing-page asset patterns, update routes, `qmt_desktop_updates` dataset). This must be live before the first stable with D5 asset names and before any build that sends statistics.
4. Land the desktop CI changes. The first nightly publishes `latest.json`.
5. Land the app updater. The next nightly and stable are the first updater-enabled builds, and users install them by hand once.
6. Rollback: revert the workflows. Installed apps then see no feed (404) and stay quiet. A bad release is fixed by publishing a higher version. If the worker routes misbehave, remove them: apps fall back to GitHub.
