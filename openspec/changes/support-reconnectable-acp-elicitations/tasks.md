# Tasks

## 1. Coordinate the Agent Contract (external dependency)

The agent repository `/Users/wiking/qmt/querymt` is outside this repo-local change's allowed edit roots. The following tasks require a separately authorized companion change there; do not edit it as part of a desktop-only apply.

- [ ] 1.1 Agree on a versioned QueryMT capability and wire contract for issuing in-process resume authority, listing only authorized pending session IDs, and attaching recoverable sessions; verify protocol fixtures cover legacy agents and denied unauthorized clients.
- [ ] 1.2 In the authorized agent companion change, extend session/profile/delegate pending entries with form payload, owner authority, run lifecycle, and delivery generation; verify unit tests cover register, snapshot, and cleanup on tool exit/Stop.
- [ ] 1.3 In the agent companion change, remove wall-clock limits from WebSocket form elicitation delivery without changing permission RPC limits, and stop mapping bridge/stdio transport errors to user `cancel`; verify simulated multi-hour waits and disconnect tests keep the original waiter alive.
- [ ] 1.4 In the agent companion change, implement verified-principal or original-connection-issued secret authority, per-session discovery and authorized attach with secure transport checks; verify guessed session IDs, stolen/stale IDs, capability mismatch, and insecure remote transport cannot recover a question.
- [ ] 1.5 In the agent companion change, re-deliver standard ACP `elicitation/create` on authorized reconnect with fresh JSON-RPC IDs, stable opaque question IDs, atomic single-winner resolution, form validation, and terminal outcome without answer-content replay; verify old-socket races, invalid content, duplicate replies, off-screen sessions, and profile/delegate routing in agent integration tests.

## 2. Desktop Reconnect Behavior (this repository)

- [ ] 2.1 Extend the desktop QueryMT extension client to negotiate the agent contract, hold resume authority in memory across WebSocket client replacement, and handle unavailable/legacy capability without exposing secrets in logs or storage; verify ACP client and extension unit tests.
- [ ] 2.2 Change `InboxStore` to retain question cards and drafts while transport is offline, disable offline actions, and retire only the old ACP resolver without responding `cancel`; verify disconnect and explicit user-cancel unit tests in `src/lib/stores/inbox.svelte.test.ts`.
- [ ] 2.3 Rebind a re-delivered ACP question by stable agent/session/elicitation identity to its existing card and new resolver, preserving entered fields and avoiding duplicate notifications; verify re-delivery, draft retention, and one-card/one-answer unit tests.
- [ ] 2.4 Update `AgentsStore` reconnect to authenticate, discover authorized pending sessions including off-screen ones, attach without starting a new run, and reconcile inbox items against the authoritative snapshot; verify reconnect, stale-item, and active-versus-background session tests in `src/lib/stores/agents.svelte.test.ts`.
- [ ] 2.5 Update offline/recovery UI states so users see a temporarily unavailable question rather than an actionable or cancelled one; verify component behavior with desktop UI tests and no response emitted during offline interaction.

## 3. Cross-Repository Verification and Rollout

- [ ] 3.1 With separately authorized agent companion work present, run desktop unit/type tests and agent ACP integration tests; verify a multi-hour simulated wait followed by reconnect resumes the *same* tool exactly once.
- [ ] 3.2 Exercise two ACP clients, a dead connection's late response, explicit `accept`/`decline`/`cancel`, run Stop, and an unrelated client with a known session ID; verify only the authorized current delivery can resolve and only explicit user `cancel` is attributed to the user.
- [ ] 3.3 Verify feature-gated deployment against old desktop and old agent versions, secure/non-secure transports, and sessions created before rollout; document cases where recovery is unavailable rather than misreporting cancellation.
