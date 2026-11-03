# Design

## Context

See proposal.md (Why) for the motivation and specs/ for the required behaviour. The agent change `speed-up-session-loading` (in the `querymt` agent repo) holds the server side: chunked remote transfer, the journal-backed windowed snapshot, truncation, the `querymt/session/history` and `querymt/session/toolContent` requests and the capability flags (its D1-D5). This document covers the desktop only. This section lists the current-state facts that shape the approach.

- **Position ordering.** The desktop sets `eventIndex = event.seq` and sorts the transcript by it (`compareRawItems`, `session-conversation.ts`). The agent's snapshot now carries the history position in `seq` (agent D3).
- **Load errors.** The desktop maps `retryable` only for prompt errors (`domain/prompt-errors.ts`), not for load errors.
- **State the desktop derives from snapshot events:** token totals (`appendHistoricalUsage`, `session-usage.ts`), the model fallback (`getSnapshotProviderChange`), pending inputs (`reconcileInputStatesFromSnapshot`) and child links (`rememberSessionChildren`), all in `stores/agents.svelte.ts`.
- **Tool content.** File diffs are built from tool *arguments* (`buildWriteFilePatch`, `session-tool-diff.ts`); the result is only checked for a success prefix.
- **Desktop IPC (Tauri 2.12.1):**
  - Sidecar stdout goes through `Channel<String>` per line (`src-tauri/src/sidecar.rs`) into `transport-tauri.ts`, which re-encodes it for `ndJsonStream`. Each line is also summarised into an agent log event, and the store copies its 200-entry log array per entry.
  - The native WebSocket path uses `Channel<AcpWebSocketEvent { data: String }>` (`src-tauri/src/websocket.rs`); `desktop-native.ts` calls `JSON.parse(event.data)` and fails the connection on invalid JSON.
  - Tauri delivers small channel payloads by `eval` and large ones by an asynchronous `fetch`. Raw payloads arrive as `ArrayBuffer` on both paths. Order is kept within one channel only (by `index`), not across channels.
  - `attach_stdout_channel`, `drain_session_updates` and `recovery_session_update` support a webview reattaching to a running sidecar.
- **WebSocket stacks:** agent server is axum 0.8 `ws` (tungstenite); desktop native client is tokio-tungstenite 0.30. Neither can negotiate permessage-deflate: tungstenite up to 0.30.0 has no compression feature, and axum `ws` has no extension negotiation. Embedded mode uses the browser `WebSocket`, which already offers it.

## Goals / Non-Goals

**Goals:**
- Local and remote sessions take one windowed load path in the desktop.
- Every change is additive and negotiated. Older agents keep working with the desktop, and older desktops keep working with the new agent.

**Non-Goals:**
- Fetching older history eagerly. The spec requires loading on scroll.
- Batching outgoing desktop writes. Loads send almost nothing.
- Changing embedded-mode transport.
- WebSocket compression. Deferred; see D5.
- Server behaviour (windowing, truncation, remote sync). These belong to the agent change.

## Decisions

### D1. Request a window only when advertised
`acp-client.ts` sends `_meta.querymt.loadWindow: { maxTurns: 20, maxBytes: 1048576, truncateBytes: 32768 }` on `session/load` and `remote/attachSession` only when `features.session_history_window` is advertised. `sessionHistory` and `toolContent` methods are used only when the matching flags (`session_history_window`, `session_tool_content`) are advertised. The agent clamps the values (agent D5).

### D2. Render the window, merge older history in front
- `session-snapshot.ts` reads `history`, `summary` and `truncated`. When `history.complete` is false, token totals, the current model, pending inputs and child links come from `summary` instead of events. Partial totals (`summary.usage.partial`) are treated as approximate.
- On reaching the top of the transcript, the store calls `session/history` and builds view items for **only the returned events** with the snapshot reducer, then merges them in front of the existing transcript, tool calls and events by `eventIndex`. Live state (streaming turn, optimistic messages, captured updates) is untouched.
- A scroll anchor preserves the visible content. One request is in flight per session; a stale selection generation drops the result. `history_changed` triggers a session reload.
- Truncated results show the prefix plus "Show full output" (`toolContent` with `part: "result"`). Opening a diff whose arguments are truncated first fetches `part: "arguments"`; on failure the prefix stays and an error is shown.
- `remote_transfer_failed` is shown as a load error with Retry; `history.stale` shows a "may be out of date" notice.
- *Alternative considered:* rebuilding the whole conversation from the snapshot events plus the prepended page. Rejected: it discards updates received since the load.

### D3. Generated types come from the agent
The agent exports the new types through typeshare. The desktop regenerates `src/lib/querymt/generated/types.ts` from that output and checks it with `npm run check`. The file is never edited by hand.

### D4. Raw NDJSON IPC on one channel per connection
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

### D5. WebSocket compression deferred
Compression is out of scope for this change. The WebSocket stacks on both ends stay as they are.
- **Why:** the pinned stacks can't negotiate permessage-deflate, so compression would mean replacing both (`yawc` 0.5: very new, single owner, MPL-2.0, and a hyper bump in the desktop) or adding application-level compression of large messages. Windowing and truncation (agent D4) already shrink load responses to about 1 MiB, which removes most of the payload compression was meant to reduce.
- **Revisit:** after the throttled-WAN measurements (tasks 0.1 and 8.2). If remote loads are still slow, prefer compressing large messages inside the protocol for clients that advertise support (`flate2`/`zstd` are already agent dependencies) over swapping the WebSocket library. If compression is added later, it must not rely on loopback detection (tunnelled remote agents look local) and must not carry compression context between messages.

## Risks / Trade-offs

- **[Tauri raw channel differences across WebKit, WebView2 and CEF]** → One normalising helper; tests at the eval/fetch threshold boundary and at 5 MiB on all three.
- **[Partial totals look wrong]** → Treated as approximate; a later load after the agent's fill reports exact values.
- **[Remote WAN loads stay uncompressed]** → Accepted for now; windowing and truncation bound load size, and D5 records how to revisit.
- **[Mixed versions]** → All additions capability-gated. The matrix (task 8.1) covers new desktop with old agent and old desktop with new agent; the agent change covers agent-to-owner, stdio and mobile.

## Migration Plan

1. The agent ships first. Without `loadWindow` it returns full snapshots.
2. The desktop ships next. It detects the capability flags and falls back when they are missing.
3. **Rollback:** drop `loadWindow` or the raw framing independently.

## Open Questions

- Should full-content requests support byte ranges for multi-hundred-MB results? Deferred; can be added without changing the spec (tracked in the agent change).
