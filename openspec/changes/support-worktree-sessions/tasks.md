# Tasks

Depends on the amended agent change `add-git-worktree-isolation` (sibling `querymt` repository): source-cwd grouping, `forkOrigin: "worktree"`, worktree list/load metadata, `source_session_id` on create, `querymt/worktree/handoff` with optional summary, and read-only access for previous owners. The desktop gates every feature on capability or metadata (see `design.md`, "Wire contract"), so groups 1–6 can be built and tested against mocks.

## 1. Domain parsing

- [x] 1.1 Add `src/lib/domain/session-workspace.ts`. It parses the workspace capability, per-session workspace metadata, load-time disclosure and `sessionAccess`, builds the `sessionWorkspace` request metadata, and maps stable worktree error codes to messages. Verify the defensive parsing in `session-workspace.test.ts`.
- [x] 1.2 Add `workspace` and `access` to `DesktopSessionSummary`, map them in `mapAcpSessionsToDesktopSessions`, preserve them in `mergeSessions`, and add `getSessionGroupCwd`. Verify in `sessions.test.ts`.

## 2. Protocol client

- [x] 2.1 `DesktopAcpClient.createSession` accepts an optional workspace request. Add `getWorkspaceCapability()`, `createWorktreeSession()` and `handoffWorktreeSession()`, backed by the `QuerymtExtensions` methods `worktreeCreate` and `worktreeHandoff`. Add `listSessionChildren()`. Verify in the client and extension tests.

## 3. Store

- [x] 3.1 Group workspace sources by `getSessionGroupCwd`, in discovery, upsert and the load summary sync.
- [x] 3.2 Add composer workspace mode (`local` | `worktree` | `worktree_local_changes`). Apply it only to the local target, and reset it when the agent cannot isolate.
- [x] 3.3 Add `createWorktreeSessionFrom(agentId, sessionId, options)` and `handoffWorktreeSession(agentId, sessionId, options)`. Each refreshes the catalog and inserts optimistic child summaries.
- [x] 3.4 Add `loadSessionChildren(agentId, parentId)` with a per-parent cache, filtered by `parentSessionId`.
- [x] 3.5 Track `activeSessionAccess` from the load response and from `owner_transferred` prompt failures.
- [x] 3.6 Store tests: grouping, launch metadata, create and handoff flows, read-only switch.

## 4. Session list

- [x] 4.1 Add a branch badge with a tooltip, a Worktree relationship badge, a Handed off badge, and a lifecycle warning to `DesktopSessionList` rows.
- [x] 4.2 Add an expand control for rows with children, rendering nested children recursively with indentation.
- [x] 4.3 Component tests.

## 5. Session actions, dialog and header

- [x] 5.1 Add a `WorktreeSessionDialog` with create and handoff modes, a summary toggle (off by default), and exclusive base ref / local changes.
- [x] 5.2 Add "New worktree session" and "Hand off worktree" entries to `SessionActionsMenu`, gated by capability, ownership and read-only state.
- [x] 5.3 Add the worktree branch chip and detail rows to `SessionHeader`.
- [x] 5.4 Add the composer Workspace option on the launcher.

## 6. Read-only view

- [x] 6.1 For a read-only session, replace the composer with a notice linking to the owner, and hide undo and fork.

## 7. Checks

- [x] 7.1 `npm run check`, `npm run test:ui` (only pre-existing failures allowed), `openspec validate support-worktree-sessions --strict`.

## 8. Cross-repository verification (needs the amended agent)

- [ ] 8.1 With `single_coder.toml` (`[agent.workspace] enabled = true`), verify:
  - launch in a new worktree;
  - create from a session (it nests under the source in the same group);
  - clean handoff, then handoff with a summary;
  - the previous owner opens read-only;
  - refusal while a turn is running.
