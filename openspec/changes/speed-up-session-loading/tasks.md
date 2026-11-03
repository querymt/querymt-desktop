# Tasks

Desktop half of `speed-up-session-loading`. The agent half (chunked remote sync, windowed snapshot builder, history and tool-content requests, capability flags) is the change of the same name in the `querymt` agent repo (crate `querymt-agent`). Numbering of sections 5 and 6 matches the original combined task list.

## 0. Baseline and coordination

- [ ] 0.1 Extend `session_load_telemetry` (desktop) to record IPC deliveries and log emits per load and wire bytes. Record the desktop baseline for a local session and for a remote session with about 5,000 events on a throttled link in `baseline.md`. The agent-side columns (snapshot bytes, mesh requests) are recorded in the agent change's `baseline.md`.

## 4. Generated types (depends on the agent change)

- [x] 4.6 Update the generated types in the desktop: regenerate `src/lib/querymt/generated/types.ts` from the agent's typeshare output. Verify that `npm run check` passes.

## 5. Desktop windowed loading

- [x] 5.1 `acp-client.ts`: send `loadWindow` on `session/load` and `attachRemoteSession` only when `session_history_window` is advertised; add `sessionHistory` and `toolContent` methods. Verify with tests for advertised and missing flags.
- [x] 5.2 `session-snapshot.ts`: read `history`, `summary` and `truncated`; prefer `summary` for token totals, model, pending inputs and child links when `history.complete` is false. Verify with unit tests for windowed, complete and truncated snapshots.
- [x] 5.3 Store and transcript: load older history on scroll to top, build view items for the returned events only and merge them in front by `eventIndex`; one request in flight, generation-guarded, scroll anchor, no background fetching, reload on `history_changed`. Verify with store tests (no request before the top, ordering, stale-selection drop, scroll-up during a streaming turn keeps live state) and a component test for the anchor.
- [x] 5.4 "Show full output" for truncated results, and full-argument fetch before showing a diff from truncated arguments; keep the prefix and show an error on failure. Verify with component tests for success and not-found.
- [x] 5.5 Show `remote_transfer_failed` as a load error with Retry and `history.stale` as an out-of-date notice. Verify with store and component tests.
- [x] 5.6 Verify that local sessions and remote sessions (load and attach) take the same windowed path, and that the older-agent fallback renders full history.
- [x] 5.7 Add a "windowed load + one older-history page" case to `src/lib/perf` with a budget in `scripts/check-session-load-benchmark.mjs`. Verify that `npm run bench:session-load:ci` passes.

## 6. Raw, coalesced IPC

- [ ] 6.1 Sidecar: switch `attach_stdout_channel` and `commands.rs` to one `Channel<InvokeResponseBody>` with tagged data/status frames, coalescing ready lines up to 256 messages / 256 KiB at message boundaries, and reattach that re-frames buffered whole lines. Verify with Rust tests for framing, limits, immediate single delivery and reattach without loss or duplication.
- [ ] 6.2 Emit agent log summaries once per data frame instead of per line. Verify that log events per load drop with frame count in the 0.1 telemetry.
- [ ] 6.3 `transport-tauri.ts`: normalise payloads to `Uint8Array`, dispatch on the tag, feed data into `ndJsonStream`, report status after data. Verify with JS tests for split messages, multi-message frames, both payload paths, and a large final data frame followed by exit.
- [ ] 6.4 Native WebSocket: forward frame bytes without `to_string()`, replace raw `\r`/`\n` with spaces, coalesce, use the tagged single channel, and route `desktop-native.ts` through a strict line decoder that fails the connection on invalid JSON. Verify with Rust and JS tests for line breaks, malformed messages, and close after a 5 MiB message.
- [ ] 6.5 Benchmark replaying 5,000 notifications plus a 5 MB snapshot through the new framing versus the old. Verify fewer deliveries and less parse time, and add a budget to the benchmark check script.
- [ ] 6.6 Manually verify payloads at the eval/fetch threshold (threshold-1, threshold, threshold+1) and at 5 MiB on WebKit, WebView2 and CEF builds; record results in `baseline.md`.

## 7. WebSocket compression (deferred)

Not part of this change; see design D5. Revisit after 8.2 using the throttled-WAN numbers.

## 8. Integration and measurement

- [ ] 8.1 Run the desktop side of the mixed-version matrix: new desktop with old agent, and old desktop with new agent. Verify that load, attach and history succeed in each, and record results in `baseline.md`. (Agent-side combinations are in the agent change.)
- [ ] 8.2 Re-measure the 0.1 scenarios end to end, together with the agent change's measurements. Verify that IPC deliveries, log emits, wire bytes and load time are lower than the baseline and that a reopen of a remote session shows only new events crossing the mesh in the agent log; record results in `baseline.md`.
- [ ] 8.3 Run `npm run check`, `npx vitest run`, `npm run bench:session-load:ci` and the `src-tauri` tests.

## Workflow follow-up

- Archive this change after implementation and verification and after the agent change is archived, then run `openspec validate` on the archived specs.
