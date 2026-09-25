# Design

## Context

See `proposal.md` for motivation and `specs/reconnectable-acp-elicitations/spec.md` for the behavior contract. In the sibling agent, `PendingElicitation` currently contains only a session ID and oneshot sender (`crates/agent/src/elicitation.rs:58`); the WebSocket event forwarder turns its 120-second timeout, invalid reply, and disconnect into ACP `cancel` (`crates/agent/src/acp/websocket.rs:889`). Per-connection session ownership and bridge attachment are managed separately in `crates/agent/src/acp/shared.rs`; `session/load` for an existing actor does not restart its run (`crates/agent/src/agent/handle/core.rs:663`). Desktop disposes a dropped client by cancelling inbox promises (`src/lib/stores/agents.svelte.ts:2760`), cancels repeated elicitation IDs (`src/lib/stores/inbox.svelte.ts:202`), and only reloads its active session on reconnect (`src/lib/stores/agents.svelte.ts:3982`). The desktop OpenSpec root is repo-local: agent changes require separately authorized companion work in `/Users/wiking/qmt/querymt`.

## Goals / Non-Goals

**Goals:**
- Preserve the original live tool waiter while replacing transient ACP delivery attempts, with a single terminal answer.
- Use standard ACP `elicitation/create` for each attempt; use QueryMT extensions only for recovery/discovery and identity proof.
- Prevent an unrelated WebSocket client that knows a session ID from recovering its unanswered question.

**Non-Goals:**
- Resuming an agent run after the agent process exits or a desktop app process restarts without a retained credential.
- Replaying `elicitation/requested` history as live requests, transferring questions between users, or changing URL-mode semantics.

## Decisions

### Agent owns the pending state; WebSocket requests are replaceable attempts

Extend the in-memory agent pending entry with the original form payload, session ID, opaque elicitation ID, origin runtime/profile, response sender, authorized principal or resume authority, and active delivery generation. Register atomically before publishing the request. Keep the waiter alive until a validated response or originating run termination; remove it on explicit stop, tool exit, or session termination. Session-aware profile/delegate lookup must preserve the existing routing. Event history is only for display/diagnostics: emit a terminal outcome without form answer content; do not derive actionable state by replaying durable `elicitation_requested` events. Alternative rejected: keeping an ACP JSON-RPC response future alive across sockets (request IDs and callbacks belong to a dead connection).

### Separate transport failures from user actions

Keep a bounded timeout for permission and other short RPCs but not for form elicitation. On disconnect, write failure, invalid response, or dropped callback, invalidate only the connection's delivery generation; leave the agent entry pending. Invalid accepted form values return an error to the submitting client, leaving the question pending. Only explicit ACP actions map to user outcomes. A run cancel retires the pending entry and cancels its waiter as part of normal run cancellation, not as a fabricated ACP user action. Update stdio and direct bridge paths to avoid turning bridge errors into user `cancel`. Alternative rejected: a longer timeout, which still falsely attributes expiry and fails for multi-hour waits.

### Recovery uses a per-session in-memory capability, not session IDs

For a client with verified authentication, bind pending state to that authenticated principal and only allow the same principal on reconnect. For currently unauthenticated WebSocket deployments, issue a cryptographically random, per-session, process-lifetime resume capability *only to the connection that originally received the question* over its existing protected channel; retain a non-reversible verifier at the agent. The desktop retains the capability in memory across WebSocket client replacement, never in a URL, ordinary logs, replay events, browser localStorage, or ACP question content. A versioned QueryMT extension accepts a supplied capability to list *only its matching pending sessions* and to authorize a recovery attachment. An ordinary `session/load` or known `sessionId` must not bypass this gate for pending elicitation content or answers. A connection that cannot prove authority can still use permitted historical session operations but cannot recover the question. Do not issue a capability retroactively to a new unauthenticated connection for a pre-upgrade question; fail closed. If secure transport is unavailable for a non-loopback endpoint, refuse capability exchange/recovery until TLS or verified auth is configured. Alternative rejected: identity claimed in ACP `clientInfo`, same-origin header, session ID, or persistent unencrypted storage; none prove the same user/client.

The capability remains valid only while the agent process and session/run are alive, and is revoked when its pending questions finish. This deliberately scopes recovery to the running desktop process; persisting it across an application restart requires a separately reviewed secure credential-storage feature. Establish a versioned extension capability so an older agent/client simply keeps previous behavior or reports recovery unavailable, never claims it restored a question.

### Atomic single-winner delivery and attachment

On an authenticated or capability-verified attach, enumerate pending entries for that authority/session and send fresh ACP `elicitation/create` requests with new connection-local JSON-RPC IDs and the same `_meta.querymt.elicitation_id`. Under the pending registry lock, claim a delivery generation for that connection, coalescing enumeration with live event delivery; the old attempt is invalidated on takeover. Validate connection, authority, session, generation, action, and accepted schema under a single terminal transition before consuming the waiter. Stale or duplicate replies receive a terminal/stale error, never mutate the underlying question. Do not rely on ACP `elicitation/complete`: the standard reserves it for URL mode. Alternative rejected: reusing the request ID or replying to a disconnected ACP request.

### Desktop retains drafts but rebinds ACP promises

Keep pending form state and stable question ID in `InboxStore` across an unexpected transport loss; mark it offline/non-actionable and discard the old connection's resolver without resolving `cancel`. On reconnect, the agents store authenticates via the QueryMT extension, discovers pending sessions (not only active), and attaches/reloads them without starting a second run. Replace the old resolver with the new ACP request on matching stable ID, preserve the existing field values, and notify only for genuinely new questions. Reconcile the local inbox against the server's authoritative pending snapshot, resolving/removing items no longer pending without sending an ACP response. Explicit session Stop removes it by agent-side lifecycle; explicitly disconnecting the *desktop client* does not mean the user cancelled the question. Keep permission requests on their current bounded/connection-scoped behavior. Alternative rejected: resolving old promises with `cancel` and letting new requests create duplicate cards.

## Risks / Trade-offs

- [Two repos, repo-local apply scope] -> Land and test the companion agent contract in its own authorized change before enabling desktop recovery; document wire version and feature negotiation on both sides.
- [Unauthenticated WebSocket listeners] -> Use unguessable process-scoped capability bound to original delivery, TLS/loopback restriction, scoped discovery, and deny recovery when original authority cannot be established; do not treat Origin or ACP `clientInfo` as authentication.
- [Long-lived waiting runs retain resources] -> Bound only non-response RPCs, remove entries on run/tool/session termination, and expose pending count/age without logging question content or secrets; intentionally no age cutoff for active runs.
- [Concurrent clients and lost last-moment responses] -> Generation-based single-winner transition plus authoritative snapshot reconciliation; a lost response can be resubmitted rather than silently guessed.
- [Feature mismatch during staged deployment] -> Versioned capability gating and clear "recovery unavailable" status; do not claim the question was cancelled.

## Migration Plan

1. Coordinate agent companion change: state/authority registry, secure extension handshake and discovery, atomic ACP delivery, and agent integration tests. Do not enable discovery before ownership checks are enforced.
2. Update desktop to retain in-process authority, preserve offline inbox items, discover/rebind after reconnection, and test against the agreed wire contract.
3. Roll out with feature negotiation. Existing in-flight elicitations without proof of original authority are not automatically adoptable by new unauthenticated connections; existing sessions receive new recoverable questions only after capability issuance. Rollback disables the extension; it must not change a question's outcome to "user cancelled" solely because recovery is unavailable.
