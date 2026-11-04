# Proposal

## Why

Opening a session is slow, and very slow for remote sessions on a poor link. The finished snapshot reaches the UI as one large JSON message that includes every full tool output and argument. On the desktop, that message is escaped inside another JSON string and parsed twice, both for the local sidecar and for the native WebSocket. Large local sessions pay the same snapshot and IPC costs.

This change is the desktop half of the work. The agent half (chunked remote transfer, single download per event, windowed snapshots with whole-session state, tool-content truncation, the `querymt/session/history` and `querymt/session/toolContent` requests) is the `speed-up-session-loading` change in the `querymt` agent repo. This change depends on it and consumes its capability flags.

## What Changes

- **Recent turns first, for local and remote sessions alike:**
  - The desktop asks capable agents for a load window and renders it immediately.
  - Token totals, current model, pending inputs and child-session links come from the load's whole-session state.
  - Older history loads only when the user scrolls up, and is merged in front without disturbing live updates.
  - Agents without the capability keep returning, and the desktop keeps rendering, the full snapshot.
- **Large tool content:**
  - Truncated results show a prefix and "Show full output"; the full content is fetched on request.
  - A diff built from truncated arguments fetches the full arguments first.
- **Load errors:** a retryable remote-transfer failure is shown with Retry; a load marked out of date shows a notice.
- **Desktop IPC:**
  - Agent output reaches the webview as raw newline-delimited JSON bytes, parsed once, on one channel per connection so close and error events always follow earlier data.
  - Messages already waiting are delivered together as one chunk; agent log events are emitted per chunk.
  - This applies to both the sidecar stdout path and the native WebSocket path.
- **Generated types:** update the desktop's generated TypeScript types from the agent's typeshare output.
- **Out of scope for now:** WebSocket compression. The current stacks can't negotiate it, and windowing plus truncation already bound load size; it is revisited after measuring (design D5).

Nothing in this list is a breaking change: the desktop checks capability flags and older agents keep the current behaviour.

## Capabilities

### New Capabilities
- `desktop-session-history`: how the desktop requests windowed loads, loads older history on scroll, fetches full tool content, shows load failures and stale loads, and falls back for older agents.
- `acp-transport-efficiency`: how ACP traffic reaches the desktop UI: raw single-parse IPC framing, coalescing of queued messages, and status delivered after data.

### Modified Capabilities
None in this repo. The existing `reconnectable-acp-elicitations` and `session-mode-preferences` requirements are unaffected. The agent-side capabilities (`session-history-loading`, `remote-session-sync`) and modified agent specs (`acp-session-updates`, `llm-cost-accounting`) are in the agent repo's change.

## Impact

- **Desktop (`querymt-desktop`):**
  - `src/lib/domain/session-snapshot.ts`, `src/lib/stores/agents.svelte.ts`: windowed loads, summary-based state, merging older history, full-content fetch, retryable load errors and stale notice.
  - `src/lib/domain/session-tool-diff.ts` and the tool-call UI: full output and full arguments on demand.
  - `src/lib/querymt/acp-client.ts`, `src/lib/querymt/generated/types.ts`: new methods and flags; types regenerated from the agent.
  - `src/lib/querymt/transport-tauri.ts`, `src/lib/platform/desktop-native.ts`: raw tagged framing. `embedded-native.ts` is unchanged.
  - `src-tauri/src/sidecar.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/websocket.rs`: raw channels, coalescing, per-frame log emits.
- **Dependencies:** none added or removed.
- **Protocol:** consumes `_meta.querymt.loadWindow`, snapshot fields `history`, `summary` and `truncated`, the methods `querymt/session/history` and `querymt/session/toolContent`, the errors `remote_transfer_failed`, `history_changed`, `tool_call_not_found`, and the flags `session_history_window` and `session_tool_content`, all defined in the agent change.
- **Rollout:** the agent ships first, then the desktop. The desktop works against an older agent through the capability checks, and an older desktop works against the new agent because it sends no `loadWindow`.
