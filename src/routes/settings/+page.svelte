<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { LoaderCircle, RefreshCw, X } from '@lucide/svelte';
  import { Portal } from 'bits-ui';
  import GeneralSettingsPanel from '$lib/components/settings/GeneralSettingsPanel.svelte';
  import ProfilesSettingsPanel from '$lib/components/settings/ProfilesSettingsPanel.svelte';
  import ProviderConnectionList from '$lib/components/settings/ProviderConnectionList.svelte';
  import ProviderMaintenance from '$lib/components/settings/ProviderMaintenance.svelte';
  import ProviderOverview from '$lib/components/settings/ProviderOverview.svelte';
  import SettingsSubnav, { type SettingsSectionId } from '$lib/components/settings/SettingsSubnav.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { hasUsableProviderCredential } from '$lib/domain/provider-auth';
  import { AuthMethod, OAuthFlowKindTs, OAuthStatus, type AuthProviderEntry } from '$lib/querymt/generated/types';
  import { open } from '@tauri-apps/plugin-shell';

  let selectedAgentId = $state('');
  let actionLoading = $state<string | null>(null);
  let pageError = $state<string | null>(null);
  let pageMessage = $state<string | null>(null);
  let tokenDialogProvider = $state<AuthProviderEntry | null>(null);
  let tokenDialogValue = $state('');
  let manualOAuthProvider = $state<AuthProviderEntry | null>(null);
  let manualOAuthFlowId = $state('');
  let manualOAuthFlowKind = $state<OAuthFlowKindTs | null>(null);
  let manualOAuthAuthorizationUrl = $state('');
  let manualOAuthUrlCopied = $state(false);
  let manualOAuthNeedsCallbackInput = $state(false);
  let manualOAuthValue = $state('');
  let oauthCancelRequested = $state(false);
  let oauthCancelResolver: (() => void) | null = null;
  let disconnectProviderPending = $state<AuthProviderEntry | null>(null);
  let clearKeyProviderPending = $state<AuthProviderEntry | null>(null);
  let selectedSection = $state<SettingsSectionId>('general');
  let refreshingProviders = $state(false);
  let refreshingModels = $state(false);
  let updatingPlugins = $state(false);
  let maintenanceError = $state<string | null>(null);
  let maintenanceMessage = $state<string | null>(null);
  let providerPendingAction = $state<{ provider: string; action: string } | null>(null);
  let providerMessages = $state<Record<string, string | undefined>>({});
  let providerErrors = $state<Record<string, string | undefined>>({});

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const authAgents = $derived.by(() =>
    agentsStore.configs.filter((config) => {
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.auth);
    })
  );

  $effect(() => {
    if (!selectedAgentId && authAgents.length > 0) {
      selectedAgentId = authAgents[0].id;
    }
    if (selectedAgentId && !authAgents.some((agent) => agent.id === selectedAgentId)) {
      selectedAgentId = authAgents[0]?.id ?? '';
    }
  });

  const providers = $derived.by(() => (selectedAgentId ? agentsStore.authProvidersByAgent[selectedAgentId] ?? [] : []));
  const connectedProviderCount = $derived(providers.filter((provider) => hasUsableProviderCredential(provider)).length);
  const attentionProviderCount = $derived(
    providers.filter((provider) => !hasUsableProviderCredential(provider) && provider.oauth_status === OAuthStatus.Expired).length
  );
  const setupProviderCount = $derived(
    providers.filter((provider) => !hasUsableProviderCredential(provider) && provider.oauth_status !== OAuthStatus.Expired).length
  );
  const modelCount = $derived(selectedAgentId ? agentsStore.modelsByAgent[selectedAgentId]?.length ?? 0 : 0);
  const authLoading = $derived.by(() => (selectedAgentId ? agentsStore.authLoadingByAgent[selectedAgentId] ?? false : false));
  const authError = $derived.by(() => (selectedAgentId ? agentsStore.authErrorsByAgent[selectedAgentId] ?? null : null));
  const pluginUpdateStatus = $derived.by(() =>
    selectedAgentId ? agentsStore.pluginUpdateStatusByAgent[selectedAgentId] ?? null : null
  );
  const lastPluginUpdate = $derived.by(() => (selectedAgentId ? agentsStore.lastPluginUpdateByAgent[selectedAgentId] ?? null : null));
  const manualOAuthIsDevicePoll = $derived(manualOAuthFlowKind === OAuthFlowKindTs.DevicePoll);
  const manualOAuthHasAuthorizationUrl = $derived(Boolean(manualOAuthAuthorizationUrl));

  type OAuthPollResult = 'connected' | 'timeout' | 'cancelled';

  onMount(() => {
    const section = new URL(window.location.href).searchParams.get('section');
    if (section === 'general' || section === 'profiles' || section === 'providers') selectedSection = section;
  });

  function selectSection(section: SettingsSectionId) {
    selectedSection = section;
    const url = new URL(window.location.href);
    if (section === 'general') url.searchParams.delete('section');
    else url.searchParams.set('section', section);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function setBusy(value: string | null) {
    actionLoading = value;
  }

  function startProviderAction(provider: AuthProviderEntry, action: string) {
    providerPendingAction = { provider: provider.provider, action };
    providerMessages = { ...providerMessages, [provider.provider]: undefined };
    providerErrors = { ...providerErrors, [provider.provider]: undefined };
  }

  function finishProviderAction(provider: AuthProviderEntry, action: string) {
    if (providerPendingAction?.provider === provider.provider && providerPendingAction.action === action) {
      providerPendingAction = null;
    }
  }

  function setProviderMessage(provider: AuthProviderEntry, message: string) {
    providerMessages = { ...providerMessages, [provider.provider]: message };
    providerErrors = { ...providerErrors, [provider.provider]: undefined };
  }

  function setProviderError(provider: AuthProviderEntry, message: string) {
    providerErrors = { ...providerErrors, [provider.provider]: message };
    providerMessages = { ...providerMessages, [provider.provider]: undefined };
  }

  function isOAuthLoading(provider: AuthProviderEntry) {
    return actionLoading === `oauth:${provider.provider}`;
  }

  function isOAuthCompleting(provider: AuthProviderEntry) {
    return actionLoading === `oauth-complete:${provider.provider}`;
  }

  function isManualOAuthSubmitDisabled() {
    if (!manualOAuthProvider) return true;
    if (isOAuthCompleting(manualOAuthProvider)) return true;
    if (actionLoading && !isOAuthLoading(manualOAuthProvider)) return true;
    return !manualOAuthIsDevicePoll && !manualOAuthValue.trim();
  }

  function requestOAuthCancel(provider: AuthProviderEntry) {
    if (!isOAuthLoading(provider)) return;

    // UI-side cancellation only: QueryMT ACP auth has no cancel endpoint yet.
    // If stale backend flows become a problem, add backend cancel support instead of using logout, which deletes credentials.
    oauthCancelRequested = true;
    pageError = null;
    pageMessage = null;
    setProviderMessage(provider, `Cancelled sign-in for ${provider.display_name}.`);
    providerPendingAction = null;
    closeManualOAuthDialog();
    oauthCancelResolver?.();
  }

  function waitForOAuthPoll(delayMs: number) {
    return new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        oauthCancelResolver = null;
        resolve();
      }, delayMs);

      oauthCancelResolver = () => {
        window.clearTimeout(timeoutId);
        oauthCancelResolver = null;
        resolve();
      };
    });
  }

  async function pollProviderSignInUntilCancelled(agentId: string, providerName: string, attempts = 60, delayMs = 2000): Promise<OAuthPollResult> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (oauthCancelRequested) return 'cancelled';

      const providers = await agentsStore.refreshAuthProviders(agentId);
      if (oauthCancelRequested) return 'cancelled';

      const match = providers.find((entry) => entry.provider === providerName);
      if (match?.oauth_status === OAuthStatus.Connected) {
        await agentsStore.refreshModelsForAgent(agentId).catch(() => undefined);
        return 'connected';
      }

      await waitForOAuthPoll(delayMs);
    }

    return oauthCancelRequested ? 'cancelled' : 'timeout';
  }

  function closeTokenDialog() {
    tokenDialogProvider = null;
    tokenDialogValue = '';
  }

  function closeManualOAuthDialog() {
    manualOAuthProvider = null;
    manualOAuthFlowId = '';
    manualOAuthFlowKind = null;
    manualOAuthAuthorizationUrl = '';
    manualOAuthUrlCopied = false;
    manualOAuthNeedsCallbackInput = false;
    manualOAuthValue = '';
  }

  function showOAuthDialog(
    provider: AuthProviderEntry,
    flowId: string,
    flowKind: OAuthFlowKindTs | null | undefined,
    authorizationUrl: string | null | undefined,
    needsCallbackInput = false
  ) {
    manualOAuthProvider = provider;
    manualOAuthFlowId = flowId;
    manualOAuthFlowKind = flowKind ?? null;
    manualOAuthAuthorizationUrl = authorizationUrl ?? '';
    manualOAuthUrlCopied = false;
    manualOAuthNeedsCallbackInput = needsCallbackInput;
    manualOAuthValue = '';
  }

  async function openManualOAuthAuthorizationUrl() {
    if (!manualOAuthAuthorizationUrl || !manualOAuthProvider) return;
    await open(manualOAuthAuthorizationUrl);
    pageError = null;
    pageMessage = `Opened sign-in for ${manualOAuthProvider.display_name}.`;
  }

  async function copyManualOAuthAuthorizationUrl() {
    if (!manualOAuthAuthorizationUrl) return;
    try {
      await navigator.clipboard.writeText(manualOAuthAuthorizationUrl);
      manualOAuthUrlCopied = true;
      pageError = null;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to copy authorization URL.';
    }
  }

  function closeOrCancelManualOAuthDialog() {
    if (actionLoading?.startsWith('oauth:') && manualOAuthProvider) {
      requestOAuthCancel(manualOAuthProvider);
      return;
    }
    closeManualOAuthDialog();
  }

  function closeDisconnectDialog() {
    disconnectProviderPending = null;
  }

  function closeClearKeyDialog() {
    clearKeyProviderPending = null;
  }

  function closeTopmostDialog() {
    if (actionLoading) return false;

    if (tokenDialogProvider) {
      closeTokenDialog();
      return true;
    }

    if (manualOAuthProvider) {
      closeManualOAuthDialog();
      return true;
    }

    if (disconnectProviderPending) {
      closeDisconnectDialog();
      return true;
    }

    if (clearKeyProviderPending) {
      closeClearKeyDialog();
      return true;
    }

    return false;
  }

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (closeTopmostDialog()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeydown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeydown, { capture: true });
  });

  async function refreshProviders() {
    if (!selectedAgentId) return;
    refreshingProviders = true;
    pageError = null;
    pageMessage = null;
    try {
      await agentsStore.refreshAuthProviders(selectedAgentId);
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to refresh providers.';
    } finally {
      refreshingProviders = false;
    }
  }

  async function refreshModels() {
    if (!selectedAgentId) return;
    refreshingModels = true;
    maintenanceError = null;
    maintenanceMessage = null;
    try {
      await agentsStore.refreshModelsForAgent(selectedAgentId);
      maintenanceMessage = `Refreshed ${agentsStore.modelsByAgent[selectedAgentId]?.length ?? 0} models.`;
    } catch (error) {
      maintenanceError = error instanceof Error ? error.message : 'Failed to refresh models.';
    } finally {
      refreshingModels = false;
    }
  }

  async function updatePlugins() {
    if (!selectedAgentId) return;
    updatingPlugins = true;
    maintenanceError = null;
    maintenanceMessage = null;
    try {
      const results = await agentsStore.updatePluginsForAgent(selectedAgentId);
      const succeeded = results.filter((entry) => entry.success).length;
      const failed = results.length - succeeded;
      maintenanceMessage = failed === 0 ? `Updated ${succeeded} plugin${succeeded === 1 ? '' : 's'}.` : null;
      if (failed > 0) maintenanceError = `${failed} of ${results.length} plugin updates failed.`;
    } catch (error) {
      maintenanceError = error instanceof Error ? error.message : 'Failed to update plugins.';
    } finally {
      updatingPlugins = false;
    }
  }

  async function submitManualOAuth() {
    if (!selectedAgentId || !manualOAuthProvider || !manualOAuthFlowId) {
      return;
    }
    if (!manualOAuthIsDevicePoll && !manualOAuthValue.trim()) {
      return;
    }

    const agentId = selectedAgentId;
    const provider = manualOAuthProvider;
    const flowId = manualOAuthFlowId;
    const response = manualOAuthIsDevicePoll ? '' : manualOAuthValue.trim();

    if (isOAuthLoading(provider)) {
      oauthCancelRequested = true;
      oauthCancelResolver?.();
    }

    setBusy(`oauth-complete:${provider.provider}`);
    startProviderAction(provider, 'oauth-complete');
    pageError = null;
    pageMessage = null;

    try {
      const result = await agentsStore.completeProviderSignIn(agentId, flowId, response);
      if (result.success) {
        const message = result.message || `Successfully authenticated with ${provider.display_name}.`;
        pageMessage = message;
        setProviderMessage(provider, message);
        closeManualOAuthDialog();
      } else {
        const message = result.message || `Failed to complete sign-in for ${provider.display_name}.`;
        pageError = message;
        setProviderError(provider, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to complete sign-in for ${provider.display_name}.`;
      pageError = message;
      setProviderError(provider, message);
    } finally {
      setBusy(null);
      finishProviderAction(provider, 'oauth-complete');
    }
  }

  async function submitApiToken() {
    if (!selectedAgentId || !tokenDialogProvider || !tokenDialogValue.trim()) {
      return;
    }

    const provider = tokenDialogProvider;
    setBusy(`token:${provider.provider}`);
    startProviderAction(provider, 'token');
    pageError = null;
    pageMessage = null;

    try {
      const result = await agentsStore.setProviderApiToken(
        selectedAgentId,
        provider.provider,
        tokenDialogValue.trim()
      );
      if (result.success) {
        const message = result.message || `Stored API key for ${provider.display_name}.`;
        pageMessage = message;
        setProviderMessage(provider, message);
        closeTokenDialog();
      } else {
        const message = result.message || `Failed to store API key for ${provider.display_name}.`;
        pageError = message;
        setProviderError(provider, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to store API key for ${provider.display_name}.`;
      pageError = message;
      setProviderError(provider, message);
    } finally {
      setBusy(null);
      finishProviderAction(provider, 'token');
    }
  }

  async function confirmDisconnectProvider() {
    if (!selectedAgentId || !disconnectProviderPending) return;

    const provider = disconnectProviderPending;
    setBusy(`disconnect:${provider.provider}`);
    startProviderAction(provider, 'disconnect');
    pageError = null;
    pageMessage = null;

    try {
      const result = await agentsStore.disconnectProvider(selectedAgentId, provider.provider);
      if (result.success) {
        const message = result.message || `Disconnected ${provider.display_name}.`;
        pageMessage = message;
        setProviderMessage(provider, message);
        closeDisconnectDialog();
      } else {
        const message = result.message || `Failed to disconnect ${provider.display_name}.`;
        pageError = message;
        setProviderError(provider, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to disconnect ${provider.display_name}.`;
      pageError = message;
      setProviderError(provider, message);
    } finally {
      setBusy(null);
      finishProviderAction(provider, 'disconnect');
    }
  }

  async function confirmClearApiToken() {
    if (!selectedAgentId || !clearKeyProviderPending) return;

    const provider = clearKeyProviderPending;
    setBusy(`clear-token:${provider.provider}`);
    startProviderAction(provider, 'clear-token');
    pageError = null;
    pageMessage = null;

    try {
      const result = await agentsStore.clearProviderApiToken(selectedAgentId, provider.provider);
      if (result.success) {
        const message = result.message || `Cleared API key for ${provider.display_name}.`;
        pageMessage = message;
        setProviderMessage(provider, message);
        closeClearKeyDialog();
      } else {
        const message = result.message || `Failed to clear API key for ${provider.display_name}.`;
        pageError = message;
        setProviderError(provider, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to clear API key for ${provider.display_name}.`;
      pageError = message;
      setProviderError(provider, message);
    } finally {
      setBusy(null);
      finishProviderAction(provider, 'clear-token');
    }
  }

  async function handleOAuth(provider: AuthProviderEntry) {
    if (!selectedAgentId) return;
    const agentId = selectedAgentId;
    setBusy(`oauth:${provider.provider}`);
    startProviderAction(provider, 'oauth');
    oauthCancelRequested = false;
    pageError = null;
    pageMessage = null;

    try {
      const start = await agentsStore.startProviderSignIn(agentId, provider.provider);
      const providerName = start.provider || provider.provider;

      const flowKind = start.flow_kind ?? null;
      const waitsForRedirectCallback = Boolean(start.authorization_url && flowKind === OAuthFlowKindTs.RedirectCode);
      const showsCallbackInput = flowKind !== OAuthFlowKindTs.DevicePoll;

      showOAuthDialog(provider, start.flow_id, flowKind, start.authorization_url, showsCallbackInput);

      if (!waitsForRedirectCallback) {
        return;
      }

      const pollResult = await pollProviderSignInUntilCancelled(agentId, providerName);
      if (pollResult === 'connected') {
        const message = `Successfully authenticated with ${providerName}.`;
        closeManualOAuthDialog();
        pageMessage = message;
        setProviderMessage(provider, message);
        return;
      }
      if (pollResult === 'cancelled') {
        return;
      }

      pageMessage = `Waiting for ${providerName} sign-in to complete. Paste the callback URL or code below if automatic completion does not finish.`;
      manualOAuthNeedsCallbackInput = true;
    } catch (error) {
      if (!oauthCancelRequested) {
        const message = error instanceof Error ? error.message : `Failed to start sign-in for ${provider.provider}.`;
        pageError = message;
        setProviderError(provider, message);
      }
    } finally {
      oauthCancelRequested = false;
      oauthCancelResolver = null;
      if (actionLoading === `oauth:${provider.provider}`) {
        setBusy(null);
        finishProviderAction(provider, 'oauth');
      }
    }
  }

  function handleDisconnect(provider: AuthProviderEntry) {
    disconnectProviderPending = provider;
  }

  function handleSetApiToken(provider: AuthProviderEntry) {
    tokenDialogProvider = provider;
    tokenDialogValue = '';
  }

  function handleClearApiToken(provider: AuthProviderEntry) {
    clearKeyProviderPending = provider;
  }

  async function handleAuthMethodChange(provider: AuthProviderEntry, value: string) {
    if (!selectedAgentId || value === 'auto') return;
    setBusy(`method:${provider.provider}`);
    startProviderAction(provider, 'method');
    pageError = null;
    pageMessage = null;
    try {
      const result = await agentsStore.setProviderAuthMethod(selectedAgentId, provider.provider, value as AuthMethod);
      if (result.success) {
        const message = result.message || `Updated auth method for ${provider.display_name}.`;
        pageMessage = message;
        setProviderMessage(provider, message);
      } else {
        const message = result.message || `Failed to update auth method for ${provider.display_name}.`;
        pageError = message;
        setProviderError(provider, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to update auth method for ${provider.display_name}.`;
      pageError = message;
      setProviderError(provider, message);
    } finally {
      setBusy(null);
      finishProviderAction(provider, 'method');
    }
  }
</script>

<div class="settings-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Settings"
      description="Appearance, chat behavior, profiles, and provider access."
    />
  </div>

  <div class="settings-layout">
    <SettingsSubnav selected={selectedSection} onSelect={selectSection} />

    <div class="settings-content">
      {#if selectedSection === 'general'}
        <GeneralSettingsPanel />
      {:else if selectedSection === 'profiles'}
        <ProfilesSettingsPanel />
      {:else}
    {#if authAgents.length === 0}
      <section class="settings-section">
      <div class="settings-section-header">
        <div>
          <h2>Providers</h2>
          <p>No connected agents currently advertise provider auth controls.</p>
        </div>
        </div>
      </section>
    {:else}
      <section class="settings-section">
        <div class="settings-section-header settings-section-header-action provider-panel-header">
          <div>
            <h2>Providers</h2>
            <p>Authentication for models and services.</p>
          </div>
          <div class="provider-panel-actions">
            {#if authAgents.length > 1}
              <AppSelect bind:value={selectedAgentId} options={authAgents.map((agent) => ({ value: agent.id, label: agent.name }))} pill ariaLabel="Provider agent" />
            {/if}
            <IconTooltipButton
              label={refreshingProviders ? 'Refreshing providers' : 'Refresh providers'}
              icon={refreshingProviders ? LoaderCircle : RefreshCw}
              iconClass={refreshingProviders ? 'animate-spin' : ''}
              size={16}
              disabled={!selectedAgentId || authLoading || refreshingProviders}
              onclick={() => refreshProviders()}
            />
          </div>
        </div>

        <ProviderOverview connected={connectedProviderCount} needsSetup={setupProviderCount} attention={attentionProviderCount} models={modelCount} />

      {#if authError || pageError}
        <div class="alert-error settings-section-message">
          {pageError ?? authError}
        </div>
      {/if}

      {#if pageMessage}
        <div class="alert-success settings-section-message">
          {pageMessage}
        </div>
      {/if}

        <div class="settings-subsection" aria-label="Provider authentication">
          {#if providers.length === 0 && !authLoading}
            <div class="surface-muted p-4 text-sm text-[var(--muted)]">
              No auth-enabled providers reported by this agent.
            </div>
          {:else}
            <ProviderConnectionList
              {providers}
              pendingAction={providerPendingAction}
              messages={providerMessages}
              errors={providerErrors}
              onSignIn={handleOAuth}
              onCancelSignIn={requestOAuthCancel}
              onDisconnect={handleDisconnect}
              onSetApiKey={handleSetApiToken}
              onClearApiKey={handleClearApiToken}
              onAuthMethodChange={handleAuthMethodChange}
            />
          {/if}
        </div>

        <ProviderMaintenance
          {modelCount}
          {refreshingModels}
          {updatingPlugins}
          pluginProgress={pluginUpdateStatus}
          {lastPluginUpdate}
          error={maintenanceError}
          message={maintenanceMessage}
          onRefreshModels={refreshModels}
          onUpdatePlugins={updatePlugins}
        />
      </section>
    {/if}
      {/if}
    </div>
  </div>

  {#if tokenDialogProvider}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close API key dialog" onclick={() => closeTopmostDialog()}></button>
        <div class="dialog-modal-panel relative z-10" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div class="dialog-header">
            <div class="dialog-header-title-block">
              <div class="dialog-title">Set API key</div>
              <div class="dialog-subtitle">Store a key for {tokenDialogProvider.display_name} in the desktop agent keyring.</div>
            </div>
            <div class="dialog-header-actions">
              <button class="dialog-close-button" type="button" aria-label="Close API key dialog" onclick={() => closeTokenDialog()} disabled={!!actionLoading}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div class="dialog-body">
            <div class="dialog-form">
              <div class="dialog-row-group">
                <label class="dialog-row dialog-row-stacked">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">API key</div>
                    <div class="dialog-row-description">Stored securely in the desktop keyring.</div>
                  </div>
                  <input class="input-shell w-full" type="password" bind:value={tokenDialogValue} placeholder="Paste API key" />
                </label>
              </div>

              <div class="dialog-footer">
                <button class="action-btn" type="button" onclick={() => closeTokenDialog()} disabled={!!actionLoading}>Cancel</button>
                <button class="action-btn action-btn-primary" type="button" onclick={() => submitApiToken()} disabled={!!actionLoading || !tokenDialogValue.trim()}>
                  Save key
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  {/if}

  {#if manualOAuthProvider}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close OAuth dialog" onclick={() => closeOrCancelManualOAuthDialog()}></button>
        <div class="dialog-modal-panel relative z-10" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div class="dialog-header">
            <div class="dialog-header-title-block">
              <div class="dialog-title">Complete OAuth sign-in</div>
              <div class="dialog-subtitle">
                {#if manualOAuthIsDevicePoll}
                  Open or copy the device authorization URL for {manualOAuthProvider.display_name}, approve access, then check whether authentication completed.
                {:else if manualOAuthNeedsCallbackInput && manualOAuthHasAuthorizationUrl}
                  Open or copy the authorization URL for {manualOAuthProvider.display_name}. We'll detect completion automatically, or you can paste a callback URL/code.
                {:else if manualOAuthNeedsCallbackInput}
                  Paste the callback URL or returned code for {manualOAuthProvider.display_name}.
                {:else}
                  Open or copy the authorization URL for {manualOAuthProvider.display_name}. We'll detect completion automatically.
                {/if}
              </div>
            </div>
            <div class="dialog-header-actions">
              <button class="dialog-close-button" type="button" aria-label="Close OAuth dialog" onclick={() => closeOrCancelManualOAuthDialog()}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div class="dialog-body">
            <div class="dialog-form">
              <div class="dialog-row-group">
                {#if manualOAuthHasAuthorizationUrl}
                  <div class="dialog-row dialog-row-stacked">
                    <div class="dialog-row-main">
                      <div class="dialog-row-title">Authorization URL</div>
                      <div class="dialog-row-description">Open this URL in your browser or copy it if you want to continue sign-in elsewhere.</div>
                    </div>
                    <input class="input-shell dialog-code-field w-full" readonly value={manualOAuthAuthorizationUrl} aria-label="Authorization URL" title={manualOAuthAuthorizationUrl} />
                    <div class="dialog-segmented dialog-segmented-two">
                      <button class="action-btn dialog-segmented-button" type="button" onclick={() => openManualOAuthAuthorizationUrl()} disabled={!!actionLoading && !actionLoading.startsWith('oauth:')}>Open in browser</button>
                      <button class="action-btn dialog-segmented-button" type="button" onclick={() => copyManualOAuthAuthorizationUrl()}>
                        {manualOAuthUrlCopied ? 'Copied' : 'Copy URL'}
                      </button>
                    </div>
                  </div>
                {/if}

                {#if manualOAuthNeedsCallbackInput && !manualOAuthIsDevicePoll}
                  <label class="dialog-row dialog-row-stacked">
                    <div class="dialog-row-main">
                      <div class="dialog-row-title">Callback URL or code</div>
                      <div class="dialog-row-description">
                        {manualOAuthHasAuthorizationUrl ? 'Paste it here if the local callback does not complete automatically.' : 'Paste the browser callback URL or authorization code to complete sign-in manually.'}
                      </div>
                    </div>
                    <textarea class="input-shell w-full min-h-28" bind:value={manualOAuthValue} placeholder="https://... or pasted code"></textarea>
                  </label>
                {/if}
              </div>

              {#if actionLoading?.startsWith('oauth:')}
                <div class="dialog-status-row" role="status">
                  <LoaderCircle size={15} class="animate-spin" />
                  <span>Waiting for authentication. Paste a code below if the browser does not return automatically.</span>
                </div>
              {/if}

              <div class="dialog-footer">
                {#if actionLoading?.startsWith('oauth:') && manualOAuthProvider}
                  <button class="action-btn action-btn-danger" type="button" onclick={() => manualOAuthProvider && requestOAuthCancel(manualOAuthProvider)}>Cancel sign-in</button>
                {:else}
                  <button class="action-btn" type="button" onclick={() => closeManualOAuthDialog()} disabled={!!actionLoading}>Cancel</button>
                {/if}
                {#if manualOAuthIsDevicePoll || manualOAuthNeedsCallbackInput}
                  <button class="action-btn action-btn-primary" type="button" onclick={() => submitManualOAuth()} disabled={isManualOAuthSubmitDisabled()}>
                    {manualOAuthIsDevicePoll ? 'Check authentication' : isOAuthCompleting(manualOAuthProvider) ? 'Completing...' : 'Complete sign-in'}
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  {/if}

  {#if disconnectProviderPending}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close disconnect confirmation" onclick={() => closeTopmostDialog()}></button>
        <div class="dialog-modal-panel dialog-modal-panel-small relative z-10" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div class="dialog-header">
            <div class="dialog-header-title-block">
              <div class="dialog-title">Disconnect provider</div>
              <div class="dialog-subtitle">Remove OAuth credentials for {disconnectProviderPending.display_name}?</div>
            </div>
            <div class="dialog-header-actions">
              <button class="dialog-close-button" type="button" aria-label="Close disconnect confirmation" onclick={() => closeDisconnectDialog()} disabled={!!actionLoading}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div class="dialog-body">
            <div class="dialog-form">
              <div class="dialog-row-group">
                <div class="dialog-row dialog-row-muted dialog-row-full">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">OAuth access will be removed</div>
                    <div class="dialog-row-description">You can sign in again from Authentication.</div>
                  </div>
                </div>
              </div>

              <div class="dialog-footer">
                <button class="action-btn" type="button" onclick={() => closeDisconnectDialog()} disabled={!!actionLoading}>Cancel</button>
                <button class="action-btn action-btn-danger" type="button" onclick={() => confirmDisconnectProvider()} disabled={!!actionLoading}>Disconnect</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  {/if}

  {#if clearKeyProviderPending}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close clear key confirmation" onclick={() => closeTopmostDialog()}></button>
        <div class="dialog-modal-panel dialog-modal-panel-small relative z-10" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div class="dialog-header">
            <div class="dialog-header-title-block">
              <div class="dialog-title">Clear stored API key</div>
              <div class="dialog-subtitle">Remove the saved key for {clearKeyProviderPending.display_name}?</div>
            </div>
            <div class="dialog-header-actions">
              <button class="dialog-close-button" type="button" aria-label="Close clear key confirmation" onclick={() => closeClearKeyDialog()} disabled={!!actionLoading}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div class="dialog-body">
            <div class="dialog-form">
              <div class="dialog-row-group">
                <div class="dialog-row dialog-row-muted dialog-row-full">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">The key will be removed from the desktop keyring</div>
                    <div class="dialog-row-description">Environment variables are not changed.</div>
                  </div>
                </div>
              </div>

              <div class="dialog-footer">
                <button class="action-btn" type="button" onclick={() => closeClearKeyDialog()} disabled={!!actionLoading}>Cancel</button>
                <button class="action-btn action-btn-danger" type="button" onclick={() => confirmClearApiToken()} disabled={!!actionLoading}>Clear key</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  {/if}
</div>
