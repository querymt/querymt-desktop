# Baseline (task 0.1)

Status: instrumentation is in place; the baseline numbers below have NOT been measured yet.

## Where each metric comes from

| Metric | Source |
| --- | --- |
| Snapshot bytes | desktop span `session.load.snapshot_bytes`; agent log `session load telemetry: ... snapshot_bytes=` |
| Snapshot events | desktop `snapshotEvents`; agent log `snapshot_events=` |
| Mesh requests per load/attach | agent log `mesh_requests=` / `mesh_events=` (kind `local_load` or `remote_attach`) |
| IPC deliveries per load | desktop span `session.load.ipc_delivery_count` |
| Log emits per load | desktop span `session.load.log_emit_count` |
| Wire bytes | desktop span `session.load.wire_bytes` (bytes of agent output sent to the webview) |

Counters are process-wide and reported as the delta over one load, so measure one session at a time.
Agent `mesh_requests` counts `GetEventStreamSince` and `GetEventStreamChunk` replies that crossed the mesh.
Note: `mesh_requests` for a `session/load` of a bookmarked remote session is logged only for the snapshot build; the background backfill and the attach-subscription replay are separate requests and show in the cumulative counters of the following load.

## Scenarios to record

1. Local session (existing, large history).
2. Remote session with about 5,000 events, over a throttled link (for example 5 Mbit/s, 100 ms RTT).

| Scenario | Snapshot bytes | Snapshot events | Mesh requests | IPC deliveries | Log emits | Wire bytes | Load time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Local | not measured | not measured | n/a | not measured | not measured | not measured | not measured |
| Remote ~5,000 events, throttled | not measured | not measured | not measured | not measured | not measured | not measured | not measured |
