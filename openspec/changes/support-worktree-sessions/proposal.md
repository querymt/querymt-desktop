# Proposal

## Why

The agent can run a session in its own managed Git worktree (`add-git-worktree-isolation`, sibling `querymt` repository), but the desktop cannot use it. Users must type `/worktree create`, copy a session ID out of a JSON reply, and find the new session in an unrelated sidebar group (it is grouped by repository, not by the project the user started from). There is no way to choose isolation when starting a session, no visible marker that a session runs in a worktree, and no way to start a fresh conversation in an existing worktree.

The agent change is being amended so that:

- isolated sessions are grouped under the cwd they were started from and nested under the session that spawned them (`forkOrigin: "worktree"`),
- list and load responses describe the session's worktree,
- worktree creation can record the source session,
- a worktree's ownership can be handed off to a new conversation (optionally seeded with a summary); the previous owner stays readable but cannot run.

The desktop must expose all of this.

## What Changes

- **New session in a worktree**: the launch composer gets a *Workspace* option (Local checkout / New worktree / New worktree with local changes), shown only when the agent advertises workspace support.
- **New worktree session from a session**: a session action creates an isolated session from the current one (optional name, base ref, or local changes) and opens it.
- **Hand off worktree**: a session action on a worktree owner starts a fresh conversation in the same checkout, clean by default, optionally seeded with a summary, and opens it.
- **Visualization**:
  - the sidebar groups isolated sessions under their source project;
  - rows show a worktree badge (branch, checkout path on hover) and a *Worktree* relationship badge for children;
  - rows with children can be expanded to show forks and worktree children nested under their parent.
- **Session header**: shows the worktree branch and details (checkout, baseline, lifecycle).
- **Read-only handed-off sessions**: a session whose worktree was handed off shows its history and a banner linking to the current owner, without a composer.
- Clear messages for the agent's stable worktree error codes.
- Against an agent without these features, nothing new is shown and behavior is unchanged.

## Capabilities

### New Capabilities
- `desktop-worktree-sessions`: Desktop creation, visualization, handoff, and read-only presentation of sessions that run in managed Git worktrees.

### Modified Capabilities

None.

## Impact

- **Desktop**:
  - `src/lib/domain/` (new `session-workspace.ts`, `sessions.ts`, `types.ts`);
  - `src/lib/querymt/` (`acp-client.ts`, `querymt-extensions.ts`);
  - `src/lib/stores/agents.svelte.ts`;
  - `SessionComposer`, `DesktopSessionList`, `SessionActionsMenu`, `SessionHeader`, a new `WorktreeSessionDialog`;
  - the session and launcher routes, `app.css`, and their tests.
- **Agent (`querymt` repository)**: depends on the amended `add-git-worktree-isolation` change. Its wire contract is listed in `design.md`.
- **Compatibility**: every feature is gated on agent capability or metadata. Older agents keep current behavior.
