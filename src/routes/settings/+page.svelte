<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { LoaderCircle, RefreshCw } from '@lucide/svelte';
  import AppearanceSettingsPanel from '$lib/components/settings/AppearanceSettingsPanel.svelte';
  import GeneralSettingsPanel from '$lib/components/settings/GeneralSettingsPanel.svelte';
  import KeybindingsSettingsPanel from '$lib/components/settings/KeybindingsSettingsPanel.svelte';
  import ProfilesSettingsPanel from '$lib/components/settings/ProfilesSettingsPanel.svelte';
  import ProviderApiKeyDialog from '$lib/components/settings/ProviderApiKeyDialog.svelte';
  import ProviderClearKeyDialog from '$lib/components/settings/ProviderClearKeyDialog.svelte';
  import ProviderConnectionList from '$lib/components/settings/ProviderConnectionList.svelte';
  import ProviderDisconnectDialog from '$lib/components/settings/ProviderDisconnectDialog.svelte';
  import ProviderMaintenance from '$lib/components/settings/ProviderMaintenance.svelte';
  import ProviderOAuthDialog from '$lib/components/settings/ProviderOAuthDialog.svelte';
  import ProviderOverview from '$lib/components/settings/ProviderOverview.svelte';
  import { ProviderActionsController } from '$lib/components/settings/provider-actions.svelte';
  import SettingsSubnav, { type SettingsSectionId } from '$lib/components/settings/SettingsSubnav.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import {
    hasUsableProviderCredential,
    providerAuthCapabilitiesFromAgent
  } from '$lib/domain/provider-auth';
  import { isMcpAuthId, mcpServerOfAuthId, splitAuthEntries } from '$lib/domain/mcp-auth';
  import McpServerList from '$lib/components/settings/McpServerList.svelte';
  import { OAuthStatus } from '$lib/querymt/generated/types';
  import { platformCapabilities } from '$lib/platform/runtime';

  let selectedAgentId = $state('');
  let selectedSection = $state<SettingsSectionId>('general');
  let refreshingProviders = $state(false);
  let refreshingModels = $state(false);
  let updatingPlugins = $state(false);
  let maintenanceError = $state<string | null>(null);
  let maintenanceMessage = $state<string | null>(null);
  const pa = new ProviderActionsController(() => selectedAgentId);

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const authAgents = $derived.by(() =>
    agentsStore.configs.filter((config) => {
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.auth);
    })
  );
  const runningAgentCount = $derived(agentsStore.connectedAgents.length);

  $effect(() => {
    if (!selectedAgentId && authAgents.length > 0) {
      selectedAgentId = authAgents[0].id;
    }
    if (selectedAgentId && !authAgents.some((agent) => agent.id === selectedAgentId)) {
      selectedAgentId = authAgents[0]?.id ?? '';
    }
  });

  // MCP server logins share the auth status list but are not LLM providers.
  const authEntries = $derived.by(() => splitAuthEntries(selectedAgentId ? agentsStore.authProvidersByAgent[selectedAgentId] ?? [] : []));
  const providers = $derived(authEntries.providers);
  const mcpServers = $derived(authEntries.mcpServers);
  const hasMcpServers = $derived(
    authAgents.some((agent) => splitAuthEntries(agentsStore.authProvidersByAgent[agent.id] ?? []).mcpServers.length > 0)
  );
  const providerAuthCapabilities = $derived.by(() =>
    providerAuthCapabilitiesFromAgent(selectedAgentId ? agentsStore.controlCapabilitiesByAgent[selectedAgentId] : null)
  );
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

  onMount(() => {
    const section = new URL(window.location.href).searchParams.get('section');
    if (section === 'profiles' && !platformCapabilities.nativeProfileTemplates) {
      selectedSection = 'general';
    } else if (section === 'appearance' || section === 'general' || section === 'keybindings' || section === 'profiles' || section === 'providers' || section === 'connectors') {
      selectedSection = section;
    }
  });

  function selectSection(section: SettingsSectionId) {
    selectedSection = section;
    const url = new URL(window.location.href);
    if (section === 'general') url.searchParams.delete('section');
    else url.searchParams.set('section', section);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  async function refreshProviders() {
    if (!selectedAgentId) return;
    refreshingProviders = true;
    pa.clearPageStatus();
    try {
      await agentsStore.refreshAuthProviders(selectedAgentId);
    } catch (error) {
      pa.pageError = error instanceof Error ? error.message : 'Failed to refresh providers.';
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
</script>

<div class="settings-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Settings"
      description="Appearance, chat behavior, profiles, and provider access."
    />
  </div>

  <div class="settings-layout">
    <SettingsSubnav
      selected={selectedSection}
      showProfiles={platformCapabilities.nativeProfileTemplates}
      showConnectors={hasMcpServers || selectedSection === 'connectors'}
      onSelect={selectSection}
    />

    <div class="settings-content">
      {#if selectedSection === 'appearance'}
        <AppearanceSettingsPanel />
      {:else if selectedSection === 'general'}
        <GeneralSettingsPanel />
      {:else if selectedSection === 'keybindings'}
        <KeybindingsSettingsPanel />
      {:else if selectedSection === 'profiles' && platformCapabilities.nativeProfileTemplates}
        <ProfilesSettingsPanel />
      {:else if selectedSection === 'connectors'}
        <section class="settings-section">
          <div class="settings-section-header settings-section-header-action provider-panel-header">
            <div>
              <h2>Connectors</h2>
              <p>Sign in to OAuth-protected connectors. Tools become available in sessions started after signing in.</p>
            </div>
            <div class="provider-panel-actions">
              {#if authAgents.length > 1}
                <AppSelect bind:value={selectedAgentId} options={authAgents.map((agent) => ({ value: agent.id, label: agent.name }))} pill ariaLabel="Connectors agent" />
              {/if}
              <IconTooltipButton
                label={refreshingProviders ? 'Refreshing sign-in status…' : 'Refresh connectors'}
                icon={refreshingProviders ? LoaderCircle : RefreshCw}
                iconClass={refreshingProviders ? 'animate-spin' : ''}
                size={16}
                busy={refreshingProviders}
                disabled={!refreshingProviders && (!selectedAgentId || authLoading)}
                onclick={() => refreshProviders()}
              />
            </div>
          </div>

          {#if authError || pa.pageError}
            <div class="alert-error settings-section-message">{pa.pageError ?? authError}</div>
          {/if}
          {#if pa.pageMessage}
            <div class="alert-success settings-section-message">{pa.pageMessage}</div>
          {/if}

          <div class="settings-subsection" aria-label="Connector authentication">
            {#if mcpServers.length === 0 && !authLoading}
              <div class="surface-muted p-4 text-sm text-[var(--muted)]">
                No OAuth connectors are configured for this agent. Add <code>auth = {'{'} type = "oauth" {'}'}</code> to an HTTP <code>[[mcp]]</code> entry.
              </div>
            {:else}
              <McpServerList
                servers={mcpServers}
                pendingAction={pa.providerPendingAction}
                signInLocked={pa.oauthLocked}
                messages={pa.providerMessages}
                errors={pa.providerErrors}
                onSignIn={pa.handleOAuth}
                onCancelSignIn={pa.requestOAuthCancel}
                onDisconnect={pa.handleDisconnect}
                onDialogTrigger={pa.rememberProviderDialogTrigger}
              />
            {/if}
          </div>
        </section>
      {:else}
    {#if authAgents.length === 0}
      <section class="settings-section">
      <div class="settings-section-header">
        <div>
          <h2>Providers</h2>
          {#if runningAgentCount === 0}
            <p>The agent is not running, so providers cannot be shown. <a class="link" href="/agents">Open Agents</a> to start it or see why it failed.</p>
          {:else}
            <p>No connected agents currently advertise provider auth controls.</p>
          {/if}
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
              label={refreshingProviders ? 'Refreshing provider sign-in status…' : 'Refresh providers'}
              icon={refreshingProviders ? LoaderCircle : RefreshCw}
              iconClass={refreshingProviders ? 'animate-spin' : ''}
              size={16}
              busy={refreshingProviders}
              disabled={!refreshingProviders && (!selectedAgentId || authLoading)}
              onclick={() => refreshProviders()}
            />
          </div>
        </div>

        <ProviderOverview connected={connectedProviderCount} needsSetup={setupProviderCount} attention={attentionProviderCount} models={modelCount} />

      {#if authError || pa.pageError}
        <div class="alert-error settings-section-message">
          {pa.pageError ?? authError}
        </div>
      {/if}

      {#if pa.pageMessage}
        <div class="alert-success settings-section-message">
          {pa.pageMessage}
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
    label={pa.manualOAuthProvider && isMcpAuthId(pa.manualOAuthProvider.provider) ? mcpServerOfAuthId(pa.manualOAuthProvider.provider) : null}
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
