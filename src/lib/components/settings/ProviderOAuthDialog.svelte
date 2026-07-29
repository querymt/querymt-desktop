<script lang="ts">
  import { Check, ChevronDown, Copy, LoaderCircle } from '@lucide/svelte';
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import { restoreProviderDialogFocus, type ProviderDialogFocusTarget } from './provider-dialog-focus';
  import { OAuthFlowKindTs, type AuthProviderEntry } from '$lib/querymt/generated/types';

  let {
    open,
    provider = null,
    focusTarget = null,
    portalTarget = null,
    flowKind = null,
    authorizationUrl = '',
    urlCopied = false,
    needsCallbackInput = false,
    value = $bindable(''),
    waiting = false,
    pending = false,
    completing = false,
    submitDisabled = false,
    onDismiss,
    onOpenAuthorizationUrl,
    onCopyAuthorizationUrl,
    onCancelSignIn,
    onSubmit
  }: {
    open: boolean;
    provider?: AuthProviderEntry | null;
    focusTarget?: ProviderDialogFocusTarget | null;
    portalTarget?: HTMLElement | null;
    flowKind?: OAuthFlowKindTs | null;
    authorizationUrl?: string;
    urlCopied?: boolean;
    needsCallbackInput?: boolean;
    value: string;
    waiting?: boolean;
    pending?: boolean;
    completing?: boolean;
    submitDisabled?: boolean;
    onDismiss: () => void;
    onOpenAuthorizationUrl: () => void;
    onCopyAuthorizationUrl: () => void;
    onCancelSignIn: () => void;
    onSubmit: () => void;
  } = $props();

  const isDevicePoll = $derived(flowKind === OAuthFlowKindTs.DevicePoll);
  const hasAuthorizationUrl = $derived(Boolean(authorizationUrl));
  const providerName = $derived(provider?.display_name ?? 'this provider');
  const description = $derived(
    isDevicePoll
      ? `Approve access for ${providerName} in your browser, then check authentication.`
      : hasAuthorizationUrl
        ? `Continue in your browser to authorize ${providerName}. We'll detect completion automatically.`
        : `Paste the callback URL or returned code for ${providerName}.`
  );

  function restoreFocus(event: Event) {
    restoreProviderDialogFocus(event, focusTarget);
  }
</script>

<AppDialog
  {open}
  title={`Sign in to ${providerName}`}
  {description}
  size="standard"
  pending={false}
  closeLabel="Close OAuth dialog"
  portalTarget={portalTarget ?? undefined}
  onCloseAutoFocus={restoreFocus}
  onDismiss={onDismiss}
>
  <div class="app-dialog-form">
    {#if hasAuthorizationUrl}
      <div class="app-dialog-field">
        <span class="app-dialog-field-label">Authorization link</span>
        <div class="app-dialog-input-action">
          <input class="input-shell dialog-code-field w-full" readonly value={authorizationUrl} aria-label="Authorization URL" title={authorizationUrl} />
          <button class="app-dialog-input-action-button" type="button" aria-label={urlCopied ? 'URL copied' : 'Copy URL'} title={urlCopied ? 'Copied' : 'Copy URL'} onclick={onCopyAuthorizationUrl}>
            {#if urlCopied}<Check size={15} />{:else}<Copy size={15} />{/if}
          </button>
        </div>
      </div>
    {/if}

    {#if waiting}
      <div class="app-dialog-inline-status" role="status">
        <LoaderCircle size={15} class="animate-spin" />
        <span>Waiting for authentication to complete in your browser.</span>
      </div>
    {/if}

    {#if needsCallbackInput && !isDevicePoll}
      {#if hasAuthorizationUrl}
        <details class="app-dialog-disclosure" open={Boolean(value)}>
          <summary>
            <span>Having trouble? Complete sign-in manually</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <label class="app-dialog-field mt-3">
            <span class="app-dialog-field-label">Callback URL or code</span>
            <textarea class="input-shell w-full min-h-24" bind:value placeholder="https://... or pasted code"></textarea>
            <span class="app-dialog-field-help">Paste the browser callback if automatic completion does not return to QueryMT.</span>
          </label>
        </details>
      {:else}
        <label class="app-dialog-field">
          <span class="app-dialog-field-label">Callback URL or code</span>
          <textarea class="input-shell w-full min-h-24" bind:value placeholder="https://... or pasted code"></textarea>
        </label>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    {#if waiting}
      <button class="action-btn" type="button" onclick={onCancelSignIn}>Cancel</button>
    {:else}
      <button class="action-btn" type="button" onclick={onDismiss} disabled={pending}>Cancel</button>
    {/if}
    {#if hasAuthorizationUrl}
      <button class="action-btn" type="button" onclick={onOpenAuthorizationUrl} disabled={pending && !waiting}>Open in browser</button>
    {/if}
    {#if isDevicePoll || (needsCallbackInput && (!hasAuthorizationUrl || Boolean(value.trim())))}
      <button class="action-btn action-btn-primary" type="button" onclick={onSubmit} disabled={submitDisabled}>
        {isDevicePoll ? 'Check authentication' : completing ? 'Completing...' : 'Complete sign-in'}
      </button>
    {/if}
  {/snippet}
</AppDialog>
