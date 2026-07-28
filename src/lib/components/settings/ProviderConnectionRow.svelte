<script lang="ts">
  import { ChevronDown, CircleStop, KeyRound, LoaderCircle, LogIn, LogOut, Trash2 } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import {
    providerAuthMethodOptions,
    providerConnectionState,
    providerConnectionSummary,
    providerPrimaryAction
  } from '$lib/domain/provider-auth';
  import { OAuthStatus, type AuthProviderEntry } from '$lib/querymt/generated/types';

  let {
    provider,
    pendingAction = null,
    message = null,
    error = null,
    onSignIn,
    onCancelSignIn,
    onDisconnect,
    onSetApiKey,
    onClearApiKey,
    onAuthMethodChange
  }: {
    provider: AuthProviderEntry;
    pendingAction?: string | null;
    message?: string | null;
    error?: string | null;
    onSignIn: (provider: AuthProviderEntry) => void;
    onCancelSignIn: (provider: AuthProviderEntry) => void;
    onDisconnect: (provider: AuthProviderEntry) => void;
    onSetApiKey: (provider: AuthProviderEntry) => void;
    onClearApiKey: (provider: AuthProviderEntry) => void;
    onAuthMethodChange: (provider: AuthProviderEntry, method: string) => void;
  } = $props();

  let detailsOpen = $state(false);
  const connectionState = $derived(providerConnectionState(provider));
  const primaryAction = $derived(providerPrimaryAction(provider));
  const pending = $derived(Boolean(pendingAction));
  const signingIn = $derived(pendingAction === 'oauth');

  function handlePrimaryAction() {
    if (primaryAction === 'reconnect') {
      onSignIn(provider);
      return;
    }
    detailsOpen = !detailsOpen;
  }
</script>

<article class={`provider-connection-row provider-connection-row-${connectionState}`}>
  <div class="provider-connection-main">
    <h3>{provider.display_name}</h3>
    <p>{providerConnectionSummary(provider)}</p>
  </div>

  <div class="provider-connection-primary">
    {#if signingIn}
      <button class="action-btn" type="button" disabled><LoaderCircle size={14} class="animate-spin" />Signing in…</button>
      <IconTooltipButton label="Cancel sign-in" icon={CircleStop} tone="danger" onclick={() => onCancelSignIn(provider)} />
    {:else}
      <button
        class="action-btn provider-connection-action"
        type="button"
        aria-expanded={primaryAction === 'reconnect' ? undefined : detailsOpen}
        disabled={pending}
        onclick={handlePrimaryAction}
      >
        {primaryAction === 'reconnect' ? 'Reconnect' : detailsOpen ? 'Close' : primaryAction === 'setup' ? 'Set up' : 'Manage'}
      </button>
    {/if}
  </div>

  {#if message}<div class="provider-connection-feedback provider-connection-feedback-success" role="status">{message}</div>{/if}
  {#if error}<div class="provider-connection-feedback provider-connection-feedback-error" role="alert">{error}</div>{/if}

  <div class="provider-connection-details">
    <button type="button" aria-expanded={detailsOpen} onclick={() => (detailsOpen = !detailsOpen)}>
      <span>{detailsOpen ? 'Hide details' : 'Connection details'}</span>
      <ChevronDown size={14} class={detailsOpen ? 'settings-advanced-chevron-open' : ''} />
    </button>

    {#if detailsOpen}
      <div class="provider-connection-details-content">
        <div class="provider-connection-detail-row">
          <div><strong>Authentication method</strong><span>Choose the preferred credential source.</span></div>
          <AppSelect
            value={provider.preferred_method ?? 'auto'}
            options={providerAuthMethodOptions(provider)}
            disabled={pendingAction === 'method'}
            pill
            ariaLabel={`Authentication method for ${provider.display_name}`}
            onValueChange={(value) => onAuthMethodChange(provider, value)}
          />
        </div>

        <div class="provider-connection-detail-row">
          <div><strong>Provider ID</strong><span class="provider-connection-mono">{provider.provider}</span></div>
        </div>

        {#if provider.env_var_name}
          <div class="provider-connection-detail-row">
            <div><strong>Environment variable</strong><span class="provider-connection-mono">{provider.env_var_name}</span></div>
            <span class:provider-connection-available={provider.has_env_api_key} class="provider-connection-availability">{provider.has_env_api_key ? 'Available' : 'Not set'}</span>
          </div>
        {/if}

        <div class="provider-connection-detail-actions">
          {#if provider.supports_oauth && provider.oauth_status !== OAuthStatus.Connected}
            <button class="action-btn" type="button" disabled={pending} onclick={() => onSignIn(provider)}><LogIn size={14} />{provider.oauth_status === OAuthStatus.Expired ? 'Reconnect OAuth' : 'Sign in with OAuth'}</button>
          {/if}
          {#if provider.supports_oauth && provider.oauth_status === OAuthStatus.Connected}
            <button class="action-btn" type="button" disabled={pending} onclick={() => onDisconnect(provider)}><LogOut size={14} />Disconnect OAuth</button>
          {/if}
          <button class="action-btn" type="button" disabled={pending} onclick={() => onSetApiKey(provider)}><KeyRound size={14} />{provider.has_stored_api_key ? 'Replace API key' : 'Set API key'}</button>
          {#if provider.has_stored_api_key}
            <button class="action-btn action-btn-danger" type="button" disabled={pending} onclick={() => onClearApiKey(provider)}><Trash2 size={14} />Clear API key</button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</article>
