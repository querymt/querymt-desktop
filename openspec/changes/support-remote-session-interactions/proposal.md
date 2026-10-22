# Proposal

## Why

The agent change `unify-session-interactions` (querymt repository) makes permission requests and form questions work the same for local and remote mesh sessions, and makes an unanswered permission request wait instead of being auto-granted. The desktop must keep up: today `InboxStore` answers every open permission request with `cancelled` when its ACP transport drops, which would turn a temporary disconnect into a rejected tool call now that permission waits for the user. The desktop also has no clear message for a remote node that has not been upgraded, which is what an un-upgraded mesh node will return.

## What Changes

- Keep pending permission cards (non-actionable while offline) across a temporary transport loss, instead of sending `cancelled`.
- Rebind a re-delivered `session/request_permission` to its existing card, so one question is one card with one answer.
- After reconnect, remove permission cards the agent no longer reports as pending, without sending any response.
- Show a clear "remote node must be upgraded" message when creating, attaching to, or prompting a remote session fails with the agent's upgrade-required error.
- Update generated agent types if the agent changes event shapes.
- Depends on the agent release containing `unify-session-interactions`. Against an older agent, permission behavior is unchanged except that cards are no longer cancelled on disconnect.

## Capabilities

### New Capabilities
- `desktop-session-interactions`: Desktop handling of permission requests across transport loss and recovery, and presentation of the remote-node upgrade-required failure.

### Modified Capabilities

None. `reconnectable-acp-elicitations` is unchanged; remote-hosted recovery is specified agent-side in `session-interactions`.

## Impact

- **Desktop**: `src/lib/stores/inbox.svelte.ts` and its tests, `src/lib/stores/agents.svelte.ts` (reconnect reconciliation, error mapping), `src/lib/querymt/*` (typed errors), `src/routes/__tests__/landing-session-start.test.ts`, regenerated types.
- **Agent (`querymt` repository)**: `crates/agent/src/acp/websocket.rs`, `acp/stdio.rs`, `acp/shared.rs`, `elicitation.rs`, `control/elicitation_recovery.rs` and their tests; regenerated typeshare output.
- **Cross-repo**: builds on the `unify-session-interactions` agent change in the sibling `querymt` checkout and amends it; final verification is a two-node run (desktop plus NAS).
- **Ship gate**: the desktop's offline permission cards (group 1) must not be released without the reconciliation (group 3) and the agent fixes (group 2), because without them an offline card has nothing to clear it.
