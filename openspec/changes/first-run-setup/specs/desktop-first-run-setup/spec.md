# Spec Delta

## Purpose

Defines how the desktop detects whether it is ready to start sessions, guides a new user through setup on first run, and shows unfinished setup on the start screen.

## ADDED Requirements

### Requirement: Readiness is derived from one shared check
The desktop SHALL compute readiness from existing agent, provider and model state as the checks `agent`, `providers`, `models` and `model`. Each check SHALL have a status, a reason when not `ok`, and a fix action when one exists. Setup SHALL be complete when every check is `ok` or `not_applicable`. The wizard and the start screen SHALL use the same result. Workspace selection SHALL NOT be part of readiness.

#### Scenario: Everything ready
- **WHEN** an agent is running, at least one provider is connected, models are loaded and a launch model is selected
- **THEN** every check is `ok` and setup is complete

#### Scenario: Agent failed to start
- **WHEN** every enabled agent has failed and the primary agent has a last error
- **THEN** the `agent` check is `blocked` with that error as its reason and a retry action, and the `providers`, `models` and `model` checks are `not_applicable`

#### Scenario: Agent still starting
- **WHEN** no agent is running yet and initialization has not finished or an agent is starting or connecting
- **THEN** the `agent` check is `pending`, not `blocked`

#### Scenario: Agent without provider auth support
- **WHEN** the checked agent does not advertise the `auth` feature
- **THEN** the `providers` check is `not_applicable` and readiness depends on the `models` check

#### Scenario: No workspace chosen
- **WHEN** every check is `ok` and the composer has no workspace
- **THEN** setup is complete and the composer's workspace behavior is unchanged

### Requirement: One working agent is enough
With several enabled agents, the `agent` check SHALL be `ok` when at least one of them is running and not failed. The provider and model checks SHALL use the primary agent (the agent the start screen launches with) when it is running, otherwise the first running enabled agent.

#### Scenario: One of two agents failed
- **WHEN** two agents are enabled, one is running and the other failed
- **THEN** the `agent` check is `ok` and the provider and model checks use the running agent

### Requirement: Provider connection keeps its current meaning
The `providers` check SHALL treat a provider as connected exactly when the existing provider credential rule does: OAuth connected, a key stored in Desktop, or a key from an environment variable.

#### Scenario: Environment key only
- **WHEN** the only credential is an environment API key reported by the agent
- **THEN** the `providers` check is `ok`

#### Scenario: Only an expired OAuth login
- **WHEN** the only provider with a login has OAuth status expired and no key
- **THEN** the `providers` check is `warning`, its reason says the sign-in expired, and it offers a reconnect action

### Requirement: First-run detection
The desktop SHALL store onboarding state (version, completed time, skipped time) locally. Detection SHALL run before agent initialization. A user with no onboarding state but existing desktop data (configured agents, recent sessions, recent models or workspaces) SHALL be treated as an existing user and SHALL NOT be shown the wizard automatically.

#### Scenario: Fresh install
- **WHEN** no onboarding state and no existing desktop data are stored
- **THEN** the desktop treats the launch as a first run

#### Scenario: Upgrade from a version without onboarding
- **WHEN** no onboarding state is stored but recent sessions exist
- **THEN** onboarding is recorded as completed and the wizard is not opened

### Requirement: Setup wizard opens on first run only when needed
On a first run, after agent initialization has settled (or after at most 10 seconds), the desktop SHALL open the setup wizard if setup is not complete and the user is on the start screen. If setup is already complete, the desktop SHALL record onboarding as completed and SHALL NOT open the wizard. The desktop SHALL NOT redirect from any other route.

#### Scenario: First run without providers
- **WHEN** a first run settles with no connected provider
- **THEN** the desktop navigates from the start screen to the setup wizard

#### Scenario: First run already usable
- **WHEN** a first run settles with setup complete
- **THEN** the start screen stays open and onboarding is recorded as completed

#### Scenario: Opened from a deep link
- **WHEN** a first run starts on a session or settings route
- **THEN** no redirect happens

### Requirement: Wizard is full screen with the QueryMT boot mark
The setup wizard SHALL be shown without the session sidebar, keeping only window controls. It SHALL show the QueryMT boot mark, matching the mobile app's mark (the seven brand hexagons forming the Q, framed by peer hexagons and links). The mark SHALL animate while the agent is connecting, SHALL be static when idle or failed, and SHALL be static when the user prefers reduced motion. The animation SHALL NOT delay any step. Global navigation shortcuts SHALL be ignored while the wizard is open.

#### Scenario: No sidebar
- **WHEN** the wizard is open
- **THEN** the session sidebar is not rendered

#### Scenario: Agent connecting
- **WHEN** the Agent step is shown and the `agent` check is `pending`
- **THEN** the boot mark animates and a boot log shows the current startup stage

#### Scenario: Reduced motion
- **WHEN** the operating system requests reduced motion
- **THEN** the boot mark is drawn static

### Requirement: Setup wizard steps
The wizard SHALL present the steps Welcome, Agent, Providers, Model and Done, in that order, with a progress indicator. The Agent step SHALL be omitted in embedded mode. Mesh setup and workspace selection SHALL NOT be part of the wizard.

#### Scenario: Agent step shows the failure
- **WHEN** the `agent` check is `blocked`
- **THEN** the Agent step shows the agent's error and offers Retry and a link to the Agents page

#### Scenario: Provider sign-in from the wizard
- **WHEN** the user signs in to a provider or saves an API key in the Providers step
- **THEN** the same agent auth methods as Settings are used, provider status and models refresh, and Continue becomes enabled once a provider is connected

#### Scenario: No models after providers
- **WHEN** the Model step is reached and the agent has no models
- **THEN** the step explains why and offers Refresh models and Back to providers

#### Scenario: Finish
- **WHEN** the user finishes the Done step
- **THEN** onboarding is recorded as completed and the start screen opens with the prompt focused, without example prompts

### Requirement: The wizard is always skippable
Every wizard step SHALL offer Skip, and the wizard SHALL offer Skip setup at any point. Skipping the wizard SHALL record onboarding as skipped, open the start screen, and SHALL NOT reopen the wizard automatically.

#### Scenario: Skip the whole wizard
- **WHEN** the user chooses Skip setup on the Welcome step
- **THEN** the start screen opens, onboarding is recorded as skipped, and the wizard does not open on the next launch

#### Scenario: Skip one step
- **WHEN** the user skips the Providers step
- **THEN** the wizard moves to the Model step and the Done step lists providers as not set up

### Requirement: Setup can be run again
The desktop SHALL offer a Run setup action in Settings → General and in the command palette, which opens the wizard regardless of onboarding state.

#### Scenario: Re-run from Settings
- **WHEN** the user chooses Run setup again in Settings
- **THEN** the wizard opens on the Welcome step

### Requirement: Model choice is remembered as the last used model on the agent
There SHALL be no app-wide default model. Choosing a model in the setup wizard or in the start-screen model picker SHALL set it as the agent's launch model and SHALL immediately persist it as that agent's most recent model, including the serving node for mesh models. On later launches the existing recent-model selection SHALL pick it when it is available.

#### Scenario: Choice survives a restart
- **WHEN** the user chooses a model on the start screen and restarts the app without creating a session
- **THEN** the same model is preselected for that agent

#### Scenario: Remembered model unavailable
- **WHEN** the remembered model is not in the agent's model list
- **THEN** the next available recent model is used, otherwise the first model

### Requirement: Finish setup card on the start screen
When setup is not complete and initialization has settled, the start screen SHALL show a Finish setup card above the composer, listing each check that is not `ok` or `not_applicable` with its reason and fix action, and a Run setup link. The card SHALL NOT be dismissible and SHALL disappear when setup is complete. Pending checks SHALL be shown as in progress, not as errors.

#### Scenario: Wizard skipped, no provider
- **WHEN** the user skipped the wizard and no provider is connected
- **THEN** the start screen shows the card with a Connect provider action that opens Settings → Providers

#### Scenario: Setup fixed later
- **WHEN** the user connects a provider in Settings and models load
- **THEN** the card disappears without a restart

### Requirement: The start screen explains why it cannot send
When setup is not complete, the launch composer's send action SHALL be disabled and a hint SHALL show the reason of the first failing check. Workspace handling in the composer SHALL stay unchanged. When the agent advertises provider auth and no provider is connected, an empty model list SHALL be reported as needing a provider instead of the generic model loading error.

#### Scenario: No provider
- **WHEN** no provider is connected
- **THEN** send is disabled and the hint asks the user to connect a provider

#### Scenario: No provider, no models
- **WHEN** the agent returns no models and no provider is connected
- **THEN** the error says to connect a provider in Settings → Providers

### Requirement: Providers settings explain a missing agent
When no agent advertises provider auth controls because the agent is not running, Settings → Providers SHALL say so and link to the Agents page.

#### Scenario: Agent stopped
- **WHEN** the only agent has failed and the user opens Settings → Providers
- **THEN** the page explains that the agent is not running and links to the Agents page
