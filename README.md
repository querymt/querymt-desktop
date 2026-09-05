# QueryMT Desktop

An in-progress native desktop control center for QueryMT built with Tauri, SvelteKit, TypeScript, Tailwind CSS, and Bits UI.

## Current status

This repository currently contains the initial app scaffold plus a static product shell prototype with fake data for the main desktop surfaces.

## Development

Development needs a Rust toolchain, Node.js, and the WebKit/CEF system
libraries. If you're on NixOS or using the nix package manager, enter the
devshell first (`nix develop`, or direnv via the shipped `.envrc`); for any
other setup, make sure those dependencies are present on your system:

```bash
nix develop
npm install
npm run dev                # web UI only (vite)
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
