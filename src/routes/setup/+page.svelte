<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext, onMount } from 'svelte';
  import { AlertTriangle, Check, LoaderCircle, RefreshCw, X } from '@lucide/svelte';
  import BootMark from '$lib/components/brand/BootMark.svelte';
  import AppearanceControls from '$lib/components/settings/AppearanceControls.svelte';
  import ModelPickerPanel from '$lib/components/primitives/ModelPickerPanel.svelte';
  import AgentConnectionFields from '$lib/components/primitives/AgentConnectionFields.svelte';
  import type { AgentConfig } from '$lib/domain/types';
  import ProviderApiKeyDialog from '$lib/components/settings/ProviderApiKeyDialog.svelte';
  import ProviderClearKeyDialog from '$lib/components/settings/ProviderClearKeyDialog.svelte';
  import ProviderConnectionList from '$lib/components/settings/ProviderConnectionList.svelte';
  import ProviderDisconnectDialog from '$lib/components/settings/ProviderDisconnectDialog.svelte';
  import ProviderOAuthDialog from '$lib/components/settings/ProviderOAuthDialog.svelte';
  import { ProviderActionsController } from '$lib/components/settings/provider-actions.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { providerAuthCapabilitiesFromAgent } from '$lib/domain/provider-auth';
  import { splitAuthEntries } from '$lib/domain/mcp-auth';
  import { markOnboardingCompleted, markOnboardingSkipped } from '$lib/domain/onboarding';
  import type { ReadinessCheck, ReadinessCheckId } from '$lib/domain/readiness';
  import { getModelSelectionKey } from '$lib/querymt/config-options';
  import { isEmbedded } from '$lib/platform/runtime';

  type StepId = 'welcome' | 'appearance' | 'agent' | 'providers' | 'model' | 'done';
  const STEP_LABELS: Record<StepId, string> = {
    welcome: 'Welcome',
    appearance: 'Appearance',
    agent: 'Agent',
    providers: 'Providers',
    model: 'Model',
    done: 'Done'
  };

  const steps: StepId[] = isEmbedded ? ['welcome', 'appearance', 'providers', 'model', 'done'] : ['welcome', 'appearance', 'agent', 'providers', 'model', 'done'];
  let stepIndex = $state(0);
  let visited = $state(0);
  let skipped = $state<StepId[]>([]);
  let modelQuery = $state('');
  let retrying = $state(false);

  // Agent setup happens inside the wizard, so the user never has to leave it.
  const DEFAULT_AGENT_NAME = 'QMTCODE';
  const DEFAULT_AGENT_COMMAND = 'qmtcode --acp';
  let editingAgent = $state(false);
  let savingAgent = $state(false);
  let agentFormError = $state<string | null>(null);
  let draftName = $state(DEFAULT_AGENT_NAME);
  let draftTransport = $state<AgentConfig['transport']>('stdio');
  let draftCommandLine = $state(DEFAULT_AGENT_COMMAND);
  let draftWebSocketUrl = $state('');

  const step = $derived(steps[stepIndex]);
  const readiness = $derived(agentsStore.readiness);
  const agentId = $derived(readiness.agentId ?? agentsStore.primaryAgentId ?? '');
  const byId = $derived(Object.fromEntries(readiness.checks.map((check) => [check.id, check])) as Record<ReadinessCheckId, ReadinessCheck>);
  const agentConfig = $derived(agentsStore.configs.find((config) => config.id === agentId) ?? null);
  const agentStatus = $derived(agentId ? agentsStore.statuses[agentId] : undefined);

  const pa = new ProviderActionsController(() => agentId);
  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const providers = $derived(splitAuthEntries(agentId ? agentsStore.authProvidersByAgent[agentId] ?? [] : []).providers);
  const providerAuthCapabilities = $derived(providerAuthCapabilitiesFromAgent(agentId ? agentsStore.controlCapabilitiesByAgent[agentId] : null));
  const models = $derived(agentId ? agentsStore.modelsByAgent[agentId] ?? [] : []);

  const noAgentConfigured = $derived(byId.agent.status === 'blocked' && byId.agent.action?.kind === 'open-agents');
  const failingAgent = $derived.by(() => {
    const action = byId.agent.action;
    return action?.kind === 'retry-agent' ? agentsStore.configs.find((config) => config.id === action.agentId) ?? null : null;
  });
  const showAgentForm = $derived(byId.agent.status === 'blocked' && (noAgentConfigured || (editingAgent && failingAgent !== null)));
  const agentDraftEndpoint = $derived((draftTransport === 'websocket' ? draftWebSocketUrl : draftCommandLine).trim());
  const agentDraftValid = $derived(draftName.trim().length > 0 && agentDraftEndpoint.length > 0);

  const bootState = $derived(byId.agent.status === 'pending' ? 'connecting' : byId.agent.status === 'blocked' ? 'failed' : 'idle');

  // Startup log derived from readiness (never from timers), like the mobile boot log.
  const bootLog = $derived.by(() => {
    const entries: Array<{ label: string; check: ReadinessCheck }> = [
      { label: 'Starting agent', check: byId.agent },
      { label: 'Checking providers', check: byId.providers },
      { label: 'Loading models', check: byId.models }
    ];
    return entries
      .filter((entry) => entry.check.status !== 'not_applicable' || entry.check.id === 'agent')
      .map((entry) => ({
        label: entry.label,
        state: entry.check.status === 'ok' ? 'done' : entry.check.status === 'pending' ? 'current' : 'failed'
      }));
  });

  const canContinue = $derived.by(() => {
    switch (step) {
      case 'agent': return byId.agent.status === 'ok';
      case 'providers': return byId.providers.status === 'ok' || byId.providers.status === 'not_applicable';
      case 'model': return byId.model.status === 'ok';
      default: return true;
    }
  });

  onMount(() => {
    const requested = new URL(window.location.href).searchParams.get('step') as StepId | null;
    const index = requested ? steps.indexOf(requested) : -1;
    if (index > 0) {
      stepIndex = index;
      visited = index;
    }
  });

  function go(index: number) {
    stepIndex = Math.max(0, Math.min(steps.length - 1, index));
    visited = Math.max(visited, stepIndex);
    modelQuery = '';
  }

  function next() {
    skipped = skipped.filter((id) => id !== step);
    go(stepIndex + 1);
  }

  function skipStep() {
    if (!skipped.includes(step)) skipped = [...skipped, step];
    go(stepIndex + 1);
  }

  async function skipSetup() {
    markOnboardingSkipped();
    await goto('/');
  }

  async function finish() {
    markOnboardingCompleted();
    await goto('/');
    agentsStore.requestPromptFocus();
  }

  async function retryAgent() {
    const action = byId.agent.action;
    retrying = true;
    try {
      if (action?.kind === 'retry-agent') await agentsStore.restartConfiguredAgent(action.agentId);
      else if (agentId) await agentsStore.startConfiguredAgent(agentId);
    } finally {
      retrying = false;
    }
  }

  function editFailingAgent() {
    if (!failingAgent) return;
    draftName = failingAgent.name;
    draftTransport = failingAgent.transport;
    draftCommandLine = failingAgent.commandLine;
    draftWebSocketUrl = failingAgent.websocketUrl ?? '';
    agentFormError = null;
    editingAgent = true;
  }

  function cancelAgentEdit() {
    editingAgent = false;
    agentFormError = null;
  }

  async function saveAgent() {
    const name = draftName.trim();
    const endpoint = agentDraftEndpoint;
    if (!name || !endpoint || savingAgent) return;
    savingAgent = true;
    agentFormError = null;
    try {
      if (editingAgent && failingAgent) {
        const updates = draftTransport === 'websocket'
          ? { name, transport: draftTransport, commandLine: '', websocketUrl: endpoint }
          : { name, transport: draftTransport, commandLine: endpoint, websocketUrl: undefined, websocketSecure: undefined };
        agentsStore.updateConfig(failingAgent.id, updates);
        editingAgent = false;
        await agentsStore.refreshAgent({ ...failingAgent, ...updates });
        await agentsStore.restartConfiguredAgent(failingAgent.id);
      } else {
        const config = agentsStore.createConfig(name, draftTransport, endpoint);
        agentsStore.saveConfig(config);
        editingAgent = false;
        await agentsStore.refreshAgent(config);
        await agentsStore.startConfiguredAgent(config.id);
      }
    } catch (error) {
      agentFormError = error instanceof Error ? error.message : 'Unable to save this agent.';
    } finally {
      savingAgent = false;
    }
  }

  const isDone = (check: ReadinessCheck) => check.status === 'ok' || check.status === 'not_applicable';

  function summaryState(id: ReadinessCheckId): 'ready' | 'skipped' | 'missing' {
    // The Model row also covers the model list: with no models there is nothing to pick.
    const done = id === 'model' ? isDone(byId.models) && isDone(byId.model) : isDone(byId[id]);
    if (done) return 'ready';
    const steps: StepId[] = id === 'agent' ? ['agent'] : id === 'providers' ? ['providers'] : ['model', 'providers'];
    return steps.some((stepId) => skipped.includes(stepId)) ? 'skipped' : 'missing';
  }

  const SOURCE_LABELS: Record<string, string> = { bundled: 'Bundled with the app', path: 'Found on PATH', explicit: 'Custom path' };
</script>

{#snippet errorBlock(message: string)}
  <div class="state-inline-error" role="alert">
    <AlertTriangle size={15} aria-hidden="true" />
    <span class="min-w-0 flex-1">{message}</span>
  </div>
{/snippet}

<svelte:head>
  <title>Set up QueryMT</title>
</svelte:head>

<div class="setup-page" data-testid="setup-page">
  <div class="setup-column">
    <ol class="setup-steps" aria-label="Setup progress">
      {#each steps as id, index (id)}
        <li>
          <button
            type="button"
            class="setup-step"
            class:setup-step-current={index === stepIndex}
            class:setup-step-done={index < stepIndex}
            aria-current={index === stepIndex ? 'step' : undefined}
            disabled={index > visited}
            onclick={() => go(index)}
          >
            <span class="setup-step-dot" aria-hidden="true">{#if index < stepIndex}<Check class="setup-check" size={14} strokeWidth={2.4} />{:else}{index + 1}{/if}</span>
            <span>{STEP_LABELS[id]}</span>
          </button>
        </li>
      {/each}
    </ol>

    <section class="setup-card" aria-labelledby="setup-step-title">
      {#if step === 'welcome'}
        <div class="setup-hero">
          <BootMark state="idle" size={120} />
          <h1 id="setup-step-title" class="app-dialog-title">Welcome to QueryMT</h1>
          <p class="app-dialog-description">Let's get you ready to start your first session. We'll set the look of the app, check the agent, connect a model provider and pick a model. It takes about a minute, and you can skip any step.</p>
        </div>
      {:else if step === 'appearance'}
        <header class="setup-header">
          <h1 id="setup-step-title" class="app-dialog-title">Appearance</h1>
          <p class="app-dialog-description">Pick a theme and accent color. Changes apply right away, and you can change them later in Settings → Appearance.</p>
        </header>
        <div class="setup-appearance">
          <AppearanceControls />
        </div>
      {:else if step === 'agent'}
        <div class="setup-hero">
          <BootMark state={bootState} size={104} />
          <h1 id="setup-step-title" class="app-dialog-title">Agent</h1>
          <ul class="setup-boot-log" aria-live="polite" data-testid="setup-boot-log">
            {#each bootLog as entry (entry.label)}
              <li class={`setup-boot-log-${entry.state}`}>
                <span class="setup-boot-log-mark" aria-hidden="true">{#if entry.state === 'done'}<Check class="setup-check" size={13} strokeWidth={2.4} />{:else if entry.state === 'current'}<LoaderCircle size={12} class="animate-spin" />{:else}<X size={13} strokeWidth={2.4} />{/if}</span>
                {entry.label}{entry.state === 'current' ? '…' : ''}
              </li>
            {/each}
          </ul>
        </div>
        {#if byId.agent.status === 'ok' && agentConfig}
          <dl class="setup-facts">
            <div><dt>Agent</dt><dd>{agentConfig.name}</dd></div>
            {#if agentStatus?.version}<div><dt>Version</dt><dd>{agentStatus.version}</dd></div>{/if}
            {#if agentStatus?.programSource}<div><dt>Source</dt><dd>{SOURCE_LABELS[agentStatus.programSource] ?? agentStatus.programSource}</dd></div>{/if}
          </dl>
        {:else if showAgentForm}
          {#if noAgentConfigured}
            <p class="setup-note">No agent is configured yet. Add one to continue: a local command Desktop starts for you, or the address of an ACP WebSocket server that is already running.</p>
          {/if}
          <form class="app-dialog-form setup-agent-form" aria-label={noAgentConfigured ? 'Add agent' : 'Edit agent'} onsubmit={(event) => { event.preventDefault(); void saveAgent(); }}>
            <AgentConnectionFields
              bind:name={draftName}
              bind:transport={draftTransport}
              bind:commandLine={draftCommandLine}
              bind:websocketUrl={draftWebSocketUrl}
              disabled={savingAgent}
            />
            {#if agentFormError}{@render errorBlock(agentFormError)}{/if}
            <div class="setup-inline-actions">
              {#if !noAgentConfigured}
                <button class="action-btn" type="button" disabled={savingAgent} onclick={cancelAgentEdit}>Cancel</button>
              {/if}
              <button class="action-btn action-btn-accent" type="submit" disabled={!agentDraftValid || savingAgent}>
                {#if savingAgent}<LoaderCircle size={14} class="animate-spin" />{/if}
                {noAgentConfigured ? 'Add and start agent' : 'Save and restart'}
              </button>
            </div>
          </form>
        {:else if byId.agent.status === 'blocked'}
          <!-- Same error block as the Agents page: message with its actions inline. -->
          <div class="state-inline-error" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span class="min-w-0 flex-1">{byId.agent.reason}</span>
            {#if byId.agent.action?.kind === 'retry-agent'}
              <button class="action-btn action-btn-compact" type="button" disabled={retrying} onclick={retryAgent}>
                {#if retrying}<LoaderCircle size={14} class="animate-spin" />{/if} Retry
              </button>
            {/if}
            {#if failingAgent}
              <button class="action-btn action-btn-compact" type="button" disabled={retrying} onclick={editFailingAgent}>Edit agent</button>
            {/if}
          </div>
        {/if}
      {:else if step === 'providers'}
        <header class="setup-header">
          <h1 id="setup-step-title" class="app-dialog-title">Connect a provider</h1>
          <p class="app-dialog-description">Sign in or add an API key for at least one model provider.</p>
        </header>
        {#if byId.providers.status === 'not_applicable'}
          <p class="setup-note">{byId.agent.status === 'ok' ? 'This agent does not manage provider sign-in. Its models are configured on the agent.' : 'Start the agent first to see its providers.'}</p>
        {:else}
          {#if pa.pageError}{@render errorBlock(pa.pageError)}{/if}
          {#if byId.providers.status === 'ok'}<div class="alert-success setup-message">A provider is connected. You can add more or continue.</div>{/if}
          {#if providers.length === 0}
            <p class="setup-note">{byId.providers.status === 'pending' ? 'Checking providers…' : 'The agent reported no providers.'}</p>
          {:else}
            <div class="setup-scroll">
              <ProviderConnectionList
                {providers}
                authCapabilities={providerAuthCapabilities}
                pendingAction={pa.providerPendingAction}
                signInLocked={pa.oauthLocked}
                messages={pa.providerMessages}
                errors={pa.providerErrors}
                onSignIn={pa.handleOAuth}
                onCancelSignIn={pa.requestOAuthCancel}
                onDisconnect={pa.handleDisconnect}
                onSetApiKey={pa.handleSetApiToken}
                onClearApiKey={pa.handleClearApiToken}
                onAuthMethodChange={pa.handleAuthMethodChange}
                onDialogTrigger={pa.rememberProviderDialogTrigger}
              />
            </div>
          {/if}
        {/if}
      {:else if step === 'model'}
        <header class="setup-header">
          <h1 id="setup-step-title" class="app-dialog-title">Choose a model</h1>
          <p class="app-dialog-description">New sessions start with this model. QueryMT remembers it as the last used model for this agent.</p>
        </header>
        {#if models.length === 0}
          <p class="setup-note">{byId.models.reason ?? 'Loading models…'}</p>
          <div class="setup-inline-actions">
            <button class="action-btn" type="button" disabled={!agentId || agentsStore.modelLoadingByAgent[agentId]} onclick={() => agentsStore.refreshModelsForAgent(agentId)}>
              <RefreshCw size={14} /> Refresh models
            </button>
            <button class="action-btn" type="button" onclick={() => go(steps.indexOf('providers'))}>Back to providers</button>
          </div>
        {:else}
          <div class="setup-model-picker">
            <ModelPickerPanel
              {models}
              bind:query={modelQuery}
              recentModels={agentsStore.getRecentModels(agentId)}
              modelInfo={agentsStore.modelInfoByAgent[agentId] ?? {}}
              selectedModelId={agentsStore.getLaunchModelId(agentId)}
              loading={!!agentsStore.modelLoadingByAgent[agentId]}
              onSelect={(model) => agentsStore.chooseLaunchModel(agentId, getModelSelectionKey(model))}
              onRefresh={() => agentsStore.refreshModelsForAgent(agentId)}
            />
          </div>
        {/if}
      {:else}
        <div class="setup-hero">
          <BootMark state="idle" size={88} />
          <h1 id="setup-step-title" class="app-dialog-title">{readiness.setupComplete ? "You're all set" : 'Almost there'}</h1>
          <p class="app-dialog-description">{readiness.setupComplete ? 'QueryMT is ready for your first session.' : 'You can finish the remaining items later from the start screen.'}</p>
        </div>
        <ul class="setup-summary" data-testid="setup-summary">
          {#each [['agent', 'Agent'], ['providers', 'Providers'], ['model', 'Model']] as [id, label] (id)}
            {@const state = summaryState(id as ReadinessCheckId)}
            <li class={`setup-summary-${state}`} data-check={id}>
              <strong>{label}</strong>
              <span>{#if state === 'ready'}<Check class="setup-check" size={14} strokeWidth={2.4} aria-hidden="true" />Ready{:else if state === 'skipped'}Skipped, not set up{:else}Not set up{/if}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <footer class="setup-footer">
      {#if step === 'welcome'}
        <button class="action-btn" type="button" onclick={skipSetup}>Skip setup</button>
        <button class="action-btn action-btn-primary" type="button" onclick={next}>Get started</button>
      {:else if step === 'done'}
        <button class="action-btn" type="button" onclick={() => go(stepIndex - 1)}>Back</button>
        <button class="action-btn action-btn-primary" type="button" onclick={finish}>Start using QueryMT</button>
      {:else}
        <button class="action-btn" type="button" onclick={() => go(stepIndex - 1)}>Back</button>
        <span class="setup-footer-spacer"></span>
        <button class="setup-link-btn" type="button" onclick={skipSetup}>Skip setup</button>
        <button class="action-btn" type="button" onclick={skipStep}>Skip</button>
        <button class="action-btn action-btn-primary" type="button" disabled={!canContinue} onclick={next}>Continue</button>
      {/if}
    </footer>
  </div>

  <ProviderApiKeyDialog
    open={pa.tokenDialogProvider !== null}
    provider={pa.tokenDialogProvider}
    focusTarget={pa.providerDialogFocusTarget}
    portalTarget={overlayPortalTarget}
    bind:value={pa.tokenDialogValue}
    pending={!!pa.actionLoading}
    onClose={pa.closeTokenDialog}
    onSubmit={pa.submitApiToken}
  />
  <ProviderOAuthDialog
    open={pa.manualOAuthProvider !== null}
    provider={pa.manualOAuthProvider}
    focusTarget={pa.providerDialogFocusTarget}
    portalTarget={overlayPortalTarget}
    flowKind={pa.manualOAuthFlowKind}
    authorizationUrl={pa.manualOAuthAuthorizationUrl}
    urlCopied={pa.manualOAuthUrlCopied}
    needsCallbackInput={pa.manualOAuthNeedsCallbackInput}
    bind:value={pa.manualOAuthValue}
    waiting={pa.actionLoading?.startsWith('oauth:') ?? false}
    pending={!!pa.actionLoading}
    completing={pa.manualOAuthProvider ? pa.isOAuthCompleting(pa.manualOAuthProvider) : false}
    submitDisabled={pa.isManualOAuthSubmitDisabled()}
    onDismiss={pa.closeOrCancelManualOAuthDialog}
    onOpenAuthorizationUrl={pa.openManualOAuthAuthorizationUrl}
    onCopyAuthorizationUrl={pa.copyManualOAuthAuthorizationUrl}
    onCancelSignIn={() => pa.manualOAuthProvider && pa.requestOAuthCancel(pa.manualOAuthProvider)}
    onSubmit={pa.submitManualOAuth}
  />
  <ProviderDisconnectDialog
    open={pa.disconnectProviderPending !== null}
    provider={pa.disconnectProviderPending}
    focusTarget={pa.providerDialogFocusTarget}
    portalTarget={overlayPortalTarget}
    pending={!!pa.actionLoading}
    onClose={pa.closeDisconnectDialog}
    onConfirm={pa.confirmDisconnectProvider}
  />
  <ProviderClearKeyDialog
    open={pa.clearKeyProviderPending !== null}
    provider={pa.clearKeyProviderPending}
    focusTarget={pa.providerDialogFocusTarget}
    portalTarget={overlayPortalTarget}
    pending={!!pa.actionLoading}
    onClose={pa.closeClearKeyDialog}
    onConfirm={pa.confirmClearApiToken}
  />
</div>
