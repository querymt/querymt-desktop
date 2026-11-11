# QueryMT Desktop

A shared Svelte frontend for QueryMT. It runs either in the native Tauri desktop shell or as a static UI embedded and served by `qmtcode`.

## Application targets

The default target is QueryMT Desktop. It can manage local ACP subprocesses and use native window, workspace-picker, profile-template, log, and telemetry integrations.

The embedded target is a static SPA for `qmtcode`. It registers one host-managed agent, connects to the serving origin at `/acp/ws`, uses `ws:` or `wss:` to match the page, and communicates through ACP plus capability-advertised QueryMT extensions. Workspace paths entered in this target refer to the `qmtcode` server filesystem.

## macOS downloads

Release builds are not yet signed with a Developer ID or notarized, so macOS Gatekeeper
blocks them after download. After copying the app to `/Applications` (or anywhere else),
clear the quarantine flag **recursively** so the bundled `qmtcode` agent is covered too:

```sh
xattr -dr com.apple.quarantine "/Applications/QueryMT Desktop.app"
```

Without `-r`, only the app folder is cleared and the bundled agent is still killed on start.

## Bundled agent

The release bundles a `qmtcode` binary next to the app executable. The default agent
command is `qmtcode --acp`; the bare `qmtcode` is resolved on every start, in this order:

1. the copy bundled with the app (`qmtcode` or `qmtcode-<target-triple>`), wherever the app is installed or moved to;
2. a `qmtcode` on `PATH`.

A command that contains a path (for example `/opt/tools/qmtcode --acp`) is used as written.
The agents page and the agent log show which binary was launched.

## Linux downloads

Linux release filenames identify the runtime:

- `QueryMT-Desktop-wry-<version>-linux-<arch>.*`: stable default, using the system WebKitGTK webview.
- `QueryMT-Desktop-cef-<version>-linux-<arch>.*`: experimental CEF runtime, bundling Chromium instead of using WebKitGTK.

`<version>` is `vX.Y.Z` for stable releases and `nightly` for the rolling nightly.

Choose `x86_64` for Intel/AMD Linux or `aarch64` for ARM64 Linux. Both runtimes provide
AppImage and Debian (`.deb`) packages; CEF also provides a portable `.tar.gz`.

## Updates and release channels

The app checks for updates in the background (Settings → Updates) and never downloads without confirmation. Stable and nightly are separate channels, each with its own `latest.json` feed.

- **Versions:** stable is `X.Y.Z`. A nightly is `<base>-nightly.<UTC YYYYMMDDHHMMSS>`, where `<base>` is the project version, or the next patch if tag `v<base>` already exists. The commit SHA is never part of the version.
- **No downgrades:** an update is offered only if it is strictly newer. Switching a nightly to stable shows "Waiting for a stable release newer than X" until a newer stable is published. Reinstalling a stable build by hand is possible, but it may not open data written by a newer nightly.
- **qmtcode gate:** an update that would downgrade the bundled qmtcode is refused, so a session database is never opened by an older qmtcode. A stable desktop release fails CI if its bundled qmtcode is older than the one in the current nightly.
- **Signed release manifest:** the feed is treated as untrusted. Each `latest.json` carries a manifest (`release_manifest`, `release_manifest_signature`) with the desktop and qmtcode versions, signed with the updater key and bound to the desktop version. The app reads the qmtcode version only from it and does not offer a release whose manifest is missing or does not verify.
- **Install kinds:** macOS app, Windows NSIS and Linux AppImage update in place. `.deb` and the CEF `.tar.gz` only show a link to the release page.
- **Update statistics:** on by default, switch off in Settings → Updates. Checks and downloads go through `query.mt` (falling back to GitHub), which records only event, channel, app version, platform and country. No IP, install ID or other identifier is stored. With the switch off, only GitHub is contacted.
- **Signing:** every update is verified against the public key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The private key and its password live only in the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets, plus one backup in the maintainers' password manager. Losing the key means existing installs can no longer update and must be reinstalled.
- **Key rotation:** installed apps only accept updates signed with the key they embed, so rotate in two steps.
  1. Transition release: put the new public key in `tauri.conf.json`, keep the old private key in the `TAURI_SIGNING_PRIVATE_KEY` secrets, and set the repository variable `UPDATER_VERIFY_PUBKEY` to the *old* public key. The feed builder (`updater-feed.mjs --verify-pubkey`) then checks the artifacts against the old key that signed them, while the build embeds the new one.
  2. Once users have updated, switch the secrets to the new private key and delete `UPDATER_VERIFY_PUBKEY`; normal releases verify against the embedded key again.

## Development

Development needs a Rust toolchain, Node.js, and the WebKit/CEF system
libraries. If you're on NixOS or using the nix package manager, enter the
devshell first (`nix develop`, or direnv via the shipped `.envrc`); for any
other setup, make sure those dependencies are present on your system:

```bash
nix develop
npm install
npm run dev                # Desktop-target web UI
npm run dev:embedded       # Embedded UI; proxies /acp/ws to qmtcode
```

Embedded development proxies to `http://127.0.0.1:3000` by default. Override it when `qmtcode --dashboard` listens elsewhere:

```bash
QMT_EMBEDDED_PROXY_TARGET=http://127.0.0.1:8080 npm run dev:embedded
```

Run the desktop app:

```bash
npm run tauri -- dev       # default runtime
npm run tauri:wry -- dev   # System webview
npm run tauri:cef -- dev   # CEF, Linux only
```

Build a runtime variant:

```bash
npm run tauri -- build
npm run tauri:wry -- build
npm run tauri:cef -- build
```

CEF is experimental; Wry remains the stable fallback.

`bundle.createUpdaterArtifacts` is on, so a build without `TAURI_SIGNING_PRIVATE_KEY` fails when it tries to sign. For a local package that you do not publish, skip signing:

```bash
npm run tauri -- build --no-sign
```

Published builds are always signed; CI fails when the signing key is missing.

Desktop icons are generated from `static/favicon.svg` with `npm run tauri -- icon static/favicon.svg`.
Keep the desktop PNG, ICO, and ICNS outputs in `src-tauri/icons`; mobile and Appx icons are not used.

## Embedded artifact

Build the standalone UI without Tauri or Rust:

```bash
npm ci
npm run test:embedded
QUERYMT_UI_REVISION=$(git rev-parse HEAD) npm run build:embedded
```

The artifact is written to `build-embedded/`. It contains an `index.html` SPA fallback and `querymt-ui.json` build metadata.

Tagged `v*.*.*` desktop releases also publish:

- `querymt-embedded-ui-<tag>.tar.gz`
- `querymt-embedded-ui-<tag>.tar.gz.sha256`

QueryMT consumes the unpacked directory through `QMT_DASHBOARD_NG_DIST` and the `dashboard-ng` feature. `QMT_UI_DIST` is the legacy React dashboard prebuild and is not this artifact.

```bash
gh release download v0.1.0 --repo querymt/querymt-desktop \
  --pattern 'querymt-embedded-ui-*.tar.gz*'
mkdir -p /tmp/querymt-embedded-ui
tar -xzf querymt-embedded-ui-v0.1.0.tar.gz -C /tmp/querymt-embedded-ui
QMT_DASHBOARD_NG_DIST=/tmp/querymt-embedded-ui \
  cargo build -p querymt-agent --features dashboard-ng --example qmtcode
```

The initial embedded contract assumes root hosting and same-origin `/acp/ws`. It does not support a configurable agent endpoint, local subprocess management, native logs, native profile-template installation, or native directory browsing. The browser must be served from a trusted `qmtcode` origin; authentication and Origin enforcement remain responsibilities of the serving backend.
