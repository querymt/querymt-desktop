<script lang="ts">
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import { restoreProviderDialogFocus, type ProviderDialogFocusTarget } from './provider-dialog-focus';
  import type { AuthProviderEntry } from '$lib/querymt/generated/types';

  let {
    open,
    provider = null,
    focusTarget = null,
    portalTarget = null,
    value = $bindable(''),
    pending = false,
    onClose,
    onSubmit
  }: {
    open: boolean;
    provider?: AuthProviderEntry | null;
    focusTarget?: ProviderDialogFocusTarget | null;
    portalTarget?: HTMLElement | null;
    value: string;
    pending?: boolean;
    onClose: () => void;
    onSubmit: () => void;
  } = $props();

  let apiKeyInput: HTMLInputElement | null = null;

  function focusApiKey(event: Event) {
    event.preventDefault();
    apiKeyInput?.focus();
  }

  function restoreFocus(event: Event) {
    restoreProviderDialogFocus(event, focusTarget);
  }
</script>

<AppDialog
  {open}
  title="Set API key"
  description={`Store a key for ${provider?.display_name ?? 'this provider'} in the desktop agent keyring.`}
  size="standard"
  {pending}
  closeLabel="Close API key dialog"
  portalTarget={portalTarget ?? undefined}
  onOpenAutoFocus={focusApiKey}
  onCloseAutoFocus={restoreFocus}
  onDismiss={onClose}
>
  <form id="provider-api-key-form" class="app-dialog-form" onsubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <label class="app-dialog-field">
      <span class="app-dialog-field-label">API key</span>
      <input bind:this={apiKeyInput} class="input-shell w-full" type="password" bind:value placeholder="Paste API key" />
      <span class="app-dialog-field-help">Stored securely in the desktop keyring.</span>
    </label>
  </form>

  {#snippet footer()}
    <button class="action-btn" type="button" onclick={onClose} disabled={pending}>Cancel</button>
    <button class="action-btn action-btn-primary" form="provider-api-key-form" type="submit" disabled={pending || !value.trim()}>
      Save key
    </button>
  {/snippet}
</AppDialog>
