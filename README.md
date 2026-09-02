# QueryMT Desktop

An in-progress native desktop control center for QueryMT built with Tauri, SvelteKit, TypeScript, Tailwind CSS, and Bits UI.

## Current status

This repository currently contains the initial app scaffold plus a static product shell prototype with fake data for the main desktop surfaces.

## Development

```bash
npm install
npm run dev
```

Run the desktop app:

```bash
nix develop
npm run tauri:wry -- dev   # System webview
npm run tauri:cef -- dev   # CEF, Linux only
```

Build a runtime variant:

```bash
npm run tauri:wry -- build
npm run tauri:cef -- build
```

CEF is experimental; Wry remains the stable fallback.
