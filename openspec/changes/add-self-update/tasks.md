# Tasks

## 1. Upstream querymt nightly and stable release fixes (`querymt/querymt`, lands first)

- [x] 1.1 Add a nightly version step to querymt `nightly.yml` using the D2 algorithm (workspace `[workspace.package].version`, next patch if tag `v<base>` exists, `-nightly.<UTC YYYYMMDDHHMMSS>`). Expose it as output `qmt_version` and set the asset label `version_name=nightly`. Verify with a table test covering `0.6.0` (no tag → `0.6.0-nightly.*`) and `0.6.0` with tag `v0.6.0` (→ `0.6.1-nightly.*`).
- [x] 1.2 Split `build.yml` inputs into `version_name` (asset label) and `qmt_version` (embedded `QMT_VERSION`). Update `release.yml` to pass `vX.Y.Z` for both. Verify that a nightly run's `qmtcode --version` prints `0.6.0-nightly.<ts>` and its assets are named `qmtcode-nightly-<target>.*`.
- [ ] 1.3 Upload `release.json` (`version`, `channel`, `commit`, `published_at`) from both querymt `nightly.yml` and `release.yml`. Verify it is downloadable from `releases/download/nightly/release.json` and `releases/latest/download/release.json`.
- [x] 1.4 Add the stable gate to querymt `release.yml`: fail if the tag doesn't match the workspace version, or if `semver(tag) >= base(nightly)` and `git merge-base --is-ancestor <nightly.commit> <tag commit>` fails. Verify with dry runs: `v0.6.0` on an old commit fails, `v0.6.0` on a descendant passes, `v0.5.3` passes.
- [ ] 1.5 Replace the delete-then-create nightly publish with the staged draft flow (`nightly-staging` draft → delete old → retag → publish). Verify that a forced upload failure leaves the previous `nightly` release in place.
- [x] 1.6 Add `client_payload[querymt_version]` to the `qmtcode-nightly` dispatch. Verify that the desktop nightly run logs the received version.
- [x] 1.7 Document the nightly/stable versioning and the stable gate in the querymt release docs or README. Verify by reviewing the merged doc.

## 2. Desktop release versioning scripts

- [x] 2.1 Add `scripts/release/nightly-version.mjs` (D2): reads `package.json`, gets tags from `git ls-remote`, accepts the timestamp as an argument. Verify with a node test table that shares cases with 1.1, including the scenarios in the `desktop-release-channels` spec.
- [x] 2.2 Add `scripts/release/resolve-qmtcode.mjs`, which reads querymt `release.json` for `latest` or `nightly` and outputs the qmtcode version, commit and asset URL per target. It fails if `release.json` is missing. Verify with a test against fixture JSON.

## 3. Signing and updater config

- [x] 3.1 Generate the updater keypair (`npm run tauri signer generate`), store the private key and password as `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets plus a backup in a password manager, and put the pubkey in `tauri.conf.json` `plugins.updater.pubkey`. Verify that `npm run tauri:wry build` with the key produces `.sig` files.
- [x] 3.2 Set `bundle.createUpdaterArtifacts: true`. Verify that a local macOS build emits `.app.tar.gz` and `.app.tar.gz.sig`.
- [x] 3.3 Sign the CEF AppImage in `scripts/cef/package.sh` with `tauri signer sign` when the key is set, and fail when `REQUIRE_UPDATER_SIGNATURE=1` and no key is present. Verify the `.sig` is next to the AppImage in `bundle/appimage/`.

## 4. Desktop CI: shared collect and feed

- [x] 4.1 Add `scripts/release/collect-bundles.sh` (D5), which copies installers, updater artifacts and `.sig` files for Wry and CEF into `dist/` with `<prefix>-<version_name>-<suffix><ext>` names. Verify by running it on a local build tree.
- [x] 4.2 Add `scripts/release/updater-feed.mjs` (D4), which builds `latest.json` from `dist/`, a base download URL, version, notes, `qmtcode_version` and the expected platform key list (`darwin-*`, `windows-x86_64`, `linux-*-wry`, `linux-*-cef`). It fails on any missing key, artifact or signature. Verify with node tests for a complete feed, a missing signature and a missing platform.
- [x] 4.3 Update `nightly.yml`:
  - compute the version once in `check-changes` via 2.1 and pass it to all matrix jobs;
  - resolve qmtcode via 2.2;
  - export `QMT_RELEASE_CHANNEL=nightly`, `QMTCODE_VERSION`, the signing secrets and `REQUIRE_UPDATER_SIGNATURE=1`;
  - collect via 4.1;
  - generate and upload `latest.json` in `publish-nightly`;
  - put the commit SHA in the notes only.
  
  Verify with a manual dispatch: `releases/download/nightly/latest.json` validates and contains all 7 platform keys.
- [ ] 4.4 Update `release.yml`:
  - replace `tauri-action` with the scripted Wry build and the 4.1 collect step;
  - resolve qmtcode via 2.2;
  - set `QMT_RELEASE_CHANNEL=stable`, `QMTCODE_VERSION` and the signing env;
  - generate `latest.json` in `publish-release`;
  - add the gate that fails if the bundled qmtcode < the qmtcode version in the desktop nightly feed.
  
  Verify on a test tag in a fork: the release has `latest.json`, and the gate fails when the qmtcode version is forced lower.
- [x] 4.5 Update `versions.yml` if needed so the CI-stamped nightly version is not checked against committed files. Verify that a nightly run passes the version check.

## 5. Rust updater backend

- [x] 5.1 Add `tauri-plugin-updater` for desktop targets in `Cargo.toml`, and in `build.rs` forward `QMT_RELEASE_CHANNEL` and `QMTCODE_VERSION` (panicking in CI release builds without `QMTCODE_VERSION`, D9). Verify with `cargo check` for `wry` and `cef` features.
- [x] 5.2 Implement `updates.rs` pure logic: channel → endpoint, updater target (incl. `-wry`/`-cef`), install-kind detection (D7), and the gate (desktop strictly greater, qmtcode ≥ embedded, missing qmtcode rejected). Verify with Rust unit tests covering every scenario of the "never downgrade" requirements.
- [x] 5.3 Implement preferences persistence (`updates.json` in the app config dir: channel, autoCheck, skippedVersion), defaulting to the build channel. Verify with unit tests for defaults and a round trip.
- [x] 5.4 Implement the commands `updates_status`, `updates_set_preferences`, `updates_check`, `updates_install` (progress `Channel`) and `updates_restart`, plus the `PendingUpdate` state. Register them in `lib.rs`, add the plugin without any `updater:*` capability, and add an `on_before_exit` hook calling `AcpAgentManager::shutdown_all()`. `updates_restart` also calls `shutdown_all()` before `app.restart()`. Verify that `cargo test` passes and that `capabilities/default.json` has no `updater:` entry.
- [x] 5.5 Implement the scheduler: first check after 30s, then every 6h when auto-check is on. Emit `updates://state`; automatic failures (including 404) are logged without prompting. Verify with a unit test for the scheduling decision (auto off, skipped version, failure categorisation).
- [x] 5.6 Add `sendStatistics` to `UpdatePreferences` (default `true`, missing field reads as `true`), `updates_status` and `updates_set_preferences` (D8, D11). Verify with unit tests for the default, a file without the field, and a round trip.
- [x] 5.7 Implement statistics routing in `updates.rs` (D11):
  - endpoint list per channel: query.mt check URL with `?v={{current_version}}&t={{target}}` first, then the GitHub feed; GitHub only when statistics are off;
  - rewrite `https://github.com/querymt/querymt-desktop/releases/download/<tag>/<asset>` to `https://query.mt/download/desktop/update/<tag>/<asset>` when statistics are on, leaving other URLs unchanged;
  - retry a failed rewritten download once from the GitHub URL, never after a signature failure.
  
  Verify with unit tests for both endpoint lists per channel, the URL rewrite (match, non-match, statistics off) and the retry decision, and update the existing URL tests (`updates.rs` channel/feed tests).

- [x] 5.8 Make saving preferences atomic: `updates_set_preferences` applies the patch to a copy and replaces the in-memory preferences only after `save_preferences` succeeds, so a failed save cannot undo a statistics opt-out. Verify by review; the save path is unchanged.
- [x] 5.9 Check each endpoint with its own updater instance (D11), so a query.mt response that is HTTP 200 with invalid JSON, or has no verifiable manifest, falls through to the GitHub feed. Verify by review against the plugin's endpoint loop (a non-JSON 200 aborts the plugin's own fallback).
- [x] 5.10 Add the signed release manifest (D12): `verify_manifest` in `updates.rs` (signature, bound version, type, channel) and use only its qmtcode version for the gate; add `RefusalReason::UnverifiedRelease`. Verify with unit tests on fixtures signed by the real `tauri signer sign` (valid, tampered, other key, other version, no signed version, wrong type, wrong channel, forged raw feed field).
- [x] 5.11 Generate and sign the manifest in CI: `updater-feed.mjs --write-manifest` and `--manifest-signature`, a signing step in the publish jobs of `nightly.yml` and `release.yml`. Verify with node tests (valid, missing, stale qmtcode, wrong bound version, other key, channel/version mismatch).

## 6. Frontend

- [x] 6.1 Add an updates store that wraps the commands and the `updates://state` event. Verify with vitest tests that mock `invoke`.
- [x] 6.2 Add an Updates group to `src/routes/settings/+page.svelte`: current version and qmtcode version, channel selector, auto-check switch, Check now, and status (including "Waiting for a stable release newer than X" and the qmtcode-downgrade refusal). Verify with tests in `settings-page.test.ts`.
- [x] 6.3 Add a non-modal update-available prompt: Install & restart / Later / Skip this version, with download progress. Notify-only install kinds show a release link instead of Install. Verify with component tests for the self-install and notify-only variants.
- [x] 6.4 Add a "Send anonymous update statistics" switch to the Updates group, with a short description of what is sent (channel, version, platform; no identifiers) and wire it to `sendStatistics` in the updates store. Verify with tests in `settings-page.test.ts` and the store tests.

## 7. Documentation

- [x] 7.1 Add an "Updates and release channels" section to the README: channels, switching rules (no downgrades, waiting for the next stable), deb/tar behavior, versioning scheme, the stable qmtcode gate, and the signing key custody and rotation procedure. Verify by review against the specs.
- [x] 7.2 Add an "Update statistics" paragraph to the README section: on by default, the query.mt URLs used, exactly which fields are recorded (event, channel, version, target, country), that no IP or install ID is stored, how to turn it off, and the GitHub fallback. Verify by review against D11.

## 8. End-to-end verification

- [x] 8.1 Nightly→nightly: install nightly N (updater-enabled), publish nightly N+1, and confirm that an automatic check offers N+1 and installs it on macOS, Windows, a Wry AppImage and a CEF AppImage, with the sidecar restarted afterwards.
- [ ] 8.2 Channel switch: on nightly `0.1.8-nightly.*`, switch to stable while the stable is `0.1.7`. Confirm the "waiting" status. Publish `0.1.8` (in a fork) and confirm it is offered.
- [ ] 8.3 qmtcode gate: publish (in a fork) a newer desktop release whose validly signed release manifest names a `qmtcode_version` lower than the installed one, and confirm the update is refused as a qmtcode downgrade (not as unverified).
- [ ] 8.3a Manifest: publish a test feed whose `release_manifest` was edited (or removed) and confirm the update is reported as unverified and, with statistics on, that the GitHub feed is tried next.
- [ ] 8.3b Target binding: in a test feed, swap the url and signature of two targets (for example the x86_64 and aarch64 CEF AppImages) and confirm the update is reported as unverified and nothing is installed.
- [ ] 8.4 Tampering: modify an artifact in a test feed and confirm that the install aborts and the current version still runs.
- [x] 8.5 Statistics: with statistics on, confirm a check and an install appear as `check` and `download` events in `qmt_desktop_updates`; with statistics off, confirm (via proxy log) that no request goes to query.mt; with the worker routes blocked, confirm the check and install still succeed from GitHub.

## 9. Website (`querymt-website`, deploy before the first stable with D5 names)

- [x] 9.1 Update `src/data/landing.ts` `desktopAssetPackage` to recognise the D5 installer names (`QueryMT-Desktop-vX.Y.Z-macos-<arch>.dmg`, `QueryMT-Desktop-vX.Y.Z-windows-x64-setup.exe`, `QueryMT-Desktop-{wry,cef}-vX.Y.Z-linux-<arch>.{AppImage,deb}`), keeping the old names for existing releases. Verify with tests against fixture release JSON for both naming schemes.
- [x] 9.2 Add the `UPDATES` Analytics Engine binding for dataset `qmt_desktop_updates` in `wrangler.toml` and a `writeUpdateEvent` helper that records `[event, channel, version, target, country]` only. Verify with a unit test using a mock binding that no IP, hash or user agent is written.
- [x] 9.3 Add `GET|HEAD /updates/desktop/<stable|nightly>/latest.json` to `worker.js`: validate the channel, record a `check` event on GET (invalid `v`/`t` recorded as `unknown`), 302 to the fixed GitHub feed URL with `Cache-Control: no-store`. Verify with worker tests for both channels, invalid channel (404, nothing recorded) and HEAD (not recorded).
- [x] 9.4 Add `GET|HEAD /download/desktop/update/<tag>/<asset>`, matched before the installer route: accept only `vX.Y.Z`/`nightly` tags and D5 updater artifact names for that tag, derive the target from the name, record a `download` event on GET, 302 to the fixed GitHub asset URL. Verify with worker tests for each of the 7 targets, an unknown asset and a path-traversal attempt (404, nothing recorded).
- [x] 9.5 Deploy the website and confirm with `curl -I` that both routes redirect to the published GitHub feed and assets, and that the events appear in `qmt_desktop_updates`.

## Workflow follow-up

- Tasks in group 1 live in `querymt/querymt`; open a linked PR there and land it before group 4.
- Tasks in group 9 live in `querymt-website`; deploy them before 4.4 publishes the first stable with D5 names and before 5.7 ships.
- Archive this change after the first updater-enabled stable release is verified.
