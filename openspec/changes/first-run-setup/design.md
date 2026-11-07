# Design

## Context

See `proposal.md` for motivation and `specs/desktop-first-run-setup/spec.md` for observable behavior.

Today:

- `AgentsStore.initialize()` (`src/lib/stores/agents.svelte.ts`) refreshes every configured agent, starts the enabled `autoStart` ones, then loads profiles, sessions and models. The default config is a single stdio agent `qmtcode --acp`. Embedded mode replaces it with one WebSocket agent.
- `startConfiguredAgent()` loads provider auth status (`refreshAuthProviders`) into `authProvidersByAgent`. Agents that do not advertise the `auth` feature get an empty list.
- `hasUsableProviderCredential()` (`src/lib/domain/provider-auth.ts`) treats OAuth connected, a key stored in Desktop, or an environment key as connected.
- `preloadModelsForRunningAgents()` retries `listModels` up to 6 times and then sets the generic `'Failed to load models.'`.
- The launch model per agent is `launchModelIds[agentId]` (in memory). `selectLaunchModelForAgent()` picks the first entry of `recentModelsByAgent[agentId]` (persisted in `querymt-desktop.recent-models`, max 5) that exists in the current catalog, otherwise the first model. Entries are selection keys from `getModelSelectionKey()`: `provider/model` for local models and `querymt:model:["provider/model","<node_id>"]` for mesh models. `rememberRecentModel()` runs only when a session's model is set explicitly.
- `OAuthSignInFlow` (`src/lib/domain/oauth-sign-in.svelte.ts`) runs an OAuth sign-in (start, poll, paste callback, cancel) outside the Settings page.
- The QueryMT mark is drawn inline by `src/lib/components/brand/BrandIcon.svelte` (same geometry as the mobile app's `assets/branding/` files), with the tile in the accent color. The mobile app (`../querymt-mobile`) has an animated boot mark: `src/components/startup/connectAnimation.ts` (geometry and timing) and `BootScreen.tsx` (rendering and boot log).

## Decisions

### 1. One pure readiness module
`src/lib/domain/readiness.ts` exports `evaluateReadiness(input): ReadinessReport`. The input is a plain snapshot built from `agentsStore` (configs, statuses, connection states, agent errors, capabilities, auth providers, auth loading and errors, models, model loading, launch models, `initializing`) plus `isEmbedded`. It has no Svelte or store imports, so it is unit tested with plain objects.

```ts
type ReadinessCheckId = 'agent' | 'providers' | 'models' | 'model';
type ReadinessStatus = 'ok' | 'pending' | 'blocked' | 'warning' | 'not_applicable';
interface ReadinessCheck {
  id: ReadinessCheckId;
  status: ReadinessStatus;
  title: string;          // "Agent", "Providers", ...
  reason: string | null;  // user-facing, null when ok
  action: ReadinessAction | null;
}
type ReadinessAction =
  | { kind: 'retry-agent'; agentId: string }
  | { kind: 'open-agents' }
  | { kind: 'open-providers'; agentId: string }
  | { kind: 'refresh-models'; agentId: string }
  | { kind: 'choose-model'; agentId: string };
interface ReadinessReport {
  agentId: string | null;   // the agent the provider/model checks refer to
  checks: ReadinessCheck[];
  setupComplete: boolean;   // every check ok or not_applicable
}
```

**Which agent is checked.** At least one working agent is enough. The `agent` check is `ok` when any enabled agent is running and not `failed`; other failed agents do not block setup (they stay visible on the Agents page as today). The provider and model checks use the primary agent (the agent the start screen launches with) if it is running, otherwise the first running enabled agent. The start screen's `primaryAgentId` expression moves into the store as `agentsStore.primaryAgentId` so both places agree.

Rules:

| Check | ok | pending | blocked | not_applicable |
|---|---|---|---|---|
| `agent` | ≥1 enabled agent running and not `failed` | none running yet, and initializing or some agent starting/connecting | no enabled agent, or all enabled agents failed/stopped (reason = the primary agent's `lastError` / agent error) | — |
| `providers` | ≥1 provider with `hasUsableProviderCredential` | auth loading | agent advertises `auth` and no provider is connected (`warning` with a reconnect action if only an expired OAuth exists) | no running agent, or it does not advertise `auth` |
| `models` | ≥1 model | model loading | agent running, models loaded, list empty | no running agent |
| `model` | launch model resolves in the catalog | — | models exist but no launch model resolves | no models |

**Workspace is not a readiness check.** The composer's workspace handling stays exactly as it is today: sessions without a workspace are being finalized separately, so this change neither restores a last-used workspace nor requires one.

Alternative: reactive getters spread over the store. Rejected; the rules would be hard to test and the wizard and start screen could drift.

### 2. Providers keep today's meaning of "connected"
Readiness calls `hasUsableProviderCredential()` unchanged, so environment keys count. If the checked agent does not advertise the `auth` feature, the provider check is `not_applicable` and the `models` check alone decides whether the agent is usable.

### 3. Onboarding state and who sees the wizard
`src/lib/domain/onboarding.ts` owns `querymt-desktop.onboarding`:

```ts
interface OnboardingState { version: number; completedAt: string | null; skippedAt: string | null }
```

`ONBOARDING_VERSION = 1`. The wizard is "done" when `version >= ONBOARDING_VERSION` and either timestamp is set.

When the key is missing:

- If any existing desktop data is present (`querymt-desktop.agents`, `querymt-desktop.recent-sessions`, `querymt-desktop.recent-models` or `querymt-desktop.workspaces`), the user is an existing user. The state is written as completed and the wizard is never shown automatically.
- Otherwise it is a first run.

The detection runs once, before `agentsStore.initialize()`, so nothing the app writes during startup can make a new user look like an existing one. Its result is kept in memory for the rest of the app start.

Bumping `ONBOARDING_VERSION` later re-offers the wizard only if a new blocking step is added. That is out of scope for now.

### 4. When the wizard opens automatically
In `+layout.svelte`, once per app start:

1. Wait until `agentsStore.initializing` is false (new flag, set around `initialize()`), with a 10 s cap so a hanging agent cannot keep the user waiting.
2. If it is a first run and `setupComplete` is false and the current route is `/`, `goto('/setup')`.
3. If it is a first run and `setupComplete` is already true (for example environment keys provide models), mark onboarding completed and stay on `/`.

The redirect never happens from deep links or other routes.

Alternative: open the wizard before initialization finishes. Rejected; the Agent step would flicker from "starting" to "ok" for most users and we would redirect users who need nothing.

### 5. Wizard layout: full screen, no sidebar
`/setup` renders without the app shell chrome: `+layout.svelte` skips `RecentSessionRail` and the sidebar grid on this route and renders the page full width (the custom titlebar and window resize handles stay, so the window can still be moved, resized and closed). Global navigation shortcuts (Ctrl/Cmd+1..0 for sessions, Ctrl/Cmd+N for a new session) are ignored on `/setup`, so the user cannot leave the wizard without finishing or skipping it.

The page is a centered column (max width ~560 px): the boot mark (decision 6), a step indicator, the step content and a footer with *Back*, *Skip* and *Continue*.

### 6. Boot mark matching the mobile app
Port the mobile boot mark to the desktop:

- `src/lib/design/boot-mark.ts`: the geometry from mobile `connectAnimation.ts` (hex lattice, the seven brand hexagons forming the Q, the eleven framing peers (the tail fills the twelfth ring slot), links shorter than 65 units, delays, `CONNECT_ROTATION`, `CONNECT_VIEWBOX`, `CONNECT_CYCLE`). Pure data, unit tested (node and link counts, the seven logo nodes).
- `src/lib/components/brand/BootMark.svelte`: renders that geometry as inline SVG. Brand hexagons use the brand orange; peers and links use theme surface and border variables, so it follows light/dark like mobile's `startupPalette`. Props: `state: 'connecting' | 'idle' | 'failed'` and `size`.
  - `connecting`: nodes and links fade in along the Q with CSS keyframes and per-node `animation-delay`, looping every `CONNECT_CYCLE` ms (mobile's `connectionWave`).
  - `idle` and `failed`: static, fully drawn mesh.
  - `prefers-reduced-motion: reduce`: always static.
  - Accessible as `role="progressbar"` with label "Connecting to QueryMT" while connecting, otherwise `role="img"` labeled "QueryMT".
- Usage: large on the Welcome step; on the Agent step it is `connecting` while the agent check is `pending`, `failed` when `blocked`, `idle` when `ok`. A small static mark heads the other steps.
- The Agent step shows a short boot log under the mark, like mobile's `BootLog`: the last three of "Starting agent", "Connecting to agent", "Checking providers", "Loading models", with done / current / failed markers, derived from readiness and agent state (never from timers).

The animation is purely visual and never delays any step.

### 7. Wizard steps
1. **Welcome**: the boot mark, a one-line description of QueryMT and of the next steps. Buttons: *Get started*, *Skip setup*.
2. **Agent** (skipped in embedded mode): the boot mark and boot log. On `ok`, shows the working agent's name, version and program source (bundled / PATH / explicit). On `blocked`, shows the error and actions: *Retry* and *Open Agents* (logs and agent settings). The step never advances automatically; the user presses *Continue*.
3. **Providers**: `ProviderConnectionList` for the checked agent with the existing API key dialog and OAuth handling. *Continue* is enabled when the `providers` check is `ok` or `not_applicable`; *Skip* is always available. After a successful sign-in or key save, providers and models refresh (already done by the store methods).
4. **Model**: the existing model picker panel filled from `modelsByAgent[agentId]`, preselected with the current launch model. Choosing calls `agentsStore.chooseLaunchModel()` (decision 8). If there are no models, it shows the `models` reason and *Refresh models* / *Back to providers*.
5. **Done**: a short summary of what is ready and what was skipped, and *Start using QueryMT*, which goes to `/` and focuses the prompt. No example prompts.

A step indicator shows progress and lets the user jump back to finished steps. *Skip setup* at any point marks `skippedAt` and goes to `/`. Finishing marks `completedAt`.

Provider sign-in UI logic currently lives inside `src/routes/settings/+page.svelte`. The wizard must not copy it. Implementation extracts the provider action handlers (sign in, cancel, API key, clear key, disconnect, method change) into a small reusable controller (`src/lib/components/settings/provider-actions.svelte.ts`), built on `OAuthSignInFlow` where it fits. Settings then uses the same controller. Settings behavior must not change; its existing tests guard this.

### 8. Explicit model choice is remembered immediately
Add `AgentsStore.chooseLaunchModel(agentId, selectionKey)`: sets `launchModelIds[agentId]` and calls `rememberRecentModel()` with the resolved `ModelEntry`, so it is persisted. The setup Model step and the start-screen model picker (`onModelChange` in `src/routes/+page.svelte`) use it. `setLaunchModel()` stays for internal, non-user writes.

No app-wide default is introduced. "Last used model on this agent" already includes provider, model and, for mesh models, the serving node, and `selectLaunchModelForAgent()` already falls back to the next recent model, then the first model, when it is unavailable.

### 9. Finish setup card on the start screen
`src/lib/components/setup/SetupChecklist.svelte` renders the checks that are not `ok` or `not_applicable` with their reason and action button. On `/` it is shown above the composer when `setupComplete` is false and initialization has settled. It has a *Run setup* link to `/setup`. It cannot be dismissed: it disappears when the checks pass. `pending` checks show a spinner row rather than an error.

Actions map to: retry agent → `restartConfiguredAgent`/`startConfiguredAgent`; open agents → `/agents`; open providers → `/settings?section=providers`; refresh models → `refreshModelsForAgent`; choose model → opens the composer model picker.

### 10. Composer gating and messages
- When `setupComplete` is false, the launch composer's send button is disabled and a one-line hint gives the first failing reason (for example "Connect a provider to start a session."). Workspace handling in the composer is unchanged.
- The empty-models error from `loadModelsForAgent` becomes provider-aware: if the agent advertises `auth` and no provider is connected, the message is "No models available. Connect a provider in Settings → Providers." Otherwise the generic message stays.
- The empty Settings → Providers state ("No connected agents currently advertise provider auth controls.") explains that the agent is not running when that is the cause, and links to `/agents`.

### 11. Re-running setup
- Settings → General gets a *Run setup again* button.
- The command palette gets a *Run setup* command.
Both go to `/setup`. Re-running does not reset onboarding state until the user finishes or skips again.

## Risks / Trade-offs

- **Existing-user detection is heuristic.** A user who cleared localStorage gets the wizard once. It is skippable, so the cost is one click.
- **Redirect waits for initialization.** Slow agents mean the start screen shows briefly before the redirect. The 10 s cap bounds it.
- **Extracting provider actions touches Settings.** Mitigated by keeping the existing Settings tests passing unchanged.
- **Start-screen model choice now changes recent-model order.** That is intended: the user picked it.
- **Boot mark geometry is copied from mobile.** If the brand mark changes, both apps need the update. The geometry file names its mobile source to make that visible.

## Resolved in review

- Wizard always skippable; environment keys keep counting; no app-wide default model (last used model on the agent); no mesh in first run.
- The composer workspace is not touched and not restored; workspace is not part of readiness.
- With several agents, one working agent is enough.
- The Done step opens the start screen; no example prompts.
- The wizard hides the sidebar and shows a boot mark matching the mobile app.
