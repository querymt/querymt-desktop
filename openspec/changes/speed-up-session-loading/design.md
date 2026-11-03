# Design

## Context

See proposal.md (Why) for the motivation and specs/ for the required behaviour. This section lists only the current-state facts that shape the approach.

- **Remote attach downloads history more than once.**
  - `ensure_remote_session_connected` (`agent/handle/remote_connect.rs`) starts `backfill_remote_events` (`agent/remote/event_backfill.rs`). It persists remote events into the local journal from the saved remote sync cursor, 200 events per mesh request (`MAX_EVENT_STREAM_PAGE_SIZE`), as a fire-and-forget task.
  - `build_remote_attach_snapshot` (`agent/handle/model_registry.rs`) separately calls `get_event_stream()`, which pages the whole stream again through `collect_event_stream_pages` (`agent/remote/actor_ref.rs`) and keeps nothing.
  - After `attachSession`, `attach_rpc_session_locked` calls `restore_session_history` (`acp/shared.rs`) for a newly subscribed connection, which calls `get_event_stream()` a third time. `replay_loaded_session` (`acp/stdio.rs`) does the same for clients that don't use snapshots.
- **Persisting remote events publishes them live.** `emit_durable_from_source` (`event_sink.rs`) inserts and then publishes every event to the fanout. `ConnectionDelivery::admit` (`acp/delivery.rs`) passes events older than the live position straight through, so backfilled history reaches connected clients as `session/update`s.
- **Ordering.** `AgentEvent.seq` is the local `stream_seq`, i.e. local insert order. `load_remote_session_stream` (`session/sqlite_storage/event_journal.rs`) returns every row with a source identity regardless of the sync cursor. The desktop sets `eventIndex = event.seq` and sorts the transcript by it (`compareRawItems`, `session-conversation.ts`).
- **Undo deletes events on the owner** (`cleanup_revert_on_prompt`, `agent/undo.rs`). Today this is invisible to other nodes only because every attach re-downloads the full stream.
- **Attachment reuse.** `connect_remote_session` returns early when an existing attachment is reused (`remote_connect.rs`) and does not start a backfill.
- **Timeouts.** The default remote request timeout is 10 s (`remote_mesh.rs`); the history reply timeout is 60 s (`REMOTE_HISTORY_REPLY_TIMEOUT`, `actor_ref.rs`). The desktop maps `retryable` only for prompt errors (`domain/prompt-errors.ts`), not for load errors.
- **Turns.** `launch_prompt` (`session_actor.rs`) emits `RunStarted` (and `QueuedInputStarted`) before the execution emits `UserPromptBlock`s and `PromptReceived`. `PromptReceived` is also emitted inside a running execution (`agent/execution/mod.rs`), so it is not a turn boundary.
- **There are two remote entry points**: `session/load` of a bookmarked session (`agent/handle/core.rs`) and `querymt/remote/attachSession` (`control/remote.rs`). Both call `build_remote_attach_snapshot`, then run `observe_session_runtimes`, `remote_session_profile` (with a 3 s timeout) and `remote_session_config_options` one after another.
- **Local loads** build `querymt/sessionLoadSnapshot.v1` through `load_session_snapshot` / `journal_backed_audit_view` (`session/load_snapshot.rs`) from a full `Vec` of events; journal reads return full vectors. The snapshot already carries a `cursor { local_seq, remote_seq_by_source }`.
- **State the desktop derives from snapshot events:** token totals (`appendHistoricalUsage`, `session-usage.ts`), the model fallback (`getSnapshotProviderChange`), pending inputs (`reconcileInputStatesFromSnapshot`) and child links (`rememberSessionChildren`), all in `stores/agents.svelte.ts`. On the agent, `seed_history_from_meta` seeds the live usage projection from the load meta (`acp/shared.rs`).
- **Other snapshot consumers:** the mobile FFI counts `snapshot.audit.events` and installs its own `AcpSessionHooks` (`querymt-mobile-ffi/src/lib.rs`).
- **Tool content.** Results live in `ToolCallEnd { tool_call_id, result: String, .. }`. File diffs are built from tool *arguments* (`buildWriteFilePatch`, `session-tool-diff.ts`); the result is only checked for a success prefix.
- **Mesh:** messages are msgpack over QUIC with a 50 MiB ceiling (`querymt-remote/src/provider_transport.rs`), registered through `remote_msg_impl!` in `agent/remote/remote_actor_impl.rs`.
- **Desktop IPC (Tauri 2.12.1):**
  - Sidecar stdout goes through `Channel<String>` per line (`src-tauri/src/sidecar.rs`) into `transport-tauri.ts`, which re-encodes it for `ndJsonStream`. Each line is also summarised into an agent log event, and the store copies its 200-entry log array per entry.
  - The native WebSocket path uses `Channel<AcpWebSocketEvent { data: String }>` (`src-tauri/src/websocket.rs`); `desktop-native.ts` calls `JSON.parse(event.data)` and fails the connection on invalid JSON.
  - Tauri delivers small channel payloads by `eval` and large ones by an asynchronous `fetch`. Raw payloads arrive as `ArrayBuffer` on both paths. Order is kept within one channel only (by `index`), not across channels.
  - `attach_stdout_channel`, `drain_session_updates` and `recovery_session_update` support a webview reattaching to a running sidecar.
- **WebSocket stacks:** agent server is axum 0.8 `ws` (tungstenite); desktop native client is tokio-tungstenite 0.30. Neither can negotiate permessage-deflate: tungstenite up to 0.30.0 has no compression feature, and axum `ws` has no extension negotiation. Embedded mode uses the browser `WebSocket`, which already offers it.

## Goals / Non-Goals

**Goals:**
- One code path builds every load response (local, remote load, remote attach, attach subscription) from the local journal, so windowing and truncation are implemented once.
- Every change is additive and negotiated. Mixed agent/desktop versions and mixed mesh versions keep working.

**Non-Goals:**
- Compressing mesh payloads. QUIC traffic stays msgpack-only; reconsider after measuring.
- Batching outgoing desktop writes. Loads send almost nothing.
- Fetching older history eagerly for the desktop. The spec requires loading on scroll. (The agent's own background fill of its journal is not a desktop fetch.)
- Truncating tool content inside the journal or on the mesh.
- Changing the shape of the ACP `session/update` replay for clients that don't use snapshots (only its source changes, see D2).
- Changing embedded-mode transport.
- WebSocket compression. Deferred; see D8.

## Decisions

### D1. One owner-side chunk message replaces paging for sync and history
Add `GetEventStreamChunk { after_source_seq?, before_source_seq?, tail, max_events, max_bytes }`, replying `EventStreamChunk { events, latest_source_seq, history_epoch, has_more }`.
- Limits: 5,000 events / 4 MiB, measured by msgpack-encoded size, always at least one event.
- Backward chunks (`tail: true`) end at `before_source_seq` (or the tip), are returned in ascending order, and start at a turn boundary (D4) when one fits.
- `history_epoch` is an owner-side counter incremented whenever journal events are deleted (undo cleanup). See D3.
- The fallback to `GetEventStreamSince` paging triggers on the transport failure an owner returns for an unregistered message type (exact variant pinned by test 1.3). The attaching agent caches "no chunk support" per owner node for the process lifetime.
- *Alternative considered:* raising `MAX_EVENT_STREAM_PAGE_SIZE`. Rejected: the cap is by count, not size, and it can't fetch tail-first.

### D2. The journal is the single source for every response
`build_remote_attach_snapshot`, `restore_session_history` and `replay_loaded_session` stop calling `get_event_stream()` for remote session refs; they read the local journal after the sync barrier.
1. Connect (or reuse the attachment).
2. Await the **sync barrier**: the requested window (windowed loads) or everything up to the tip observed at sync start (full loads) is covered locally.
3. Build the response with `load_session_snapshot`, exactly as for a local session.

- The barrier is a `watch` on a per-session **sync state** owned by the attaching agent, not by one attachment or one backfill task. A load on a reused attachment triggers an incremental sync chunk (`after = contiguous cursor`) and waits on the same state.
- Transfer budget: 60 s (aligned with `REMOTE_HISTORY_REPLY_TIMEOUT`), configurable. On expiry the load fails with a typed `remote_transfer_failed` error carrying `retryable: true`.
- **Owner unreachable:** if the requested window is already covered locally, the load is served from the journal with `history.stale: true` in the snapshot; otherwise it fails as above.
- **Window barrier:** the load reads the journal's recent window and checks that it lies inside one contiguous covered range that either reaches `source_seq` 1 or is not exhausted by the window. Otherwise it fetches the next older chunk below that range (at most one chunk of events per step) and re-reads, so a window never spans an uncovered gap and `history.complete` is only reported when coverage reaches the start.
- **Partial summary:** a windowed remote load answers once the window is local, while older history may still be filling. The whole-session summary then covers only the events held locally and is reported with `summary.usage.partial = true` (also set when the session has any history that is not yet local). The desktop treats partial totals as approximate; a later load after the fill reports exact values. *Alternatives considered:* waiting for the full fill (loses "answer when the window is local"), or an owner-side summary request (a new mesh message; revisit if partial totals prove confusing).
- *Alternative considered:* keep an in-memory snapshot fed by the same transfer. Rejected: it duplicates windowing and truncation and loses incremental reopen.

### D3. Tail-first sync with a range set, persist-only, epoch-checked
- **Coverage:** the sync state tracks covered `source_seq` ranges (a range set persisted next to the existing remote sync cursor). The cursor remains "highest contiguous `source_seq` from 1".
- **First windowed open:** request one backward chunk sized to the window, persist it, mark its range covered, release the barrier; then fill forward from the cursor, skipping covered ranges.
- **On-demand older history:** if the requested range is not covered, fetch exactly the uncovered sub-ranges with backward chunks. Fill and on-demand fetches reserve ranges in the sync state before requesting, so the same range is never transferred twice concurrently.
- **Persist-only:** historical chunks are written through a new `persist_durable_from_source` path that deduplicates by `(source_node, source_seq)` like `emit_durable_from_source` but does **not** publish to the fanout. The live relay and gap repair (`recover_source_gap`) keep publishing.
- **Ordering:** reads of remote-origin rows order by `source_seq` and return only covered ranges. The snapshot's per-event `seq` carries the **history position** (`source_seq` for remote sessions, `stream_seq` for local ones), so the desktop's existing `eventIndex` ordering is correct. The snapshot `cursor` keeps its current meaning.
- **Rewritten history:** every chunk reply carries `history_epoch`. If it differs from the stored epoch, the attaching agent deletes that source's local rows and coverage, resets the cursor to 0, and resyncs (tail-first if windowed) before releasing the barrier.
- *Alternative considered:* forward-only sync with a barrier at the tip. Rejected: it fails "recent events first" for long sessions.

### D4. Windowing, whole-session summary and truncation in the snapshot builder
`load_session_snapshot` gains `LoadWindow { max_turns: 20, max_bytes: 1 MiB, truncate_bytes: 32 KiB }`.
- **Turns:** a turn starts at `RunStarted` (including any `QueuedInputStarted`, `UserPromptBlock` and `PromptReceived` that follow it) and runs until the next `RunStarted`. For legacy history without run events, a turn starts at a `UserPromptBlock`/`PromptReceived` that is not inside a run. The same function is used by D1 chunk boundaries.
- **Window selection:** a backward, paged journal read by history position, stopping when either limit is reached and always keeping one complete turn. Size is the JSON-encoded size of events after truncation.
- **Streaming reads:** add a paged read (`load_session_stream_page(session, before/after, limit)`) to every `EventJournal` implementation; the builder never materialises the full event vector.
- **Whole-session summary:** one streaming pass over the journal feeds the accounting reducer, `delegation_updates_from_events`, and a new summary reducer producing `summary { usage: { latestRequest, sessionTotals, partial }, provider: { provider, model, node? }, pendingInputs, childSessions }`. The agent seeds its live usage projection (`seed_history_from_meta`) from `summary.usage` when present.
- **Truncation:** `ToolCallEnd.result` and string values in tool-call arguments (`ToolCallStart` and related events) longer than 32 KiB are replaced with a UTF-8-safe prefix, and the snapshot gains `truncated: [{ tool_call_id, part: "result" | "arguments", path?, full_bytes }]`. The event schema and journal are unchanged.
- **History position:** the snapshot gains `history: { complete, before?, stale? }`, where `before` is an opaque token encoding the position and the history epoch.
- **Older history:** `querymt/session/history { sessionId, before }` uses the same walker and truncation and returns `{ events, history, truncated }` (no summary). A token whose epoch no longer matches fails with `history_changed`.
- **Full content:** `querymt/session/toolContent { sessionId, toolCallId, part }` returns the complete result or arguments, found by a bounded scan of the session's tool events (benchmarked on 50k events; add an index only if the benchmark fails).
- **Compatibility:** without `loadWindow`, the builder returns exactly today's snapshot. The audit view's other fields (tasks, decisions, intent snapshots, progress entries) stay whole-session. The mobile FFI keeps working because it does not send `loadWindow`.
- *Alternative considered:* windowing in the desktop after a full load. Rejected: it saves no transfer.

### D5. Requests and capability flags
- **Desktop request:** `_meta.querymt.loadWindow: { maxTurns: 20, maxBytes: 1048576, truncateBytes: 32768 }` on `session/load` and `remote/attachSession` (extending `AttachRemoteSessionRequest`).
- **Agent:** clamps each value to its own maximum.
- **Capability flags:** `features.session_history_window` covers `loadWindow`, the summary and `session/history`; `features.session_tool_content` covers `querymt/session/toolContent`.
- **Errors:** `remote_transfer_failed` (retryable), `history_changed`, `session_not_found`, `tool_call_not_found`.

### D6. Desktop: render the window, merge older history in front
- `session-snapshot.ts` reads `history`, `summary` and `truncated`. When `history.complete` is false, token totals, the current model, pending inputs and child links come from `summary` instead of events.
- On reaching the top of the transcript, the store calls `session/history` and builds view items for **only the returned events** with the snapshot reducer, then merges them in front of the existing transcript, tool calls and events by `eventIndex`. Live state (streaming turn, optimistic messages, captured updates) is untouched.
- A scroll anchor preserves the visible content. One request is in flight per session; a stale selection generation drops the result. `history_changed` triggers a session reload.
- Truncated results show the prefix plus "Show full output" (`toolContent` with `part: "result"`). Opening a diff whose arguments are truncated first fetches `part: "arguments"`.
- `remote_transfer_failed` is shown as a load error with Retry; `history.stale` shows a "may be out of date" notice.
- *Alternative considered:* rebuilding the whole conversation from the snapshot events plus the prepended page. Rejected: it discards updates received since the load.

### D7. Raw NDJSON IPC on one channel per connection
Both Tauri paths switch to a single `Channel<InvokeResponseBody>` carrying `Raw(bytes)` frames. The first byte tags the frame: `0` = data (one or more `\n`-terminated compact JSON messages), `1` = status (a small JSON close/error event). Because data and status share one channel, Tauri's per-channel `index` ordering guarantees status is delivered after all earlier data, whichever of `eval`/`fetch` carries each frame.

**Rust side:**
- After reading one message, drain messages that are already ready (`try_recv` / `now_or_never`), up to 256 messages or 256 KiB, then send one data frame. A frame always ends at a message boundary.
- Stdout lines keep today's per-line UTF-8 handling. WebSocket text frames have raw `\r`/`\n` replaced by spaces (only valid as JSON whitespace) and a terminator appended; frame `Bytes` are forwarded without `to_string()`.
- Reattach: the recovery buffer stores whole lines; a newly attached channel receives buffered lines as fresh frames, and no frame spans a detach.
- Agent log summaries are emitted once per data frame (count plus a bounded sample), not per line.

**JS side:**
- One helper normalises the payload to `Uint8Array` (accepting `ArrayBuffer`, typed arrays, and defensively `number[]`) and dispatches on the tag.
- Sidecar: data bytes feed the existing `ndJsonStream` input.
- Native WebSocket: data bytes feed a strict line decoder that fails the connection on invalid JSON, preserving today's behaviour.
- `embedded-native.ts` is unchanged.

*Alternatives considered:* a separate status channel (rejected: cross-channel ordering is not guaranteed when large data goes through `fetch`); parsing to `serde_json::Value` in Rust (rejected: it adds work without removing the JS parse).

### D8. WebSocket compression deferred
Compression is out of scope for this change. The WebSocket stacks on both ends stay as they are.
- **Why:** the pinned stacks can't negotiate permessage-deflate, so compression would mean replacing both (`yawc` 0.5: very new, single owner, MPL-2.0, and a hyper bump in the desktop) or adding application-level compression of large messages. Windowing and truncation (D4) already shrink load responses to about 1 MiB, which removes most of the payload compression was meant to reduce.
- **Revisit:** after the throttled-WAN measurements (tasks 0.1 and 8.2). If remote loads are still slow, prefer compressing large messages inside the protocol for clients that advertise support (`flate2`/`zstd` are already agent dependencies) over swapping the WebSocket library. If compression is added later, it must not rely on loopback detection (tunnelled remote agents look local) and must not carry compression context between messages.

## Risks / Trade-offs

- **[Sync barrier stalls a load on a slow owner]** → Waits only for the window (D3) within a 60 s budget; fails with a retryable typed error the desktop shows with Retry; an already-local window is served stale when the owner is offline.
- **[Out-of-order persistence exposes gaps]** → Reads return covered ranges only, ordered by `source_seq`; the cursor never jumps a gap; tests interrupt between tail chunk and fill.
- **[Epoch resync costs a full transfer]** → Only after a history rewrite on the owner; windowed loads still resync tail-first.
- **[Window walk is expensive on very large journals]** → Paged backward reads with `LIMIT`; streaming summary pass; 50k-event benchmark in the agent tests.
- **[Truncation hides content consumers need]** → Explicit markers; full result one click away; diffs fetch full arguments before rendering.
- **[Tauri raw channel differences across WebKit, WebView2 and CEF]** → One normalising helper; tests at the eval/fetch threshold boundary and at 5 MiB on all three.
- **[Remote WAN loads stay uncompressed]** → Accepted for now; windowing and truncation bound load size, and D8 records how to revisit.
- **[Mixed versions]** → All additions capability-gated; mesh fallback cached per owner. The matrix covers desktop↔agent, agent↔owner, stdio/non-snapshot clients and mobile.

## Migration Plan

1. Ship the agent first. Without `loadWindow` it returns full snapshots.
2. Ship the desktop next. It detects the capability flags and falls back when they are missing.
3. **Rollback:**
   - Desktop: drop `loadWindow` or the raw framing independently.
   - Agent: the chunk message and new methods are additive; the barrier can be bypassed by restoring the old `build_remote_attach_snapshot`.
   - Journal: the only addition is the coverage/epoch table, which older agents ignore. An older agent reading a journal with uncovered gaps shows them until its own backfill (from the unchanged contiguous cursor) fills them; tested in 8.1.

## Open Questions

- Should full-content requests support byte ranges for multi-hundred-MB results? Deferred; can be added without changing the spec.
- The agent repo's own specs (`remote-stream-relay`, `acp-session-updates`, `llm-cost-accounting`, `session-interactions`) may need MODIFIED deltas for D2/D3/D4. They are tracked by a companion change in the agent repo (task 0.2).
