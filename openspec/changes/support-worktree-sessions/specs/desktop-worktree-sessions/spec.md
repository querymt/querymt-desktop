# Spec Delta

## Purpose

Defines how the desktop lets users create sessions in managed Git worktrees, see which sessions are isolated and where they came from, hand a worktree off to a fresh conversation, and view sessions whose worktree was handed off.

## ADDED Requirements

### Requirement: Worktree features follow agent capability
The desktop SHALL offer worktree creation only when the agent advertises workspace support. It SHALL offer handoff only when the agent advertises handoff, and the optional summary only when the agent advertises summary support. Against an agent without these capabilities, the desktop SHALL show no worktree controls and SHALL behave as before.

#### Scenario: Agent without workspace support
- **WHEN** the connected agent does not advertise `_meta.querymt.workspace.supported`
- **THEN** the composer shows no Workspace option and session menus show no worktree actions

#### Scenario: Agent with creation but without handoff
- **WHEN** the agent advertises workspace support but not handoff
- **THEN** worktree creation is offered and the handoff action is not

### Requirement: Choose a worktree when starting a session
The launch composer SHALL offer a Workspace choice of Local checkout, New worktree, or New worktree with local changes for the local target. A worktree choice SHALL be sent as `_meta.querymt.sessionWorkspace` on `session/new`. Local checkout SHALL send no workspace metadata.

#### Scenario: Start a session in a new worktree
- **WHEN** the user selects New worktree and starts a session
- **THEN** the desktop requests `{ execution: "worktree" }` and opens the created session, which shows the worktree branch

#### Scenario: Include local changes
- **WHEN** the user selects New worktree with local changes
- **THEN** the request includes `includeLocalChanges: true`

#### Scenario: Remote target selected
- **WHEN** the composer target is a remote mesh node
- **THEN** the Workspace choice is not offered and no workspace metadata is sent

### Requirement: Create a worktree session from an existing session
For a local session on a supporting agent, the desktop SHALL offer a "New worktree session" action. The action SHALL accept an optional name, and either an optional base ref or "include local changes" but not both. It SHALL create the session through `querymt/worktree/create`, passing the source session when the agent supports lineage, and SHALL open the created session. The source session SHALL be unchanged.

#### Scenario: Create and open
- **WHEN** the user confirms the dialog from session S
- **THEN** a new session is created with S as its source, the desktop navigates to it, and S remains listed and unchanged

#### Scenario: Conflicting options
- **WHEN** the user enters a base ref and enables include local changes
- **THEN** the dialog prevents submission and explains that the options are exclusive

### Requirement: Hand off a worktree to a fresh conversation
For a session that owns a worktree on an agent that supports handoff, the desktop SHALL offer a "Hand off worktree" action. The action SHALL start a new session in the same checkout through `querymt/worktree/handoff` and open it. The new session SHALL start clean unless the user explicitly enables "Start with a summary".

#### Scenario: Clean handoff by default
- **WHEN** the user confirms the handoff dialog without changing options
- **THEN** the request omits the summary option or sets it to false, and the desktop opens the new session

#### Scenario: Handoff with summary
- **WHEN** the agent supports summaries and the user enables "Start with a summary"
- **THEN** the request includes `summary: true` and the dialog stays pending until the agent responds

#### Scenario: Owner still active
- **WHEN** the agent refuses with `owner_active`
- **THEN** the dialog stays open and explains that running work must stop before handing off

### Requirement: Isolated sessions are grouped under their source project
The desktop SHALL place a session in the workspace group of its worktree's source cwd when the agent provides one, and otherwise in the group of its cwd. The session's execution cwd SHALL remain what the desktop shows as the session's path.

#### Scenario: Worktree session in the sidebar
- **WHEN** a listed session reports `workspace.sourceCwd = /p/app` and `cwd = ~/.qmt/worktrees/app/ws_1`
- **THEN** it appears in the `/p/app` group, and its header path is the checkout path

### Requirement: Worktree sessions are visibly marked
The desktop SHALL mark every session that runs in a managed worktree with its branch, and SHALL show its checkout path and baseline on hover and in session details. Sessions with `forkOrigin: "worktree"` SHALL show a Worktree relationship marker distinct from forks and delegates. Sessions whose worktree was handed off SHALL show a Handed off marker. A non-ready worktree lifecycle (for example archived, missing, or failed) SHALL be shown.

#### Scenario: Worktree child row
- **WHEN** a listed session has `forkOrigin: "worktree"` and workspace branch `qmt/ws_1`
- **THEN** its row shows a Worktree marker and a `qmt/ws_1` branch marker

#### Scenario: Missing checkout
- **WHEN** a session's workspace lifecycle is `missing`
- **THEN** the branch marker indicates the checkout is missing

### Requirement: Session children can be expanded in place
A session row with forks or worktree children SHALL offer an expand control. The control SHALL load and show the session's direct children nested beneath it, each with its relationship marker. Only rows whose `parentSessionId` matches SHALL be shown as children. Delegated children SHALL NOT be shown.

#### Scenario: Expand a parent
- **WHEN** the user expands a session with one fork and one worktree child
- **THEN** both children appear indented under it with Fork and Worktree markers

#### Scenario: Agent ignores the children filter
- **WHEN** the children response contains sessions with a different parent
- **THEN** those sessions are not shown under the expanded row

### Requirement: Handed-off and archived sessions are read-only
When the agent reports a loaded session as read-only (`owner_transferred` or `workspace_archived`), the desktop SHALL show its history, replace the composer with a notice worded for the reason, and hide actions that would run or change the session. A prompt rejected with either code SHALL put the session into the same state.

#### Scenario: Open a previous owner
- **WHEN** the user opens a session whose load response has `sessionAccess.mode = "read_only"`
- **THEN** the transcript is shown, no composer is shown, and a link opens the owner session

#### Scenario: Handoff happens elsewhere
- **WHEN** a prompt fails with code `owner_transferred`
- **THEN** the session switches to the read-only presentation without losing the transcript

#### Scenario: Open a session whose worktree was archived
- **WHEN** the user opens a session whose load response has `sessionAccess = { mode: "read_only", reason: "workspace_archived" }`
- **THEN** the transcript is shown, no composer is shown, the notice says the worktree was archived, no owner link is offered, and the list row shows an *Archived* badge instead of *Handed off*

#### Scenario: Unknown read-only reason
- **WHEN** the load response has `sessionAccess.mode = "read_only"` with a reason the desktop does not know
- **THEN** the read-only presentation is kept with a generic notice

#### Scenario: Archive happens elsewhere
- **WHEN** a prompt fails with code `workspace_archived`
- **THEN** the session switches to the read-only presentation without losing the transcript or the rejected prompt text
