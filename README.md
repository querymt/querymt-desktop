# QueryMT Desktop

An in-progress native desktop control center for QueryMT built with Tauri, SvelteKit, TypeScript, Tailwind CSS, and Bits UI.

## Current status

This repository currently contains the initial app scaffold plus a static product shell prototype with fake data for the main desktop surfaces.

## Development

```bash
npm install
npm run dev
```

Desktop runtime commands:

```bash
npm run tauri:wry -- dev       # System webview (all desktop platforms)
npm run tauri:cef -- dev       # CEF on Linux, using X11/XWayland
npm run tauri:cef -- build     # Linux CEF production binary
npm run package:cef            # AppImage, deb, and portable tarball
```

On NixOS, enter a fresh `nix develop` shell before running the CEF commands. The
updated shell supplies Chromium's GPU, NSS, X11, audio, and font libraries. The
recommended development command starts Vite and CEF together. After a production
build, the binary can also be launched from the same shell with
`./src-tauri/target/release/querymt-desktop`. Directly launching the debug binary
requires a separate `npm run dev` process.

CEF is the default Linux release runtime. On x86_64 Linux it is also the default Nix
runtime; other Nix architectures fall back to Wry until a matching CEF binary is pinned.
The Wry package remains available as `nix build .#querymt-desktop-wry`; the x86_64 Linux
CEF package is `nix build .#querymt-desktop-cef`. The first CEF build downloads the
pinned CEF 150 runtime unless `CEF_PATH` points to a
matching runtime. Set `QUERYMT_CEF_DEVTOOLS=<port>` for Chromium remote debugging,
`QUERYMT_CEF_DISABLE_GPU=1` to diagnose GPU problems, or provide comma-separated
Chromium switches through `QUERYMT_CEF_ARGS` (for example,
`QUERYMT_CEF_ARGS=disable-gpu-compositing,use-angle=vulkan`).
