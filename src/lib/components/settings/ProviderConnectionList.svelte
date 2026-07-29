<script lang="ts">
  import ProviderConnectionRow from './ProviderConnectionRow.svelte';
  import {
    FULL_PROVIDER_AUTH_CAPABILITIES,
    sortProvidersByAction,
    type ProviderAuthCapabilities
  } from '$lib/domain/provider-auth';
  import type { AuthProviderEntry } from '$lib/querymt/generated/types';

  let {
    providers,
    authCapabilities = FULL_PROVIDER_AUTH_CAPABILITIES,
    pendingAction = null,
    messages = {},
    errors = {},
    onSignIn,
    onCancelSignIn,
    onDisconnect,
    onSetApiKey,
    onClearApiKey,
    onAuthMethodChange,
    onDialogTrigger
  }: {
    providers: AuthProviderEntry[];
    authCapabilities?: ProviderAuthCapabilities;
    pendingAction?: { provider: string; action: string } | null;
    messages?: Record<string, string | undefined>;
    errors?: Record<string, string | undefined>;
    onSignIn: (provider: AuthProviderEntry) => void;
    onCancelSignIn: (provider: AuthProviderEntry) => void;
    onDisconnect: (provider: AuthProviderEntry) => void;
    onSetApiKey: (provider: AuthProviderEntry) => void;
    onClearApiKey: (provider: AuthProviderEntry) => void;
    onAuthMethodChange: (provider: AuthProviderEntry, method: string) => void;
    onDialogTrigger: (event: MouseEvent) => void;
  } = $props();

  const sortedProviders = $derived(sortProvidersByAction(providers));
</script>

<div class="provider-connection-list" aria-label="Provider connections">
  {#each sortedProviders as provider (provider.provider)}
    <ProviderConnectionRow
      {provider}
      {authCapabilities}
      pendingAction={pendingAction?.provider === provider.provider ? pendingAction.action : null}
      message={messages[provider.provider]}
      error={errors[provider.provider]}
      {onSignIn}
      {onCancelSignIn}
      {onDisconnect}
      {onSetApiKey}
      {onClearApiKey}
      {onAuthMethodChange}
      {onDialogTrigger}
    />
  {/each}
</div>
