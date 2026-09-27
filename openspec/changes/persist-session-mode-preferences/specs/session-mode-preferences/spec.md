# Spec Delta

## Purpose

Preserve each session's model and reasoning choices across agent modes on the same desktop while keeping model-selection and mode-switching keyboard workflows continuous.

## ADDED Requirements

### Requirement: Per-session mode preferences
The system SHALL maintain a separate model and reasoning-effort preference for each combination of agent, session, and mode. The preferences SHALL be stored on the local desktop and SHALL survive application restarts on that desktop.

#### Scenario: Returning to a previously configured mode
- **WHEN** a user selects a model and reasoning effort in one mode, switches to another mode, and later returns to the first mode in the same session
- **THEN** the system restores the model and reasoning effort last confirmed for that first mode

#### Scenario: Preferences remain isolated between sessions
- **WHEN** two sessions use different model or reasoning preferences for the same mode
- **THEN** switching modes in either session restores only that session's preferences

#### Scenario: Preferences survive an application restart
- **WHEN** a user restarts the desktop application and reopens a session that has saved mode preferences
- **THEN** those preferences remain available when the user switches to the corresponding modes

#### Scenario: Preferences remain desktop-local
- **WHEN** a session is opened by another client or on another desktop
- **THEN** the locally saved mode preferences are not synchronized through ACP or treated as server-owned session state

### Requirement: Existing session load remains authoritative
When an existing session is initially loaded, the system SHALL display the active model, mode, and reasoning effort reported by the agent. It SHALL use that confirmed active configuration as the saved preference for the loaded mode without automatically overwriting it from an older local preference.

#### Scenario: Agent state differs from local active-mode preference
- **WHEN** a loaded session reports an active-mode model or reasoning effort that differs from the locally saved value for that mode
- **THEN** the system displays and saves the agent-reported active configuration without issuing a configuration write

#### Scenario: Agent omits model metadata during load
- **WHEN** a loaded session does not report enough model metadata to identify its active model
- **THEN** the system does not substitute a recent or locally saved model as though it were the confirmed active model

### Requirement: Mode transitions restore preferences after mode confirmation
The system SHALL serialize a user-requested mode transition so that it records the outgoing mode's confirmed model and reasoning effort, applies the target mode, evaluates the refreshed target-mode options, and then applies the target mode's resolved model and reasoning preference. Model or reasoning defaults returned as an intermediate consequence of changing mode SHALL NOT replace a valid saved target-mode preference.

#### Scenario: Target mode has saved preferences
- **WHEN** a user switches to a mode with a saved model and reasoning effort that remain available in the refreshed options
- **THEN** the system applies the saved model and reasoning effort after the mode change is confirmed

#### Scenario: Outgoing mode is captured before switching
- **WHEN** a user changes modes after successfully changing the current model or reasoning effort
- **THEN** the system records the confirmed outgoing values before applying the target mode

#### Scenario: Mode transition partially fails
- **WHEN** the mode change succeeds but applying a resolved model or reasoning effort fails
- **THEN** the system retains the last agent-confirmed configuration, preserves previously confirmed preferences, and reports the failure without recording the rejected value

#### Scenario: Rapid mode changes
- **WHEN** a user requests another mode change while configuration writes for the same session are pending
- **THEN** the system serializes the requests for that session and derives each transition from confirmed state rather than an intermediate response

### Requirement: Unseen and unavailable mode preferences use safe defaults
For a mode with no valid saved model, the system SHALL select the most recently confirmed model for the agent that is present in the current model catalog. If no recent model is available, the system SHALL retain the model confirmed by the agent for that mode. For a mode with no valid saved reasoning effort, the system SHALL retain the current supported reasoning value returned for that mode.

#### Scenario: First visit to a mode uses a recent model
- **WHEN** a user enters a mode that has no saved model preference and the agent has an available recently confirmed model
- **THEN** the system applies the most recently confirmed available model after the mode change

#### Scenario: Saved model is unavailable
- **WHEN** a mode's saved model is absent from the current model catalog
- **THEN** the system falls back to the most recently confirmed available model and does not send the unavailable model

#### Scenario: No recent model is available
- **WHEN** a mode has no valid saved model and none of the agent's recent models are currently available
- **THEN** the system retains the model confirmed by the agent for that mode

#### Scenario: Saved reasoning effort is unsupported
- **WHEN** a mode's saved reasoning effort is absent from the refreshed reasoning choices
- **THEN** the system retains the current supported reasoning value returned by the agent for that mode and replaces the stale saved preference with the confirmed value

### Requirement: New sessions prefer the agent's recent model
The new-session composer SHALL initialize its model selection from the most recently confirmed model for the selected agent that is still available. It SHALL use the agent's catalog default only when no recent model is available.

#### Scenario: New session has an available recent model
- **WHEN** the new-session composer loads models for an agent with a recently confirmed available model
- **THEN** that model is selected for the new session instead of a static configuration default

#### Scenario: Recent model is no longer available
- **WHEN** all models in the agent's recent history are absent from the current catalog
- **THEN** the new-session composer selects the current catalog default

#### Scenario: Model write is rejected
- **WHEN** the agent rejects a model selection
- **THEN** the rejected model does not become the agent's recent model or a saved session-mode preference

### Requirement: Model picker preserves prompt keyboard workflow
The model picker SHALL track whether it was opened from the prompt keyboard shortcut or from its trigger. Closing a keyboard-opened picker, including after selection or cancellation, SHALL return focus to the originating prompt when programmatic prompt focus is allowed. Closing a pointer-opened picker without a successful selection SHALL restore focus to its trigger. A successful model selection from either origin SHALL return focus to the prompt when programmatic prompt focus is allowed.

#### Scenario: Select a model after keyboard opening
- **WHEN** a user opens the model picker from the prompt with Cmd+M or Ctrl+M and selects a model
- **THEN** focus returns to the prompt and the next unmodified Tab invokes mode cycling

#### Scenario: Cancel after keyboard opening
- **WHEN** a user opens the model picker from the prompt shortcut and closes it without selecting a model
- **THEN** focus returns to the originating prompt

#### Scenario: Cancel after trigger opening
- **WHEN** a user opens the model picker from its trigger and closes it without selecting a model
- **THEN** focus returns to the model trigger

#### Scenario: Select after trigger opening
- **WHEN** a user opens the model picker from its trigger and successfully selects a model
- **THEN** focus moves to the prompt when programmatic prompt focus is allowed

### Requirement: Prompt Tab cycles modes in all composers
An unmodified Tab pressed while the prompt is focused SHALL cycle to the next available mode in both existing-session and new-session composers. The system SHALL prevent normal focus traversal only when at least two mode choices are available and a mode can be cycled.

#### Scenario: Existing-session mode cycling
- **WHEN** the existing-session prompt is focused and the user presses an unmodified Tab while at least two modes are available and no mode update is pending
- **THEN** the system requests the next mode and keeps focus in the prompt

#### Scenario: New-session mode cycling
- **WHEN** the new-session prompt is focused and the user presses an unmodified Tab while at least two launch modes are available
- **THEN** the system selects the next launch mode and keeps focus in the prompt

#### Scenario: Mode cannot be cycled
- **WHEN** the prompt is focused and fewer than two modes are available or the mode control is pending
- **THEN** the system does not consume Tab and normal focus traversal continues
