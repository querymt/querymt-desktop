# Proposal

## Why

An unanswered ACP form elicitation currently expires after two minutes and is reported as "User cancelled question" even though the user never acted. A desktop disconnect also cancels its inbox request. Users need to leave a question pending for hours and return through a new ACP connection without losing the original agent run or incorrectly attributing a transport failure to them.

## What Changes

- Keep outstanding session-scoped form elicitations pending without a wall-clock timeout while the agent process and originating run remain alive; distinguish explicit `accept`, `decline`, and `cancel` from disconnect and delivery failure.
- Re-deliver unanswered questions as new ACP `elicitation/create` requests when an authorized client reconnects; provide a QueryMT extension to discover pending sessions, not only the open session.
- Bind recovery and responses to the original verified client/user authority, not merely a supplied `sessionId` or elicitation ID; fail closed where no secure reconnect identity exists.
- Preserve desktop inbox items and drafts across transport loss; rebind the new ACP request to the same item without silently returning `cancel`, and reconcile already-resolved items.
- Explicit session cancellation and termination of the originating run still finish pending questions. Agent-process restart/run restoration, URL-mode elicitation, and cross-user handoff are out of scope.

## Capabilities

### New Capabilities

- `reconnectable-acp-elicitations`: Long-lived session-scoped form questions, authorized reconnect recovery, and desktop inbox reconciliation.

### Modified Capabilities

None; the desktop OpenSpec root has no existing specs.

## Impact

- Desktop: `src/lib/stores/inbox.svelte.ts`, `src/lib/stores/agents.svelte.ts`, ACP client/transport and their tests.
- Agent (companion work in `/Users/wiking/qmt/querymt`): `crates/agent/src/elicitation.rs`, `crates/agent/src/acp/websocket.rs`, `crates/agent/src/acp/shared.rs`, `crates/agent/src/acp/stdio.rs`, session cancellation, QueryMT extension discovery, and tests.
- ACP wire behavior: standard `elicitation/create` on each live connection, plus a versioned QueryMT-only discovery/recovery extension and secure reconnect credential or verified identity. No change to the ACP standard is proposed.
- This change lives in the **repo-local desktop OpenSpec root**. Its apply scope is limited to querymt-desktop; agent implementation requires a separately authorized/coordinated change in the sibling repository before end-to-end acceptance can pass.
