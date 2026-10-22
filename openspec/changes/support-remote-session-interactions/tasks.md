# Tasks

Depends on the agent change `unify-session-interactions` (sibling `querymt` repository, archived 2026-10-21). That change left three gaps this change closes agent-side (group 2) so the desktop can reconcile permission cards (group 3). Groups 1 and 4 can be built against mocks; group 6 needs the released agent.

**Ship gate:** group 1 alone is a regression (offline permission cards would never clear). Do not release or commit group 1 without group 3.

## 1. Permission cards survive transport loss (desktop)

- [x] 1.1 Change `InboxStore.retirePendingRequestsForAgent` in `src/lib/stores/inbox.svelte.ts` so a dropped transport no longer resolves pending permission requests with `cancelled`; keep the cards, mark them offline and non-actionable, and block submission while offline; verify new cases in `src/lib/stores/inbox.svelte.test.ts` showing disconnect sends no outcome and offline answers are rejected.
- [x] 1.2 Rebind a re-delivered `session/request_permission` to its existing card (as elicitations rebind by stable ID), replacing the retired resolver without creating a duplicate card or notification; verify tests for one card, answer sent on the new request, and an explicit user answer still resolving once. Currently keyed by agent + session + tool-call ID; task 3.1 moves this to the agent-provided interaction ID.

## 2. Agent: permission recovery contract (`querymt` repository)

- [x] 2.1 Add a failing test, then fix, the claim-then-drop defect: after `querymt/elicitation/attachSession` claims a session's pending items for the connection, a pending permission MUST still reach that connection as `session/request_permission`. Today `undelivered_permission_ids_for_session` skips items already claimed by the connection and the form-question sender cannot render a permission. Verify in `crates/agent/src/acp/websocket_tests.rs` (and the remote variant in `agent/remote/session_actor_ref_remote_tests.rs`).
- [x] 2.2 Include the interaction ID in every `session/request_permission` request as `_meta.querymt.interaction_id` (same shape as `elicitation_id` on form questions), for local and remote-hosted sessions, in both WebSocket and stdio delivery; verify a wire-level test asserting the ID equals the pending interaction ID listed by recovery.
- [x] 2.3 Issue the resume authority when a permission request is raised (not only on `ElicitationRequested`), and do not require form-elicitation support on the connection for a session whose pending items are permissions; keep the secure-transport requirement; verify tests for a permission-only session getting an authority and an insecure transport getting none.
- [x] 2.4 Regenerate `scripts/generate-types.sh` output if any typeshare type changed; record the agent commit this change builds against. No typeshare type changed in group 2; desktop `generated/types.ts` was re-synced from the agent working tree on base commit `449ad2d6` (the group 2 changes are uncommitted there and must be committed and released before group 6).

## 3. Reconcile with the agent's pending set (desktop)

- [x] 3.1 Key permission cards by `_meta.querymt.interaction_id`, falling back to agent + session + tool-call ID only when the agent omits it; verify tests that the fallback still rebinds and that two requests with the same tool-call ID but different interaction IDs stay separate.
- [x] 3.2 Rebind a re-delivery to a card whose answer was submitted but rejected (the agent keeps the request pending and re-sends it), like questions do, so no second card or notification appears; verify a test for submit, rejection, re-delivery, one card.
- [x] 3.3 After reconnect, treat permission interaction IDs in the attach response (`elicitation_ids`) as part of the pending set and remove permission cards the agent no longer reports, reusing `reconcileReboundElicitations` in `InboxStore` and its call site in `AgentsStore`, without sending any outcome; verify tests in `inbox.svelte.test.ts` and `agents.svelte.test.ts` for a request answered elsewhere and a request retired by run cancel.
- [x] 3.4 Confirm a remote-hosted session's pending permission request is attached and shown after a UI refresh the same way as a local one (existing resume-authority flow, now issued for permissions); verify a test in `agents.svelte.test.ts` with a remote-target session and a permission-only session.

## 4. Upgrade-required error (desktop)

- [x] 4.1 Map the agent's upgrade-required error from session create, attach and prompt to a typed desktop error in `src/lib/querymt/` and a clear "remote node must be upgraded" message naming the node, without leaving a half-created session; verify unit tests in `src/lib/stores/agents.svelte.test.ts` and `src/lib/querymt/acp-client.test.ts`.
- [x] 4.2 Also map the error when opening an existing remote session (`session/load` and its remote-attach fallback in `AgentsStore.loadSession`); verify a test that opening a session on an outdated node shows the upgrade message instead of a raw error.
- [x] 4.3 Replace the landing-page test that only asserts a mocked store error with one that exercises the real error path, or remove it; the store tests are the coverage.
- [x] 4.4 Move the upgrade-error classification out of `domain/prompt-errors.ts` imports of `querymt/` (keep `domain` free of transport-layer imports), e.g. by having the client attach a typed marker the domain layer reads.

## 5. Generated types and checks

- [x] 5.1 Regenerate agent types with `scripts/generate-types.sh` and verify `npm run check` passes. Re-run after task 2.4 against the agent commit this change ships with, and confirm the `profile_id` / `profile_label` nullability change in `RemoteSessionAttachInfo` / `RemoteSessionInfo` is intended.
- [x] 5.2 Run `npm run test:ui` and confirm the only failures are the pre-existing `DesktopSessionList`, `ModelQuickPicker` and `DelegateModelDialog` ones.

## 6. Cross-repository verification (needs the released agent)

- [ ] 6.1 With the agent change present, verify on a two-node mesh (desktop host plus NAS): create a remote session from Options -> Target, send a first prompt (no "client bridges" error), answer a permission request, answer a form question, drop and restore the connection while each is pending, cancel a waiting run, restart the agent while a permission is pending (card must clear), and confirm a remote `language_query` reports unavailable; record results in the change notes.
- [ ] 6.2 Verify against an un-upgraded remote node that creating, opening or prompting a session shows the upgrade message and no tool runs.

## Workflow follow-up

- `design.md` is not yet written; create it with `openspec instructions design --change support-remote-session-interactions --json` to record the interaction-ID keying decision and the ship gate.
- Archive this change after the agent commits are released and group 6 is recorded.
