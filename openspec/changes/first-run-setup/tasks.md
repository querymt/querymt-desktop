# Tasks

No agent changes are needed. Every group uses existing ACP and QueryMT extension methods. The composer's workspace handling is not changed.

## 1. Readiness domain

- [x] 1.1 Add `src/lib/domain/readiness.ts` with `evaluateReadiness()` and its types (design, decision 1). Use `hasUsableProviderCredential()` unchanged. Verify every row of the rules table, "one working agent is enough", embedded mode and the auth-unsupported case in `readiness.test.ts`.
- [x] 1.2 Move the start screen's `primaryAgentId` expression into `AgentsStore.primaryAgentId`, and use it from `src/routes/+page.svelte`.
- [x] 1.3 Add `AgentsStore.initializing`, true from the start of `initialize()` until it settles. Add a `readiness` getter that builds the snapshot and calls `evaluateReadiness()`.

## 2. Onboarding state

- [x] 2.1 Add `src/lib/domain/onboarding.ts`: load and save `querymt-desktop.onboarding`, `ONBOARDING_VERSION`, existing-user detection (run before `initialize()`), `markCompleted` and `markSkipped`. Verify in `onboarding.test.ts` (fresh install, upgrade, corrupt value).

## 3. Model choice

- [x] 3.1 Add `AgentsStore.chooseLaunchModel(agentId, selectionKey)`, which sets the launch model and persists it through `rememberRecentModel()`. Use it from the start-screen `onModelChange`. Verify persistence, mesh selection keys and the fallback in `agents.svelte.test.ts`.

## 4. Boot mark

- [x] 4.1 Port the geometry from `../querymt-mobile/src/components/startup/connectAnimation.ts` to `src/lib/design/boot-mark.ts` (design, decision 6), naming the mobile source. Verify node and link counts and the seven logo nodes.
- [x] 4.2 Add `src/lib/components/brand/BootMark.svelte` (`connecting` / `idle` / `failed`, theme colors, CSS animation, reduced motion, accessible role and label), with component tests.

## 5. Start screen

- [x] 5.1 Add `src/lib/components/setup/SetupChecklist.svelte` (design, decision 9), with component tests.
- [x] 5.2 Show the card on `/` when setup is incomplete and initialization has settled.
- [x] 5.3 Disable send with a reason hint when setup is incomplete. Do not change workspace handling.
- [x] 5.4 Make the empty-models error provider-aware.
- [x] 5.5 Update `landing-session-start.test.ts`.

## 6. Provider actions extraction

- [x] 6.1 Extract the Settings provider action handlers into `src/lib/components/settings/provider-actions.svelte.ts`, reusing `OAuthSignInFlow` where it fits. Switch Settings to the controller. `settings-page.test.ts` must pass without changes to its expectations.
- [x] 6.2 Update the empty Providers state to explain a stopped agent and link to `/agents`.

## 7. Setup wizard

- [x] 7.1 In `+layout.svelte`, render `/setup` without `RecentSessionRail` and the sidebar grid (keeping the titlebar and resize handles), and ignore global navigation shortcuts there.
- [x] 7.2 Add the `/setup` route: boot mark, step indicator, Back / Skip / Continue, and Skip setup.
- [x] 7.3 Add the step components (`src/lib/components/setup/`): Welcome, Agent with boot log (hidden in embedded mode), Providers (uses 6.1), Model (uses the model picker panel and 3.1), Done.
- [x] 7.4 Record completion or skip through 2.1. Finish navigates to `/` and focuses the prompt.
- [x] 7.5 Route tests: no sidebar, step order, embedded mode without the Agent step, skipping each step, skipping the wizard, finishing.

## 8. Entry points

- [x] 8.1 Add the first-run redirect in `+layout.svelte` (design, decision 4): only from `/`, after initialization settles or after 10 s, once per app start. Test the fresh-install, already-usable, existing-user and deep-link cases. (implemented; covered by manual check 9.2, no automated layout test yet)
- [x] 8.2 Add *Run setup again* to Settings → General and a *Run setup* command to the command palette.

## 9. Checks

- [x] 9.1 Run `npm run check`, `npm run test:ui` (only pre-existing failures allowed) and `openspec validate first-run-setup --strict`.
- [ ] 9.2 Manual check with a clean app data directory: fresh install without providers, with an environment key only, and with a broken agent command. Then repeat as an upgraded user with existing data, and with light/dark themes and reduced motion for the boot mark.
