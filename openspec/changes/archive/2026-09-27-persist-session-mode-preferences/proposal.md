# Proposal

## Why

Switching agent modes in an existing session can replace the user's selected model and reasoning effort with mode defaults, so returning to a mode does not restore the configuration previously chosen for that session. The model picker also returns keyboard focus to its trigger, which prevents the prompt-level Tab shortcut from immediately switching modes after a model selection.

## What Changes

- Persist model and reasoning-effort preferences locally for each agent, session, and mode.
- Restore a mode's saved model and reasoning effort after the agent confirms a mode change, while treating the agent's intermediate mode defaults as temporary.
- Seed a previously unseen mode from the agent's most recently confirmed available model instead of a static/config-based model default; use the mode's supported automatic/default reasoning value when no saved reasoning preference exists.
- Initialize new-session model selection from the most recently confirmed available model for that agent.
- Validate saved preferences against the current model catalog and refreshed mode options, falling back safely when a model or reasoning choice is no longer available.
- Return focus to the prompt after selecting a model through the keyboard shortcut so Tab can continue cycling agent modes; preserve conventional trigger focus when the picker is dismissed from a pointer-opened interaction.
- Support prompt-level Tab mode cycling in both existing-session and new-session composers.

## Capabilities

### New Capabilities
- `session-mode-preferences`: Defines desktop-local, per-session and per-mode model/reasoning preferences, recent-model defaults for new sessions and unseen modes, and keyboard focus continuity around model and mode selection.

### Modified Capabilities

None.

## Impact

- Affects the frontend agent/session store, session config update orchestration, local persistence helpers, session composer keyboard handling, and model picker focus management.
- Adds versioned desktop-local preference data keyed by agent, session, and mode; no ACP protocol or server-side persistence changes are required.
- Requires store and component tests covering reload persistence, mode transition ordering, unavailable preferences, recent-model initialization, and picker focus behavior.
