# Spec Delta

## Purpose

Defines how the desktop turns agent session output into the rendered conversation: which parts update on a change, how it stays responsive in long sessions, how session switching and the debug panel behave, and how performance is checked without a live backend.

## ADDED Requirements

### Requirement: Single session reducer
The desktop SHALL derive every session's conversation, tool calls, usage, run state, pending inputs and history paging only from the agent-session-core module, for snapshot loads, live updates, older-history pages and client observations alike.

#### Scenario: Snapshot and live updates render through one path
- **WHEN** a session is opened from a load snapshot and then receives live updates
- **THEN** the rendered turns equal those the module reports for the same inputs

#### Scenario: Older history merges in front
- **WHEN** the user scrolls to the top of a windowed session and an older-history page arrives
- **THEN** the older turns appear above the existing ones, the visible content keeps its position, and a turn still streaming keeps its text

### Requirement: ACP remains the agent protocol
The desktop SHALL exchange only standard ACP messages with agents and SHALL keep advertising the standard `session.compaction` client capability. Context compaction SHALL be shown from the standard ACP `compaction_update` and `compaction_summary_chunk` session updates.

#### Scenario: Compaction renders from standard ACP updates
- **WHEN** the scripted agent sends a `compaction_update` with status `in_progress`, two `compaction_summary_chunk` updates and a `compaction_update` with status `completed` for the same `compactionId`
- **THEN** the conversation shows one completed compaction boundary with the two summary blocks in order

#### Scenario: Initialize advertises compaction support
- **WHEN** the desktop initializes an ACP connection
- **THEN** the `initialize` request's client capabilities contain `session.compaction` as `{}`

### Requirement: Only changed turns re-render
A live update SHALL re-render only the turns the module reports as changed. Unchanged turns SHALL keep their rendered output and SHALL NOT recompute markdown or diffs.

#### Scenario: Streaming chunk re-renders one turn
- **WHEN** a text chunk arrives for the last turn of a 500-turn session
- **THEN** exactly one turn component re-renders and no other turn recomputes its HTML

#### Scenario: Tool update re-renders its turn only
- **WHEN** a tool call update arrives for a tool in the last turn
- **THEN** only that turn re-renders

### Requirement: Update cost independent of session length
The work done per live update SHALL NOT grow with the number of turns already in the session.

#### Scenario: Long session streams as fast as a short one
- **WHEN** 2,000 generated updates are streamed into a session at 1x and at 4x history size
- **THEN** the mean time per update at 4x is at most 1.5 times the mean at 1x

### Requirement: Streaming does not disturb the rest of the UI
Live updates for the open session SHALL NOT recompute the session catalog, sidebar or other sessions' summaries, except when the update changes summary fields (title, activity time, status).

#### Scenario: Chunks do not recompute the catalog
- **WHEN** 1,000 text chunks stream into the open session
- **THEN** the session catalog and sidebar recompute zero times

### Requirement: Fast session switching
The desktop SHALL keep the 5 most recently viewed sessions in memory. Returning to one of them SHALL render its last known state at once and then refresh it from the agent.

#### Scenario: Returning to a recent session renders immediately
- **WHEN** the user opens session A, then B, then returns to A
- **THEN** A's turns render before any load request for A completes, and A is refreshed afterwards

#### Scenario: Sixth session evicts the oldest
- **WHEN** the user views six different sessions in turn
- **THEN** the first viewed session is no longer kept in memory and reopening it loads it from the agent

### Requirement: Bounded debug events panel
The debug events panel SHALL show the newest 1,000 session events and the number of older events dropped.

#### Scenario: Panel shows dropped count
- **WHEN** a session has received 1,500 events and the user opens the debug events panel
- **THEN** the panel lists 1,000 events and states that 500 older events are not shown

### Requirement: Reducer module load failure
If the session-core module cannot be loaded or reports an unsupported schema version, the desktop SHALL show a session error explaining that session rendering is unavailable, with a Retry action, and SHALL NOT show a partial or stale conversation as current.

#### Scenario: Module fails to load
- **WHEN** the module file is missing or fails to instantiate and the user opens a session
- **THEN** the session area shows the rendering error with Retry instead of a transcript

#### Scenario: Schema version mismatch
- **WHEN** the loaded module reports a schema version other than the one the desktop was built for
- **THEN** the same error is shown and no inputs are applied

### Requirement: Same behaviour in the embedded build
The embedded web UI SHALL load the same module and render sessions identically to the desktop build.

#### Scenario: Embedded build renders a session
- **WHEN** the embedded build opens a session from a generated snapshot through its WebSocket transport
- **THEN** the rendered turns equal those of the desktop build for the same inputs

### Requirement: Backend-free performance checks
Session performance checks SHALL run on seeded generated sessions and a scripted in-memory agent, without starting `qmtcode` or opening network connections, and CI SHALL fail when a work counter exceeds its limit or a scaling ratio exceeds its bound.

#### Scenario: Benchmarks run offline
- **WHEN** the session performance suite runs on a machine with networking disabled and no `qmtcode` installed
- **THEN** every scenario completes and reports its counters and timings

#### Scenario: Regression fails CI
- **WHEN** a change makes a streaming chunk re-render more than one turn
- **THEN** the performance check fails and names the exceeded counter
