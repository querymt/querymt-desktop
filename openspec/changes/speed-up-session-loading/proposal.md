# Proposal

## Why

Opening a session is slow, and very slow for remote sessions on a poor link. The attach path downloads a remote session's whole history more than once: once to fill the local journal, again (200 events per sequential mesh request) to build the load snapshot, and again when the client connection subscribes. Background-filled history is also pushed to connected clients as live updates. The finished snapshot then reaches the UI as one large JSON message that includes every full tool output and argument. On the desktop, that message is escaped inside another JSON string and parsed twice, both for the local sidecar and for the native WebSocket. Large local sessions pay the same snapshot and IPC costs.

## What Changes

- **Each remote event crosses the mesh once.**
  - The owner serves events in large, size-bounded chunks: one round trip for typical sessions instead of one per 200 events.
  - The background sync becomes the only download; every load, attach and subscription response is built from the local journal, in the owner's order.
  - Filled-in history is stored without being sent to clients as live updates.
  - Reopening a session fetches only the events added since the last sync, even when the attachment is reused.
  - Undo on the owner is detected and the local copy is resynced.
  - Owners that don't support chunks keep working through the existing paged request, remembered per owner.
  - If the owner is unreachable but the requested window is already local, the load succeeds and is marked as possibly out of date; otherwise it fails with a retryable error.
- **Parallel load requests:** runtime status, profile and config options run in parallel, and none of them can fail the load.
- **Recent turns first, for local and remote sessions alike:**
  - A load returns the most recent 20 runs, capped at 1 MiB, plus whole-session state: token totals, cost accounting, delegation state, current model, pending inputs and child-session links.
  - Older history loads only when the user scrolls up, and is merged in front without disturbing live updates.
  - Agents without this capability keep returning the full snapshot.
- **Large tool content is sent truncated:**
  - Tool results and string tool arguments over 32 KiB are sent as a prefix plus a marker.
  - The full content is fetched when the user expands the output or opens a diff.
  - Stored history is never truncated.
- **Desktop IPC:**
  - Agent output reaches the webview as raw newline-delimited JSON bytes, parsed once, on one channel per connection so close and error events always follow earlier data.
  - Messages already waiting are delivered together as one chunk; agent log events are emitted per chunk.
  - This applies to both the sidecar stdout path and the native WebSocket path.
- **Out of scope for now:** WebSocket compression. The current stacks can't negotiate it, and windowing plus truncation already bound load size; it is revisited after measuring (design D8).

Nothing in this list is a breaking change: every protocol addition is advertised by a capability flag or negotiated, and older peers keep the current behaviour.

## Capabilities

### New Capabilities
- `session-history-loading`: how much of a session's history a load returns (a recent window of runs with whole-session state), how older history and full tool content are fetched on demand, and the requirement that local and remote sessions behave identically.
- `remote-session-sync`: how a remote session's events are transferred to the attaching agent: once, in bounded chunks, in the owner's order, without live re-delivery, incrementally on reopen, with rewrite detection, concurrent load-time requests and a fallback for older owners.
- `acp-transport-efficiency`: how ACP traffic reaches the desktop UI: raw single-parse IPC framing, coalescing of queued messages, and status delivered after data.

### Modified Capabilities
None in this repo. The existing `reconnectable-acp-elicitations` and `session-mode-preferences` requirements are unaffected. Agent-repo specs that this change may modify (`remote-stream-relay`, `acp-session-updates`, `llm-cost-accounting`, `session-interactions`) are handled by a companion change in the agent repo (task 0.2).

## Impact

- **Agent (`/Users/wiking/qmt/querymt`, crate `querymt-agent`):**
  - `agent/messages.rs`, `agent/remote/remote_actor_impl.rs`, `agent/session_actor.rs`, `agent/undo.rs`: chunked event-stream message and history epoch.
  - `agent/remote/actor_ref.rs`, `agent/remote/event_backfill.rs`, `event_sink.rs`, `session/sqlite_storage/event_journal.rs`: per-session sync state, persist-only writes, owner-ordered reads, tail-first sync, paged journal reads.
  - `agent/handle/model_registry.rs`, `agent/handle/core.rs`, `agent/handle/remote_connect.rs`, `control/remote.rs`, `acp/shared.rs`, `acp/stdio.rs`: journal-backed snapshot, attach subscription and replay; parallel load requests; usage seeding from the summary.
  - `session/load_snapshot.rs`: windowed snapshot, whole-session summary, truncation.
  - `control/capabilities.rs`: new feature flags. New extension methods `querymt/session/history` and `querymt/session/toolContent`.
- **Desktop (`querymt-desktop`):**
  - `src/lib/domain/session-snapshot.ts`, `src/lib/stores/agents.svelte.ts`: windowed loads, summary-based state, merging older history, full-content fetch, retryable load errors and stale notice.
  - `src/lib/domain/session-tool-diff.ts` and the tool-call UI: full output and full arguments on demand.
  - `src/lib/querymt/acp-client.ts`, `src/lib/querymt/generated/types.ts`: new methods and flags.
  - `src/lib/querymt/transport-tauri.ts`, `src/lib/platform/desktop-native.ts`: raw tagged framing. `embedded-native.ts` is unchanged.
  - `src-tauri/src/sidecar.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/websocket.rs`: raw channels, coalescing, per-frame log emits.
- **Dependencies:** none added or removed.
- **Protocol:**
  - Additive `_meta.querymt.loadWindow` on load and attach requests.
  - New snapshot fields `history`, `summary` and `truncated`.
  - Two new extension methods and errors `remote_transfer_failed`, `history_changed`, `tool_call_not_found`.
  - Capability flags `session_history_window` and `session_tool_content`.
  - A new mesh message, `GetEventStreamChunk`.
- **Rollout:** ship the agent first, then the desktop. Each half works against an older counterpart through the capability checks.
