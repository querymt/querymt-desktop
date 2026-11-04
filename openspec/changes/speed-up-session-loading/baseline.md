# Baseline (desktop side, task 0.1)

Status: instrumentation is in place; the baseline numbers below have NOT been measured yet. Agent-side metrics (snapshot bytes, snapshot events, mesh requests per load and attach) are recorded in the agent change's `baseline.md`.

## Where each metric comes from

| Metric | Source |
| --- | --- |
| IPC deliveries per load | desktop span `session.load.ipc_delivery_count` |
| Log emits per load | desktop span `session.load.log_emit_count` |
| Wire bytes | desktop span `session.load.wire_bytes` (bytes of agent output sent to the webview) |
| Snapshot bytes (cross-check) | desktop span `session.load.snapshot_bytes` |
| Snapshot events (cross-check) | desktop `snapshotEvents` |

Counters are process-wide and reported as the delta over one load, so measure one session at a time.

## Scenarios to record

1. Local session (existing, large history).
2. Remote session with about 5,000 events, over a throttled link (for example 5 Mbit/s, 100 ms RTT).

| Scenario | Snapshot bytes | Snapshot events | IPC deliveries | Log emits | Wire bytes | Load time |
| --- | --- | --- | --- | --- | --- | --- |
| Local | not measured | not measured | not measured | not measured | not measured | not measured |
| Remote ~5,000 events, throttled | not measured | not measured | not measured | not measured | not measured | not measured |

## Mixed-version matrix (task 8.1)

| Combination | Load | Attach | History | Notes |
| --- | --- | --- | --- | --- |
| New desktop, old agent | not run | not run | not run | |
| Old desktop, new agent | not run | not run | not run | |

## Payload thresholds (task 6.6)

| Webview | threshold-1 | threshold | threshold+1 | 5 MiB |
| --- | --- | --- | --- | --- |
| WebKit | not run | not run | not run | not run |
| WebView2 | not run | not run | not run | not run |
| CEF | not run | not run | not run | not run |
