# Proposal

## Why

The desktop has no idea of a first run. On first launch it opens straight to the composer and problems show up one by one, often as vague errors:

- The default agent (`qmtcode --acp`) starts silently. If the binary is missing or killed (for example by macOS quarantine), the useful error is shown only on the Agents page. The start screen shows just "0/1 agents connected".
- No provider is connected and nothing says so. Provider status is already loaded when the agent starts, but the start screen never uses it.
- With no providers the agent returns no models. The app shows the generic "Failed to load models." and the picker says "No models available from this agent." Neither mentions providers.
- Provider sign-in lives under Settings → Providers, but Settings opens on General.
- A brand-new user gets whichever model the agent lists first, and choosing a model on the start screen is not remembered until a session is actually created with it.

## What Changes

- **Readiness check**: one pure function that turns existing store state into a list of checks (agent running, provider connected, models available, model selected). Each check has a status, a reason and a fix action. The setup wizard and the start screen both use it.
- **Setup wizard** (`/setup`): shown once on first run when something is missing. Full screen without the sidebar, headed by an animated QueryMT boot mark ported from the mobile app. Steps: Welcome → Agent → Providers → Model → Done. Every step and the whole wizard can be skipped. It can be reopened from Settings and the command palette.
- **"Finish setup" card on the start screen**: lists only the checks that are not ready, each with its fix action. It stays until the problems are fixed, so users who skip the wizard are still guided.
- **Clearer start-screen states**:
  - send is disabled with a reason while the agent, provider or model is missing;
  - the empty-models error mentions providers;
  - agent and provider problems link to `/agents` and `/settings?section=providers`.
- **Model step uses the existing "last used model on this agent"** behavior. Choosing a model in setup (and on the start screen) is saved immediately as the most recent model for that agent.

## Decisions taken in review

- The wizard is always skippable. Experienced users installing on a new machine may prefer their own setup.
- Provider credentials from environment variables keep counting as connected, exactly as `hasUsableProviderCredential()` does today. A stricter check is possible later and is out of scope.
- There is no app-wide default model. The model step writes the agent's last used model, which already stores provider, model and, for mesh models, the serving node.
- Mesh (invites, joining, remote nodes) is not part of first run.
- The composer's workspace handling is not changed: no workspace step, no restored last workspace, and workspace is not a readiness check. Sessions without a workspace are being finalized separately.
- With several agents, one working agent is enough.
- The wizard ends on the start screen; no example prompts.
- The wizard hides the sidebar and shows a boot mark matching the mobile app.

## Non-goals

- Changing how provider credentials are counted.
- An app-wide or profile-level default model.
- Mesh onboarding.
- Any change to workspace selection in the composer.
- Agent-side changes. Everything uses existing ACP and QueryMT extension methods.
- Installing or updating the `qmtcode` binary from the wizard.

## Capabilities

### New Capabilities
- `desktop-first-run-setup`: readiness detection, the first-run setup wizard, and start-screen guidance for unfinished setup.

### Modified Capabilities

None.

## Impact

- **Desktop**:
  - `src/lib/domain/` (new `readiness.ts`, new `onboarding.ts`);
  - `src/lib/design/boot-mark.ts` and `src/lib/components/brand/BootMark.svelte` (ported from `../querymt-mobile/src/components/startup/`);
  - `src/lib/stores/agents.svelte.ts` (persist an explicit launch model choice; expose whether initialization has settled);
  - new `src/routes/setup/+page.svelte` and setup step components;
  - `src/routes/+layout.svelte` (first-run redirect, no sidebar on `/setup`), `src/routes/+page.svelte` (Finish setup card, send gating);
  - provider sign-in reused from `ProviderConnectionList`, the provider dialogs and `OAuthSignInFlow` (`src/lib/domain/oauth-sign-in.svelte.ts`);
  - Settings (General) and the command palette ("Run setup");
  - tests for all of the above.
- **Agent**: none.
- **Compatibility**: existing users are not sent to the wizard (see design, decision 3). Embedded mode skips the Agent step.
