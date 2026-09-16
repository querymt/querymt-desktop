# QueryMT Desktop

A shared Svelte frontend for QueryMT. It runs either in the native Tauri desktop shell or as a static UI embedded and served by `qmtcode`.

## Application targets

The default target is QueryMT Desktop. It can manage local ACP subprocesses and use native window, workspace-picker, profile-template, log, and telemetry integrations.

The embedded target is a static SPA for `qmtcode`. It registers one host-managed agent, connects to the serving origin at `/acp/ws`, uses `ws:` or `wss:` to match the page, and communicates through ACP plus capability-advertised QueryMT extensions. Workspace paths entered in this target refer to the `qmtcode` server filesystem.

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
