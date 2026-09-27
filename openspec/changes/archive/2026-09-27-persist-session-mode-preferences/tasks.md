# Tasks

## 1. Preference Persistence And Confirmed State

- [x] 1.1 Add a versioned desktop-local session-mode preference document keyed by agent, session, and mode, with defensive parsing and persistence helpers; verify store tests cover valid reload, malformed storage, missing fields, and unavailable local storage.
- [x] 1.2 Add store helpers that read, update, and remove model/reasoning preferences only from confirmed session state while preserving exact mesh model selection keys; verify unit tests cover agent/session/mode isolation and session deletion cleanup.
- [x] 1.3 Merge partial config-option responses and notifications by option id while treating session-load options as authoritative snapshots; verify store tests cover model-only, mode-only, reasoning-only, and full-option responses without losing the confirmed active mode.
- [x] 1.4 Seed the loaded active mode's preference from agent-reported state without issuing config writes or substituting unknown model metadata; verify existing-session load tests cover conflicting local state and omitted model metadata.

## 2. Mode Transition Orchestration

- [x] 2.1 Add a session-scoped mode transition operation that captures the outgoing confirmed preference, writes the target mode, and serializes the complete restore sequence with other config work for that session; verify tests assert mode-before-model-before-reasoning order and independent concurrency across sessions.
- [x] 2.2 Resolve the target model from an exact saved selection, then the agent's available recent history, then the agent-confirmed mode value; verify tests cover unseen modes, unavailable local and mesh models, no available recent model, and no writes when the confirmed value already matches.
- [x] 2.3 Resolve reasoning after the model response using refreshed choices, retaining the agent-confirmed reasoning when no valid saved choice exists; verify tests cover model-dependent reasoning choices and replacement of stale reasoning preferences.
- [x] 2.4 Prevent intermediate mode defaults and racing notifications from overwriting saved target preferences, and preserve only confirmed values on partial failure; verify tests cover mode success with model/reasoning failure, unsolicited updates during transition, and rejected values remaining absent from persistence.
- [x] 2.5 Route session mode controls and prompt Tab cycling through the semantic transition operation; verify component/store integration tests confirm both direct mode selection and keyboard cycling use the same ordered behavior.

## 3. Agent-Scoped New-Session Defaults

- [x] 3.1 Replace or encapsulate the global launch model selection with agent-scoped launch state that revalidates against each refreshed model catalog; verify store tests cover switching agents without leaking one agent's selected model into another.
- [x] 3.2 Initialize each agent's launch model from its first available recent entry and fall back to the catalog default only when needed; verify tests cover available recent models, stale recent history, an empty catalog, and catalog refreshes.
- [x] 3.3 After successful session creation, save the confirmed launch mode/model/reasoning preference and update recent-model history only for a successful explicit model write; verify tests cover successful creation, rejected model writes, and mode restoration not changing recency.

## 4. Composer Keyboard And Focus Behavior

- [x] 4.1 Track whether the model picker opened from the prompt shortcut or its trigger and whether selection completed, then restore focus according to that origin/outcome through a composer prompt-focus callback; verify component tests cover keyboard select, keyboard cancel, trigger select, and trigger cancel.
- [x] 4.2 Preserve the existing small-screen/coarse-pointer prompt-focus guard when closing the picker; verify component tests confirm the picker does not force prompt focus when programmatic focus is disabled.
- [x] 4.3 Refactor prompt mode cycling to support both active-session config choices and launch-mode choices, and consume Tab only when at least two choices can be cycled and no relevant update is pending; verify component tests cover existing sessions, new sessions, pending state, and normal focus traversal when cycling is unavailable.
- [x] 4.4 Add an end-to-end component interaction test for Cmd+M or Ctrl+M, model selection, focus returning to the prompt, and the next Tab requesting the next mode.

## 5. Integration Verification

- [x] 5.1 Run the targeted agent-store and session-composer test suites and verify all persistence, transition ordering, fallback, and focus scenarios pass.
- [x] 5.2 Run `npm run check` and the complete `npm test` suite, resolving regressions and verifying the final implementation passes project-wide type and behavior checks.
- [x] 5.3 Harden transition restoration against sparse agent responses: restore writes fire when a mode response omits model metadata, the model catalog is ensured before resolution, and user config writes made during a transition stay serialized while recording recency and preferences normally; verify store and composer tests cover these cases.
