# Design

## Context

See `proposal.md` for motivation and `specs/desktop-worktree-sessions/spec.md` for observable behavior.

The agent already supports managed worktree sessions (`add-git-worktree-isolation`): `session/new` accepts `_meta.querymt.sessionWorkspace`, `initialize` advertises `agentCapabilities._meta.querymt.workspace`, and `querymt/worktree/*` extension methods exist. That change is being amended (agent side) with source-cwd grouping, `forkOrigin: "worktree"` lineage, worktree details on list/load, and ownership handoff. The desktop builds against the contract below and gates every feature on it, so it can ship before or after the agent amendment.

Today the desktop:

- groups sessions by `SessionInfo.cwd` (`groupSessionsByWorkspace`, `AgentsStore.updateWorkspaceDiscovery` / `upsertWorkspaceSessions`), which for an isolated session is the checkout under the worktree storage root;
- lists root sessions only (`session_scope: "root"`), so forks are only visible as a `forkCount` badge;
- knows `forkOrigin` values `user` and `delegation`.

## Wire contract (agent amendment)

All additions are additive `_meta` or QueryMT extension methods; the desktop treats every missing field as "feature unavailable".

1. **Capability**: `initialize` → `agentCapabilities._meta.querymt.workspace`
   `{ supported: true, defaultBaseline, executionModes: ["local","worktree"], baselines, sourceSession?: true, handoff?: true, handoffSummary?: true }`.
   `sourceSession` means `querymt/worktree/create` accepts `source_session_id`; `handoff` means `querymt/worktree/handoff` exists; `handoffSummary` means it accepts `summary: true`.
2. **Create at launch**: `session/new` `_meta.querymt.sessionWorkspace = { execution: "worktree", includeLocalChanges?: boolean, baseRef?: string }`. The response's `_meta.querymt.sessionWorkspace` discloses `sessionCwd`, `workspaceId`, `branch`, `checkoutPath`, `baseline`.
3. **Create from a session**: `querymt/worktree/create { cwd, source_session_id?, name?, base_ref?, include_local_changes? }` → `{ session_id, workspace_id, checkout_path, session_cwd, branch, baseline_mode, ... }`.
4. **Handoff**: `querymt/worktree/handoff { session_id, name?, summary? }` → `{ session_id, previous_session_id, workspace_id, session_cwd, checkout_path, branch, summary_seeded }`. Refusal codes in error `data.code`: `owner_active`, `owner_transferred`, `workspace_archived`, `workspace_missing`, `invalid_options`, `workspace_service_unavailable`.
5. **List**: each `SessionInfo._meta`:
   - adds `forkOrigin: "worktree"` and `parentSessionId` for sessions created from a source session or by handoff;
   - adds `querymt.workspace = { workspaceId, branch, checkoutPath, sourceCwd, baselineMode, lifecycle, ownerSessionId?, handedOffTo? }`.

   `sourceCwd` is the cwd the agent groups the session under. A `session/list` with `cwd = sourceCwd` returns these sessions.
6. **Children**: `session/list` with `_meta.session_scope = "children"` and `_meta.querymt.parentSessionId = <id>` returns direct children (forks and worktree children; delegates excluded).
7. **Load**: the `session/load` response:
   - carries `_meta.querymt.sessionWorkspace` (disclosure, as in item 2);
   - for a previous owner after handoff, also carries `_meta.querymt.sessionAccess = { mode: "read_only", reason: "owner_transferred", ownerSessionId }`.

   A session whose workspace was archived (from any session, see agent change section 25) is also read-only: `_meta.querymt.sessionAccess = { mode: "read_only", reason: "workspace_archived", workspaceId }`, without `ownerSessionId`.

   Prompting a read-only session fails with the matching code (`owner_transferred` or `workspace_archived`).

## Decisions

### 1. One domain module owns all worktree parsing
`src/lib/domain/session-workspace.ts` parses capability, list/load metadata, access, and errors into typed values, and builds the `sessionWorkspace` request metadata. Components and the store never read raw `_meta` for worktree data. Parsers are defensive: malformed values become `null`, never a guessed state. This mirrors `readSessionLifecycle` / `readSessionPin`.

### 2. Group by `workspace.sourceCwd ?? cwd`
A single helper, `getSessionGroupCwd(summary)`, replaces `session.cwd` wherever the store or domain groups sessions into workspace sources. The summary's `cwd` stays the execution path, so headers and copy-path still show where the session actually runs. Because the agent filters `session/list` by the same key, pagination per group stays consistent.

Alternative: group client-side by repository. Rejected; it would disagree with server paging and with how local sessions are grouped.

### 3. Nesting by on-demand expansion
Root listing is unchanged. A row with `forkCount > 0` or `hasChildren` gets an expand control that loads its direct children (contract item 6), cached per agent and parent. Children render indented under the parent, recursively, with their relationship badge. Expansion state is component-local.

The client still filters responses by `parentSessionId`, so an agent that ignores the children filter cannot inject unrelated rows.

Alternative: always fetch all scopes and build the tree client-side. Rejected; it defeats paging and the root-scope catalog cache.

### 4. Worktree markers
- Any session with `workspace` shows a branch badge (`GitBranch` icon, branch name). Hovering shows the checkout path, baseline, and a non-`ready` lifecycle.
- `forkOrigin: "worktree"` shows a *Worktree* relationship badge, distinct from *Fork* and *Delegate*.
- Handed-off sessions (`workspace.handedOffTo` or read-only access) show a *Handed off* badge.

### 5. Creation and handoff go through one dialog
`WorktreeSessionDialog` has two modes:
- **create**: name, base ref, include local changes. Local changes and base ref are mutually exclusive, matching the agent.
- **handoff**: name, *start with a summary* (off by default; shown only with `handoffSummary`).

The store methods `createWorktreeSessionFrom` and `handoffWorktreeSession` call the extension, then:
1. invalidate the catalog;
2. insert an optimistic child summary under the source, as forks already do;
3. return the new session ID, and the route navigates to it.

On the launcher, the composer's *Workspace* option maps to `sessionWorkspace` on `session/new`. It is available only for the local target: remote mesh targets are refused by the agent's placement rule, so the option is hidden for them.

### 6. Read-only presentation is agent-authoritative
The store records `sessionAccess` from the load response (`activeSessionAccess`).
- When read-only: the session page replaces the composer with a banner linking to `ownerSessionId`, and hides undo, fork, and handoff actions.
- An `owner_transferred` or `workspace_archived` prompt error, from a race with a handoff or archive elsewhere, puts the session into the same state.
- The notice wording depends on `sessionAccess.reason`; the owner link is shown only when the agent supplies an owner. Archived sessions get an *Archived* list badge instead of *Handed off*. Unknown reasons fall back to a generic read-only notice.

The desktop never infers read-only from list metadata alone. The list badge is informational only.

### 7. Errors
`describeWorktreeError(error)` maps the stable codes in `RequestError.data.code` to short, actionable messages. Example: `owner_active` → "Stop the running turn, queued input and any shared delegates before changing this worktree." The archive/remove codes `workspace_archived`, `workspace_not_archived`, `unpreserved_content` and `unpreserved_commits` are mapped too, although the desktop does not yet offer archive or remove actions (they stay available through the agent's `/worktree` commands). Unknown codes fall back to the agent message.

## Risks / Trade-offs

- **Agent not yet amended.** Grouping, nesting, the badges, and handoff stay dormant until the agent sends the new metadata. Launch-time worktree creation and create-from-session already work against the current agent, but without lineage when `sourceSession` is absent.
- **Expansion cost.** Expanding issues one `session/list` per parent. That's acceptable for interactive use; the result is cached until the catalog is invalidated.
- **Summary handoff latency.** Generating a summary can take seconds. The dialog stays pending and cannot be double-submitted.
