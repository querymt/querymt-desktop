# Spec Delta

## Purpose

Defines how the desktop uses the agent's windowed loads: it requests a recent window only from agents that support it, loads older history and full tool content only on demand, reports load failures, and keeps working with agents that lack these capabilities. The agent-side behaviour (windows, summaries, history and tool-content requests, remote sync) is specified by the agent repo's change `speed-up-session-loading`.

## ADDED Requirements

### Requirement: Window requested only from capable agents
The desktop SHALL request a load window on session load and remote attach only from an agent that advertises windowed loading. It SHALL request full tool content only from an agent that advertises that capability.

#### Scenario: Agent advertises windowed loading
- **WHEN** the desktop loads a session from an agent that advertises windowed loading
- **THEN** the load request includes a load window

#### Scenario: Older agent
- **WHEN** the desktop loads a session from an agent that does not advertise windowed loading
- **THEN** the load request has no load window and the desktop renders the full history as before

### Requirement: Windowed load state
When a load reports that older history exists, the desktop SHALL take token totals, the current model, pending inputs and child-session links from the load's whole-session state rather than from the returned events. Totals reported as partial SHALL be treated as approximate.

#### Scenario: Window with older history
- **WHEN** a load returns the recent turns and reports older history
- **THEN** the session's token totals, current model, pending inputs and child links match the whole-session state in the load

#### Scenario: Complete history
- **WHEN** a load reports that no older history exists
- **THEN** the desktop renders the returned events and derives state as before

### Requirement: Desktop loads older history only on scroll
The desktop SHALL render a windowed load immediately and SHALL request older history only when the user scrolls to the top of the loaded transcript. It SHALL NOT fetch older history in the background. Showing older history SHALL NOT discard or alter anything received since the load.

#### Scenario: Opening a long session
- **WHEN** a user opens a session whose load reports older history
- **THEN** the recent turns are shown and no older-history request is made until the user scrolls to the top

#### Scenario: Scrolling up
- **WHEN** the user scrolls to the top of a transcript that has older history
- **THEN** the desktop requests the preceding turns and shows them above the current transcript without moving the visible content

#### Scenario: Scrolling up during a running turn
- **WHEN** the user scrolls to the top while a turn is streaming
- **THEN** the older turns appear above, and the streaming turn and every update received since the load remain as they were

#### Scenario: Selection changes during a request
- **WHEN** the user selects another session while an older-history request is in flight
- **THEN** the result is discarded

### Requirement: Reload when history changed
When an older-history request fails because the session's history was rewritten, the desktop SHALL reload the session.

#### Scenario: Undo since the load
- **WHEN** an older-history request fails with a history-changed error
- **THEN** the desktop reloads the session and shows its current history

### Requirement: Full tool content on demand
The desktop SHALL show truncated tool output with a visible marker and SHALL fetch the complete result when the user expands it. It SHALL fetch the complete arguments before showing a file diff built from truncated arguments. On failure it SHALL keep showing the truncated content with an error message.

#### Scenario: Expanding a truncated tool call
- **WHEN** the user expands a tool call whose result was truncated
- **THEN** the desktop fetches and displays the complete result

#### Scenario: Diff of a large file write
- **WHEN** the user opens the diff of a tool call whose arguments were truncated
- **THEN** the desktop fetches the complete arguments and shows the complete diff

#### Scenario: Unknown tool call
- **WHEN** the full-content request fails because the tool call does not exist
- **THEN** the desktop keeps showing the truncated content with an error message

### Requirement: Load failures and stale loads are shown
The desktop SHALL show a remote-transfer load failure as a load error with an option to retry, and SHALL show a load marked as possibly out of date with a visible notice.

#### Scenario: Owner becomes unreachable mid-transfer
- **WHEN** a load fails with a retryable remote-transfer error
- **THEN** the desktop shows the load error with a Retry action

#### Scenario: Owner offline, window already local
- **WHEN** a load succeeds and is marked possibly out of date
- **THEN** the desktop renders the history and shows an out-of-date notice

### Requirement: Identical behaviour for local and remote sessions
The desktop SHALL use the same windowed path for local sessions and for remote sessions, through both session load and remote attach.

#### Scenario: Remote session load
- **WHEN** the desktop loads or attaches a remote session
- **THEN** it renders the window, loads older history and fetches full content exactly as for a local session
