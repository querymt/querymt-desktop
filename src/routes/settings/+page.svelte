<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { KeyRound, LogIn, LogOut, RefreshCw, Trash2 } from '@lucide/svelte';
  import { Portal } from 'bits-ui';
  import AppCheckbox from '$lib/components/primitives/AppCheckbox.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { appearanceStore, type AppearanceThemeMode } from '$lib/stores/appearance.svelte';
  import { windowDecorationsStore } from '$lib/stores/window-decorations.svelte';
  import { AuthMethod, OAuthFlowKindTs, OAuthStatus, type AuthProviderEntry } from '$lib/querymt/generated/types';
  import { enableProfileTemplate, listProfileTemplates, type ProfileTemplateInfo } from '$lib/querymt/profile-templates';

  let selectedAgentId = $state('');
  let actionLoading = $state<string | null>(null);
  let pageError = $state<string | null>(null);
  let pageMessage = $state<string | null>(null);
  let tokenDialogProvider = $state<AuthProviderEntry | null>(null);
  let tokenDialogValue = $state('');
  let manualOAuthProvider = $state<AuthProviderEntry | null>(null);
  let manualOAuthFlowId = $state('');
  let manualOAuthValue = $state('');
  let disconnectProviderPending = $state<AuthProviderEntry | null>(null);
  let clearKeyProviderPending = $state<AuthProviderEntry | null>(null);
  let profileTemplates = $state<ProfileTemplateInfo[]>([]);
  let profileTemplatesLoading = $state(false);
  let profileTemplateError = $state<string | null>(null);

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const selectedAgent = $derived.by(() =>
    selectedAgentId ? agentsStore.configs.find((config) => config.id === selectedAgentId) ?? null : null
  );

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

  const selectedCapabilities = $derived.by(() =>
    selectedAgentId ? agentsStore.controlCapabilitiesByAgent[selectedAgentId] ?? null : null
  );
  const providers = $derived.by(() => (selectedAgentId ? agentsStore.authProvidersByAgent[selectedAgentId] ?? [] : []));
  const sortedProviders = $derived.by(() => sortProviders(providers));
  const authLoading = $derived.by(() => (selectedAgentId ? agentsStore.authLoadingByAgent[selectedAgentId] ?? false : false));
  const authError = $derived.by(() => (selectedAgentId ? agentsStore.authErrorsByAgent[selectedAgentId] ?? null : null));
  const modelLoading = $derived.by(() => (selectedAgentId ? agentsStore.modelLoadingByAgent[selectedAgentId] ?? false : false));
  const pluginUpdateStatus = $derived.by(() =>
    selectedAgentId ? agentsStore.pluginUpdateStatusByAgent[selectedAgentId] ?? null : null
  );
  const lastPluginUpdate = $derived.by(() => (selectedAgentId ? agentsStore.lastPluginUpdateByAgent[selectedAgentId] ?? null : null));

  onMount(() => {
    appearanceStore.initialize();
    void windowDecorationsStore.initialize();
  });

  const themeOptions: Array<{ value: AppearanceThemeMode; label: string }> = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];

  const authMethodOptions: Array<{ value: AuthMethod | 'auto'; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: AuthMethod.OAuth, label: 'OAuth' },
    { value: AuthMethod.ApiKey, label: 'API key' },
    { value: AuthMethod.EnvVar, label: 'Env var' }
  ];

  onMount(() => {
    void refreshProfileTemplates();
  });

  async function refreshProfileTemplates() {
    profileTemplatesLoading = true;
    profileTemplateError = null;
    try {
      profileTemplates = await listProfileTemplates();
    } catch (error) {
      profileTemplateError = error instanceof Error ? error.message : 'Failed to load profile templates.';
    } finally {
      profileTemplatesLoading = false;
    }
  }

  async function enableTemplate(template: ProfileTemplateInfo) {
    setBusy(`profile-template:${template.id}`);
    pageError = null;
    pageMessage = null;
    try {
      const updated = await enableProfileTemplate(template.id);
      profileTemplates = profileTemplates.map((entry) => (entry.id === updated.id ? updated : entry));
      await agentsStore.refreshManagedProfiles();
      pageMessage = `Enabled ${updated.name}. The running agent will pick up profile changes automatically.`;
    } catch (error) {
      pageError = error instanceof Error ? error.message : `Failed to enable ${template.name}.`;
    } finally {
      setBusy(null);
    }
  }

  function sortProviders(entries: AuthProviderEntry[]) {
    return [...entries].sort((left, right) => {
      const leftRank = providerSortRank(left);
      const rightRank = providerSortRank(right);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.display_name.localeCompare(right.display_name);
    });
  }

  function hasUsableCredential(provider: AuthProviderEntry) {
    return provider.oauth_status === OAuthStatus.Connected || provider.has_stored_api_key || provider.has_env_api_key;
  }

  function providerSortRank(provider: AuthProviderEntry) {
    if (hasUsableCredential(provider)) return 0;
    if (provider.oauth_status === OAuthStatus.Expired) return 1;
    return 2;
  }

  function authStatusTone(provider: AuthProviderEntry) {
    if (hasUsableCredential(provider)) return 'connected';
    if (provider.oauth_status === OAuthStatus.Expired) return 'warning';
    return 'muted';
  }

  function authStatusLabel(provider: AuthProviderEntry) {
    if (provider.oauth_status === OAuthStatus.Connected) return 'Connected';
    if (provider.has_stored_api_key) return 'API key stored';
    if (provider.has_env_api_key) return 'Env key available';
    if (provider.oauth_status === OAuthStatus.Expired) return 'OAuth expired';
    if (provider.oauth_status === OAuthStatus.NotAuthenticated) return 'Not signed in';
    return 'Not configured';
  }

  function authDetail(provider: AuthProviderEntry) {
    if (provider.oauth_status === OAuthStatus.Connected) return 'OAuth credentials saved';
    if (provider.has_stored_api_key) return 'Stored in desktop keyring';
    if (provider.has_env_api_key) return provider.env_var_name ? `Environment key ${provider.env_var_name}` : 'Environment key available';
    if (provider.oauth_status === OAuthStatus.Expired) return 'Sign in again to refresh OAuth';
    if (provider.supports_oauth) return 'OAuth available';
    return provider.env_var_name ? 'Environment variable supported' : 'API key authentication supported';
  }

  function authHint(provider: AuthProviderEntry) {
    if (hasUsableCredential(provider)) return '';
    if (provider.oauth_status === OAuthStatus.Expired) return 'Reconnect this provider to resume OAuth access.';
    if (provider.oauth_status === OAuthStatus.NotAuthenticated) return 'Sign in with OAuth to enable this provider.';
    if (provider.env_var_name && provider.preferred_method === AuthMethod.EnvVar) return `Set ${provider.env_var_name} in your environment.`;
    if (provider.preferred_method === AuthMethod.ApiKey) return 'Store an API key in the desktop keyring.';
    return provider.env_var_name ? `Set ${provider.env_var_name} or store an API key.` : 'Store an API key to enable this provider.';
  }

  function selectedCapabilitySummary() {
    if (!selectedCapabilities) return authLoading ? 'Refreshing provider capabilities' : 'No capabilities reported yet';

    const details = [`API v${selectedCapabilities.querymt_control_version}`, 'Auth'];
    if (selectedCapabilities.features.models) details.push('Models');
    return details.join(' · ');
  }

  function setBusy(value: string | null) {
    actionLoading = value;
  }

  function closeTokenDialog() {
    tokenDialogProvider = null;
    tokenDialogValue = '';
  }

  function closeManualOAuthDialog() {
    manualOAuthProvider = null;
    manualOAuthFlowId = '';
    manualOAuthValue = '';
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
    setBusy('refresh');
    pageError = null;
    pageMessage = null;
    try {
      await agentsStore.refreshAuthProviders(selectedAgentId);
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to refresh providers.';
    } finally {
      setBusy(null);
    }
  }

  async function refreshModels() {
    if (!selectedAgentId) return;
    setBusy('refresh-models');
    pageError = null;
    pageMessage = null;
    try {
      await agentsStore.refreshModelsForAgent(selectedAgentId);
      pageMessage = `Refreshed models for ${selectedAgent?.name ?? 'selected agent'}.`;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to refresh models.';
    } finally {
      setBusy(null);
    }
  }

  async function updatePlugins() {
    if (!selectedAgentId) return;
    setBusy('update-plugins');
    pageError = null;
    pageMessage = null;
    try {
      const results = await agentsStore.updatePluginsForAgent(selectedAgentId);
      const succeeded = results.filter((entry) => entry.success).length;
      const failed = results.length - succeeded;
      pageMessage =
        failed === 0
          ? `Updated ${succeeded} plugin${succeeded === 1 ? '' : 's'}.`
          : `Plugin update finished: ${succeeded} succeeded, ${failed} failed.`;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to update plugins.';
    } finally {
      setBusy(null);
    }
  }

  async function submitManualOAuth() {
    if (!selectedAgentId || !manualOAuthProvider || !manualOAuthFlowId || !manualOAuthValue.trim()) {
      return;
    }

    setBusy(`oauth-complete:${manualOAuthProvider.provider}`);
    pageError = null;
    pageMessage = null;

    try {
      const result = await agentsStore.completeProviderSignIn(
        selectedAgentId,
        manualOAuthFlowId,
        manualOAuthValue.trim()
      );
      if (result.success) {
        pageMessage = result.message || `Successfully authenticated with ${manualOAuthProvider.display_name}.`;
        closeManualOAuthDialog();
      } else {
        pageError = result.message || `Failed to complete sign-in for ${manualOAuthProvider.display_name}.`;
      }
    } catch (error) {
      pageError = error instanceof Error ? error.message : `Failed to complete sign-in for ${manualOAuthProvider.display_name}.`;
    } finally {
      setBusy(null);
    }
  }

  async function submitApiToken() {
    if (!selectedAgentId || !tokenDialogProvider || !tokenDialogValue.trim()) {
      return;
    }

    setBusy(`token:${tokenDialogProvider.provider}`);
    pageError = null;
    pageMessage = null;

    try {
      const result = await agentsStore.setProviderApiToken(
        selectedAgentId,
        tokenDialogProvider.provider,
        tokenDialogValue.trim()
      );
      if (result.success) {
        pageMessage = result.message || `Stored API key for ${tokenDialogProvider.display_name}.`;
        closeTokenDialog();
      } else {
        pageError = result.message || `Failed to store API key for ${tokenDialogProvider.display_name}.`;
      }
    } catch (error) {
      pageError = error instanceof Error ? error.message : `Failed to store API key for ${tokenDialogProvider.display_name}.`;
    } finally {
      setBusy(null);
    }
  }

  async function confirmDisconnectProvider() {
    if (!selectedAgentId || !disconnectProviderPending) return;

    const provider = disconnectProviderPending;
    setBusy(`disconnect:${provider.provider}`);
    pageError = null;
    pageMessage = null;

    try {
      const result = await agentsStore.disconnectProvider(selectedAgentId, provider.provider);
      if (result.success) {
        pageMessage = result.message || `Disconnected ${provider.display_name}.`;
        closeDisconnectDialog();
      } else {
        pageError = result.message || `Failed to disconnect ${provider.display_name}.`;
      }
    } catch (error) {
      pageError = error instanceof Error ? error.message : `Failed to disconnect ${provider.display_name}.`;
    } finally {
      setBusy(null);
    }
  }

  async function confirmClearApiToken() {
    if (!selectedAgentId || !clearKeyProviderPending) return;

    const provider = clearKeyProviderPending;
    setBusy(`clear-token:${provider.provider}`);
    pageError = null;
    pageMessage = null;

    try {
      const result = await agentsStore.clearProviderApiToken(selectedAgentId, provider.provider);
      if (result.success) {
        pageMessage = result.message || `Cleared API key for ${provider.display_name}.`;
        closeClearKeyDialog();
      } else {
        pageError = result.message || `Failed to clear API key for ${provider.display_name}.`;
      }
    } catch (error) {
      pageError = error instanceof Error ? error.message : `Failed to clear API key for ${provider.display_name}.`;
    } finally {
      setBusy(null);
    }
  }

  async function handleOAuth(provider: AuthProviderEntry) {
    if (!selectedAgentId) return;
    setBusy(`oauth:${provider.provider}`);
    pageError = null;
    pageMessage = null;

    try {
      const start = await agentsStore.startProviderSignIn(selectedAgentId, provider.provider);
      const providerName = start.provider || provider.provider;

      if (start.authorization_url) {
        window.open(start.authorization_url, '_blank', 'noopener,noreferrer');
        pageMessage = `Opened sign-in for ${providerName}.`;
      }

      const needsManualCompletion =
        !start.authorization_url || !start.flow_kind || start.flow_kind !== OAuthFlowKindTs.RedirectCode;

      if (needsManualCompletion) {
        manualOAuthProvider = provider;
        manualOAuthFlowId = start.flow_id;
        manualOAuthValue = '';
        return;
      }

      const connected = await agentsStore.pollProviderSignIn(selectedAgentId, providerName);
      if (connected) {
        pageMessage = `Successfully authenticated with ${providerName}.`;
        return;
      }

      pageMessage = `Waiting for ${providerName} sign-in to complete. Paste the callback URL or code below if automatic completion does not finish.`;
      manualOAuthProvider = provider;
      manualOAuthFlowId = start.flow_id;
      manualOAuthValue = '';
    } catch (error) {
      pageError = error instanceof Error ? error.message : `Failed to start sign-in for ${provider.provider}.`;
    } finally {
      setBusy(null);
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

  function handleThemeChange(value: string) {
    if (value === 'system' || value === 'light' || value === 'dark') {
      appearanceStore.setThemeMode(value);
    }
  }

  async function handleWindowDecorationChange(enabled: boolean) {
    try {
      await windowDecorationsStore.toggleCustomTitlebar(enabled);
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Failed to update window decorations.';
    }
  }

  async function handleAuthMethodChange(provider: AuthProviderEntry, value: string) {
    if (!selectedAgentId || value === 'auto') return;
    setBusy(`method:${provider.provider}`);
    pageError = null;
    pageMessage = null;
    try {
      const result = await agentsStore.setProviderAuthMethod(selectedAgentId, provider.provider, value as AuthMethod);
      if (result.success) {
        pageMessage = result.message || `Updated auth method for ${provider.display_name}.`;
      } else {
        pageError = result.message || `Failed to update auth method for ${provider.display_name}.`;
      }
    } catch (error) {
      pageError = error instanceof Error ? error.message : `Failed to update auth method for ${provider.display_name}.`;
    } finally {
      setBusy(null);
    }
  }
</script>

<div class="settings-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Settings"
      description="Manage appearance, bundled profiles, and provider authentication."
    />
  </div>

  <div class="settings-unified-panel">
    <section class="settings-section">
      <div class="settings-section-header">
      <div>
        <h2>Appearance</h2>
        <p>Match the QueryMT website style while choosing whether Desktop owns the titlebar or leaves it to the operating system.</p>
      </div>
    </div>

    <div class="settings-preference-list">
      <div class="settings-preference-row">
        <div class="settings-preference-main">
          <div class="settings-preference-title">Theme</div>
          <div class="settings-preference-description">
            {appearanceStore.themeMode === 'system' ? `Follow the system preference (${appearanceStore.resolvedTheme}).` : `Use ${appearanceStore.themeMode} mode.`}
          </div>
        </div>
        <AppSelect value={appearanceStore.themeMode} options={themeOptions} pill ariaLabel="Theme" onValueChange={handleThemeChange} />
      </div>

      <div class="settings-preference-row">
        <div class="settings-preference-main">
          <div class="settings-preference-title">Custom titlebar</div>
          <div class:settings-preference-error={windowDecorationsStore.error} class="settings-preference-description">
            {#if windowDecorationsStore.error}
              {windowDecorationsStore.error}
            {:else if !windowDecorationsStore.supported}
              Available in Tauri desktop builds.
            {:else}
              {windowDecorationsStore.mode === 'custom' ? 'QueryMT draws the window controls.' : 'Use the operating system window frame.'}
            {/if}
          </div>
        </div>
        <AppCheckbox
          checked={windowDecorationsStore.mode === 'custom'}
          disabled={!windowDecorationsStore.supported}
          ariaLabel="Custom titlebar"
          onCheckedChange={(checked) => void handleWindowDecorationChange(checked)}
        />
      </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-header settings-section-header-action">
      <div>
        <h2>Curated profiles</h2>
        <p>Enable bundled TOML profile templates into Desktop app-data. Existing user copies are never overwritten.</p>
      </div>
      <IconTooltipButton label="Refresh profile templates" icon={RefreshCw} size={16} disabled={profileTemplatesLoading} onclick={() => refreshProfileTemplates()} />
    </div>

    {#if profileTemplateError}
      <div class="alert-error">
        {profileTemplateError}
      </div>
    {/if}

    {#if profileTemplates.length === 0 && !profileTemplatesLoading}
      <div class="surface-muted p-4 text-sm text-[var(--muted)]">No bundled profile templates found.</div>
    {:else}
      <div class="profile-template-list" aria-label="Curated profile templates">
        {#each profileTemplates as template}
          <article class:profile-template-row-enabled={template.enabled} class="profile-template-row">
            <div class="min-w-0 flex-1">
              <div class="profile-template-row-header">
                <h3>{template.name}</h3>
                {#if template.tags.length > 0}
                  <span>{template.tags[0]}</span>
                {/if}
              </div>
              <p>{template.description}</p>
              {#if template.userPath}
                <div class="profile-template-path" title={template.userPath}>{template.userPath}</div>
              {/if}
            </div>

            <div class="profile-template-action">
              {#if template.enabled}
                <span class="profile-template-state">Enabled</span>
              {:else}
                <button class="action-btn" type="button" disabled={actionLoading === `profile-template:${template.id}`} onclick={() => enableTemplate(template)}>
                  Enable
                </button>
              {/if}
            </div>
          </article>
        {/each}
      </div>
      {/if}
    </section>

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
        <div class="settings-section-header settings-section-header-action">
          <div>
            <h2>Providers</h2>
            <p>Choose the active agent and manage provider authentication.</p>
          </div>
          <IconTooltipButton label="Refresh providers" icon={RefreshCw} size={16} disabled={!selectedAgentId || authLoading || actionLoading === 'refresh'} onclick={() => refreshProviders()} />
        </div>

        <div class="settings-subsection">
          <div class="settings-preference-list">
            <div class="settings-preference-row">
              <div class="settings-preference-main">
                <div class="settings-preference-title">Active agent</div>
                <div class="settings-preference-description">{selectedCapabilitySummary()}</div>
              </div>
              <AppSelect bind:value={selectedAgentId} options={authAgents.map((agent) => ({ value: agent.id, label: agent.name }))} pill ariaLabel="Agent" />
            </div>

            <div class="settings-preference-row">
              <div class="settings-preference-main">
                <div class="settings-preference-title">Models</div>
                <div class="settings-preference-description">Refresh available models for the selected agent.</div>
              </div>
              <div class="settings-preference-actions-single">
                <button class="action-btn" type="button" disabled={!selectedAgentId || !!actionLoading || modelLoading} onclick={() => refreshModels()}>
                  Refresh
                </button>
              </div>
            </div>

            <div class="settings-preference-row">
              <div class="settings-preference-main">
                <div class="settings-preference-title">Plugins</div>
                <div class="settings-preference-description">Update installed plugins for the selected agent.</div>
              </div>
              <div class="settings-preference-actions-single">
                <button class="action-btn" type="button" disabled={!selectedAgentId || !!actionLoading} onclick={() => updatePlugins()}>
                  Update
                </button>
              </div>
            </div>

          </div>
        </div>

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

      {#if pluginUpdateStatus}
        <div class="surface-muted border-[var(--rail)] bg-[var(--accent-dim)] px-4 py-3 text-sm text-[var(--text)] space-y-1">
          <div class="font-medium">Plugin update in progress</div>
          <div>{pluginUpdateStatus.plugin_name} - {pluginUpdateStatus.phase}</div>
          {#if pluginUpdateStatus.percent != null}
            <div>{pluginUpdateStatus.percent.toFixed(0)}% complete</div>
          {/if}
          {#if pluginUpdateStatus.message}
            <div class="text-[var(--muted)]">{pluginUpdateStatus.message}</div>
          {/if}
        </div>
      {/if}

      {#if lastPluginUpdate && lastPluginUpdate.length > 0}
        <div class="surface-muted px-4 py-3 text-sm text-[var(--muted)] space-y-2">
          <div class="font-medium text-[var(--text)]">Last plugin update</div>
          <div class="space-y-1">
            {#each lastPluginUpdate as result}
              <div>
                <span class="text-[var(--text)]">{result.plugin_name}</span>
                <span class="text-[var(--muted)]"> - {result.success ? 'ok' : result.message ?? 'failed'}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

        <div class="settings-subsection">
          <div class="settings-subsection-header">
            <h3>Authentication</h3>
            <p>Review provider credentials and choose preferred authentication methods.</p>
          </div>

          {#if providers.length === 0 && !authLoading}
            <div class="surface-muted p-4 text-sm text-[var(--muted)]">
              No auth-enabled providers reported by this agent.
            </div>
          {:else}
            <div class="settings-provider-list">
              {#each sortedProviders as provider}
                <article
                  class:settings-provider-row-connected={hasUsableCredential(provider)}
                  class:settings-provider-row-warning={provider.oauth_status === OAuthStatus.Expired}
                  class:settings-provider-row-unconfigured={!hasUsableCredential(provider) && provider.oauth_status !== OAuthStatus.Expired}
                  class="settings-provider-row"
                >
                  <div class="settings-provider-main">
                    <div class="settings-provider-title">{provider.display_name}</div>
                    <div class="settings-provider-id">{provider.provider}</div>
                  </div>

                  <div class="settings-provider-state">
                    <div class={`settings-provider-status settings-provider-status-${authStatusTone(provider)}`}>
                      <span class="settings-provider-status-dot" aria-hidden="true"></span>
                      <span>{authStatusLabel(provider)}</span>
                    </div>
                    <div class="settings-provider-detail">{authDetail(provider)}</div>
                    {#if authHint(provider)}
                      <div class="settings-provider-hint">{authHint(provider)}</div>
                    {/if}
                  </div>

                  <div class="settings-provider-method">
                    <AppSelect
                      value={provider.preferred_method ?? 'auto'}
                      options={authMethodOptions}
                      disabled={actionLoading === `method:${provider.provider}`}
                      pill
                      ariaLabel="Preferred auth"
                      onValueChange={(value) => void handleAuthMethodChange(provider, value)}
                    />
                  </div>

                  <div class="settings-provider-actions">
                    {#if provider.supports_oauth && provider.oauth_status !== OAuthStatus.Connected}
                      <IconTooltipButton label="Sign in" icon={LogIn} disabled={!!actionLoading} onclick={() => handleOAuth(provider)} />
                    {/if}
                    {#if provider.supports_oauth && provider.oauth_status === OAuthStatus.Connected}
                      <IconTooltipButton label="Disconnect OAuth" icon={LogOut} disabled={!!actionLoading} onclick={() => handleDisconnect(provider)} />
                    {/if}
                    {#if (provider.preferred_method ?? 'auto') === AuthMethod.ApiKey}
                      <IconTooltipButton label="Set API key" icon={KeyRound} disabled={!!actionLoading} onclick={() => handleSetApiToken(provider)} />
                    {/if}
                    {#if provider.has_stored_api_key}
                      <IconTooltipButton label="Clear stored API key" icon={Trash2} tone="danger" disabled={!!actionLoading} onclick={() => handleClearApiToken(provider)} />
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
            <p class="settings-provider-footnote">OAuth sign-in opens your browser. API keys are stored in the desktop keyring.</p>
          {/if}
        </div>
      </section>
    {/if}
  </div>

  {#if tokenDialogProvider}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close API key dialog" onclick={() => closeTopmostDialog()}></button>
        <div class="panel relative z-10 w-full max-w-lg p-5 space-y-4" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div>
            <div class="text-lg font-semibold">Set API key</div>
            <div class="text-sm text-[var(--muted)]">Store a key for {tokenDialogProvider.display_name} in the desktop agent keyring.</div>
          </div>
          <label class="block space-y-2">
            <span class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">API key</span>
            <input class="input-shell w-full" type="password" bind:value={tokenDialogValue} placeholder="Paste API key" />
          </label>
          <div class="compact-toolbar justify-end">
            <button class="action-btn" type="button" onclick={() => closeTokenDialog()} disabled={!!actionLoading}>Cancel</button>
            <button class="action-btn" type="button" onclick={() => submitApiToken()} disabled={!!actionLoading || !tokenDialogValue.trim()}>
              Save key
            </button>
          </div>
        </div>
      </div>
    </Portal>
  {/if}

  {#if manualOAuthProvider}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close OAuth dialog" onclick={() => closeTopmostDialog()}></button>
        <div class="panel relative z-10 w-full max-w-xl p-5 space-y-4" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div>
            <div class="text-lg font-semibold">Complete OAuth sign-in</div>
            <div class="text-sm text-[var(--muted)]">Paste the callback URL or returned code for {manualOAuthProvider.display_name}.</div>
          </div>
          <label class="block space-y-2">
            <span class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Callback URL or code</span>
            <textarea class="input-shell w-full min-h-28" bind:value={manualOAuthValue} placeholder="https://... or pasted code"></textarea>
          </label>
          <div class="compact-toolbar justify-end">
            <button class="action-btn" type="button" onclick={() => closeManualOAuthDialog()} disabled={!!actionLoading}>Cancel</button>
            <button class="action-btn" type="button" onclick={() => submitManualOAuth()} disabled={!!actionLoading || !manualOAuthValue.trim()}>
              Complete sign-in
            </button>
          </div>
        </div>
      </div>
    </Portal>
  {/if}

  {#if disconnectProviderPending}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close disconnect confirmation" onclick={() => closeTopmostDialog()}></button>
        <div class="panel relative z-10 w-full max-w-md p-5 space-y-4" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div>
            <div class="text-lg font-semibold">Disconnect provider</div>
            <div class="text-sm text-[var(--muted)]">Remove OAuth credentials for {disconnectProviderPending.display_name}?</div>
          </div>
          <div class="compact-toolbar justify-end">
            <button class="action-btn" type="button" onclick={() => closeDisconnectDialog()} disabled={!!actionLoading}>Cancel</button>
            <button class="action-btn action-btn-danger" type="button" onclick={() => confirmDisconnectProvider()} disabled={!!actionLoading}>Disconnect</button>
          </div>
        </div>
      </div>
    </Portal>
  {/if}

  {#if clearKeyProviderPending}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close clear key confirmation" onclick={() => closeTopmostDialog()}></button>
        <div class="panel relative z-10 w-full max-w-md p-5 space-y-4" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div>
            <div class="text-lg font-semibold">Clear stored API key</div>
            <div class="text-sm text-[var(--muted)]">Remove the saved key for {clearKeyProviderPending.display_name}?</div>
          </div>
          <div class="compact-toolbar justify-end">
            <button class="action-btn" type="button" onclick={() => closeClearKeyDialog()} disabled={!!actionLoading}>Cancel</button>
            <button class="action-btn action-btn-danger" type="button" onclick={() => confirmClearApiToken()} disabled={!!actionLoading}>Clear key</button>
          </div>
        </div>
      </div>
    </Portal>
  {/if}
</div>
