# Tasks

Groups 1–2 do not depend on querymt. Group 3 onwards needs the `agent-session-core` WASM module (querymt change `add-agent-session-core`): either a published nightly, or a local `dist/` from `scripts/session-core-wasm/build.sh` (design Risks). No task starts `qmtcode` or needs network access.

## 1. Offline benchmark harness and baseline

- [ ] 1.1 Add the seeded lorem generator in `src/lib/perf/lorem/` (mulberry32; snapshot plus live notification stream; markdown, code, diffs, ANSI output, large tool results, compactions, delegations) and point the existing benches at it in place of `session-load-fixture.ts`. Verify: a vitest test shows the same seed produces identical output, and `npm run bench:session-load` still runs.
- [ ] 1.2 Add `src/lib/perf/fake-agent.ts` (in-memory `ndJsonStream` pair plus a scripted responder for `initialize`, `session/list`, `session/load`, `querymt/session/history`, `prompt`) and the offline guard in the perf vitest setup (`fetch`, `WebSocket`, `child_process.spawn` throw). Covers `desktop-session-view` / Benchmarks run offline. Test: `benchmarks_run_offline`, which opens and streams a generated session through the real `DesktopAcpClient`. Verify: `npx vitest run src/lib/perf -t benchmarks_run_offline` passes with networking disabled.
- [ ] 1.3 Add `src/lib/perf/counters.ts` (no-op unless `VITE_PERF_COUNTERS`). Instrument turn presentation, `SessionTurn` render, catalog and sidebar derivations, log state writes, and reducer apply calls. Verify: a unit test shows counters stay zero without the flag and count with it.
- [ ] 1.4 Add scenarios A–E (design D7) as benches, plus counter reports in the JSON output. Extend `scripts/check-session-load-benchmark.mjs` to print counters and the 4x/1x ratio, without gating them yet. Record the current numbers in `openspec/changes/adopt-agent-session-core/baseline.md`. Verify: `npm run bench:session-load:ci` passes and `baseline.md` lists every scenario.

## 2. Agent logs on demand

- [ ] 2.1 Rust: add the subscriber count, the `subscribe_agent_logs` / `unsubscribe_agent_logs` commands, and the 50 ms batched `querymt://agent/logs` emitter in `src-tauri/src/sidecar.rs`. Keep the 200-entry retention. Count batches in `session_load_telemetry`. Covers `desktop-agent-logs` / Log flood with the page closed costs no UI work (native part), Burst arrives in order. Tests: `log_flood_with_the_page_closed_emits_nothing`, `burst_arrives_in_order`. Verify: `cargo test --manifest-path src-tauri/Cargo.toml log_flood_with_the_page_closed burst_arrives_in_order` passes, then `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
- [ ] 2.2 JS: add the `agentLogs` module (on mount: `get_agent_logs` plus subscribe; on destroy: unsubscribe; non-deep 200-entry ring per agent with a version counter) and use it in `src/routes/agents/+page.svelte`. Remove `logsByAgent` and `ensureAgentLogSubscription` from `AgentsStore`, along with their tests. Covers `desktop-agent-logs` / Opening the Agents page shows retained logs, Open page receives new entries, Log flood with the page closed costs no UI work (UI part). Tests named after each scenario in snake_case. Verify: `npx vitest run src/routes/agents src/lib/stores` passes; scenario E reports zero log state writes, and its gate is enabled in the benchmark check.

## 3. Vendored module, loader and controller

- [ ] 3.1 Add `scripts/session-core/update.mjs` (`latest|nightly|vX.Y.Z|--from-dir <path>`, sha256 verification, `--accept-schema`) with node tests for digest mismatch and schema mismatch. Vendor the module, `PIN.json` and `traces/` into `src/lib/session-core/vendor/`, and add `schema.ts`. Verify: `node --test scripts/session-core/*.test.mjs` passes and `vendor/PIN.json` matches the archive digest.
- [ ] 3.2 Add the loader (design D2) for the browser and Vitest, and the `sessionRenderFailure` state with Retry on the session page. Covers `desktop-session-view` / Module fails to load, Schema version mismatch. Tests: `module_fails_to_load`, `schema_version_mismatch`. Verify: `npx vitest run src/lib/session-core -t "module_fails_to_load|schema_version_mismatch"`.
- [ ] 3.3 Add `SessionController` (design D3: queue, rAF chunk flush, ordered flush for other inputs, `$state.raw` header/turnIds/turnsById, `dispose` frees). Verify: controller unit tests cover batching order and a flush that replaces only the reported turns; a test asserts `free()` is called on dispose.
- [ ] 3.4 Route every `AgentsStore` session input through the controller (design D3 table), keeping the effects in the store. Move the active-session tests from `agents.svelte.test.ts` to controller and store-effect tests. Covers `desktop-session-view` / Snapshot and live updates render through one path, Older history merges in front. Tests named after each scenario. Verify: `npx vitest run src/lib/session-core src/lib/stores` passes.
- [ ] 3.4a Make the scripted fake agent send standard ACP compaction updates, and check that the client capabilities stay unchanged. Covers `desktop-session-view` / Compaction renders from standard ACP updates, Initialize advertises compaction support. Tests: `compaction_renders_from_standard_acp_updates` (through the real `DesktopAcpClient` and controller), `initialize_advertises_compaction_support`. Verify: `npx vitest run src/lib/session-core src/lib/querymt -t "compaction_renders_from_standard_acp_updates|initialize_advertises_compaction_support"`.
- [ ] 3.5 Add the differential test (design D8) over the vendored traces and generated sessions, with intentional differences listed. Verify: `npx vitest run src/lib/session-core/differential.test.ts` passes.

## 4. Rendering, cache and debug panel

- [ ] 4.1 Move presentation into `src/lib/session-core/presentation.ts`, memoised per `turnId:revision`. Render keyed turns in `ActiveSessionView` and the turn window. Switch `SessionDelegatesBubble` and the session page to the controller. Covers `desktop-session-view` / Streaming chunk re-renders one turn, Tool update re-renders its turn only, Chunks do not recompute the catalog, Regression fails CI. Tests named after each scenario; gates for scenarios A and D are enabled in the benchmark check. Verify: `npx vitest run src/lib/components src/lib/session-core` passes, and `npm run bench:session-load:ci` passes with the new gates.
- [ ] 4.2 Turn on the 4x/1x ratio gate (≤ 1.5) for scenario A. Covers `desktop-session-view` / Long session streams as fast as a short one. Verify: `npm run bench:session-load:ci` passes and prints the ratio; record the numbers next to the baseline in `baseline.md`.
- [ ] 4.3 Add the 5-entry recent-session cache (design D5) with free on eviction. Covers `desktop-session-view` / Returning to a recent session renders immediately, Sixth session evicts the oldest. Tests named after each scenario; scenario C is recorded. Verify: `npx vitest run src/lib/session-core -t "returning_to_a_recent_session|sixth_session_evicts"`.
- [ ] 4.4 Make the debug events panel read the module's debug log and show the dropped count. Covers `desktop-session-view` / Panel shows dropped count. Test: `panel_shows_dropped_count`. Verify: `npx vitest run src/lib/components/session -t panel_shows_dropped_count`.
- [ ] 4.5 Make the embedded build load the module and render a generated session through the fake agent over its WebSocket transport. Covers `desktop-session-view` / Embedded build renders a session. Test: `embedded_build_renders_a_session`, added to `npm run test:embedded`. Verify: `npm run test:embedded` and `npm run build:embedded` pass, and `build-embedded/` contains the `.wasm` file. Check by hand once that `qmtcode --dashboard` serves it as `application/wasm`; record the result here.

## 5. Remove the TypeScript reducer

- [ ] 5.1 Delete `applySessionNotification`, `reduceSessionReplay`, `appendSessionReplay`, `cloneSession` and their helpers, snapshot hydration, turn building in `session-conversation.ts`, `ActiveSessionViewModel`, `recentSessionUpdateKeys`, `snapshotUserMessageIds`, `reconcileOptimisticUserPrompt`, and the differential test's old-path half (keep its golden-trace assertions against the module). Verify: `rg -n "applySessionNotification|cloneSession|ActiveSessionViewModel" src` returns nothing; `npm run check` passes.
- [ ] 5.2 Regenerate `src/lib/querymt/generated/types.ts` from querymt's `scripts/generate-types.sh` and switch hand-written input and view types to the generated ones. Verify: `npm run check` passes and the file is unedited by hand.

## 6. Integration

- [ ] 6.1 Run `npm run check`, `npx vitest run`, `npm run test:embedded`, `npm run bench:session-load:ci` and the `src-tauri` tests. Verify: all pass; record the results here.
- [ ] 6.2 Manual check on WebKit (macOS), WebView2 and CEF builds: open a large generated session through the fake agent dev route, stream into it, switch sessions, open the Agents page. Verify: no rendering error and the module loads on all three; record the results here.
- [ ] 6.3 Run `openspec validate adopt-agent-session-core --strict`. Verify: exit code 0.

## Workflow follow-up

- Later change: split the rest of `AgentsStore` (catalog, pins, connections, admin areas) now that the session paths have moved out.
