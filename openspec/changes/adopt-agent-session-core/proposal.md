# Proposal

## Why

The desktop gets slower the longer a session runs, and session features are hard to change:

- **Most updates copy the whole session.** Every live update except text chunks goes through `cloneSession` (`src/lib/domain/session-updates.ts`). That function copies every transcript item, tool call and event.
- **The whole conversation is rebuilt repeatedly.** `buildSessionConversation` rebuilds every turn on each change, and three components each call it separately.
- **Agent logs cost work even when nobody looks at them.** Each stdout line rebuilds the reactive log map, whether or not the Agents page is open.
- **The session state machine is spread through one large store.** `AgentsStore` in `src/lib/stores/agents.svelte.ts` is 7,868 lines, with 11,655 lines of tests.

The querymt change `add-agent-session-core` provides `agent-session-core`, a reducer built on the agent's own wire types and published as a WebAssembly module. With it, the desktop no longer needs a reducer of its own. It replaces its TypeScript reducer, snapshot hydration and conversation builder with that module, and keeps only presentation code.

## What Changes

- **ACP stays the protocol.** The desktop keeps talking to agents only through ACP with the ACP SDK; no request, notification or capability changes. `agent-session-core` replaces the code that turns ACP messages into the view, not the protocol.
  - Context compaction comes from the standard ACP `compaction_update` / `compaction_summary_chunk` updates, which the desktop already opts into with the standard `session.compaction` client capability (`CompactionCapabilities`). Plans come from the standard plan updates.
  - The only QueryMT extension read is the existing `_meta["querymt/sessionLoadSnapshot.v1"]` on the `session/load` response. Agents that do not send it are rendered from the standard replayed `session/update` notifications.
  - The module's inputs (`snapshot_loaded`, `acp_notification`, …) are an in-process API between the desktop's ACP transport and the module, not a wire format.
- **Benchmark harness without a backend.** A seeded lorem-ipsum session generator plus five scenarios:
  - streaming into a long session,
  - opening a session,
  - switching sessions,
  - UI isolation while streaming,
  - a log flood.
  
  Each scenario reports deterministic work counters and scaling ratios. The harness records a baseline on the current code before anything changes, and CI gates on it. No scenario starts `qmtcode` or opens a network connection.
- **Agent logs only while visible.** The Agents page loads the retained entries when it opens and listens only while it is open. The store no longer copies the log map for every line.
- **Vendored session-core module.** The WASM build of `agent-session-core` from a querymt release is pinned by version and sha256 under `src/lib/session-core/vendor/`. An update script refreshes it, and the same module loads in Tauri, the embedded build and Vitest.
- **Session controller.** One module instance per open session. It does three things:
  - applies inputs in batches, keeping the existing animation-frame batching for chunks,
  - stores turns per id, so a change replaces only the turns the module reports,
  - keeps the 5 most recently viewed sessions in memory for instant switching.
- **Presentation only in TypeScript.** Markdown/HTML, diffs and tool presentation stay in TypeScript and are cached per turn revision. Components render turns keyed by id, so unchanged turns do not re-render.
- **Removed:** the TypeScript session reducer and conversation builder:
  - in `session-updates.ts`: `applySessionNotification`, `reduceSessionReplay`, `appendSessionReplay`, `cloneSession` and the related helpers;
  - snapshot hydration in `session-snapshot.ts`;
  - turn building in `session-conversation.ts`;
  - the `ActiveSessionViewModel` shape.
  
  The active-session code paths of `AgentsStore` move into the controller.
- **Debug events panel.** It shows the newest 1,000 entries and the number dropped.
- **Generated types.** They are regenerated from querymt, so they now include the session-core input, view and change-report types.

## Non-goals

- Any change to ACP messages or capabilities, or QueryMT-specific replacements for standard ACP updates such as compaction.
- Splitting the rest of `AgentsStore` (catalog, pins, connections, admin areas). That is a later change.
- The IPC framing work, which stays in `speed-up-session-loading` (tasks 6.x).
- A native Rust path in `src-tauri` that applies inputs before they reach the webview.
- Visual redesign, or a renderer other than the webview.

## Capabilities

### New Capabilities
- `desktop-session-view`: how the desktop renders a session from agent output. It covers which turns update, staying responsive during long streams, switching sessions, the debug events panel, behaviour when the reducer module cannot load, and backend-free performance checks.
- `desktop-agent-logs`: when agent runtime logs are collected and shown in the desktop.

### Modified Capabilities

None.

## Impact

- **Code:**
  - `src/lib/stores/agents.svelte.ts` (active-session paths and the log subscription)
  - `src/lib/domain/session-{updates,snapshot,conversation}.ts`
  - `src/lib/components/primitives/ActiveSessionView.svelte`, `src/lib/components/session/*`
  - `src/routes/sessions/[agentId]/[sessionId]/+page.svelte`, `src/routes/agents/+page.svelte`
  - `src/lib/perf/*`, `scripts/check-session-load-benchmark.mjs`, `.github/workflows/performance.yml`
- **New:** `src/lib/session-core/` (loader, controller, vendored module) and `scripts/session-core/update.mjs`.
- **Dependency:** requires a querymt nightly or stable release that publishes `agent-session-core-wasm` (querymt change `add-agent-session-core`, group 6). The harness and log groups do not depend on it.
- **Builds:** about 600 KiB gzipped of WASM is added to both the desktop and embedded bundles. The embedded artifact must be served with `application/wasm` by `qmtcode`.
- **Compatibility:** no ACP or wire change. The desktop pins one module schema version.
