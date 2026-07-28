<script lang="ts">
  import { Check, Clipboard, LoaderCircle } from '@lucide/svelte';
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import type { CreateMeshInviteRequest, MeshInviteCreatedInfo } from '$lib/querymt/generated/types';

  let {
    open = $bindable(false),
    pending = false,
    error = null,
    result = null,
    copied = false,
    onCreate,
    onCopy
  }: {
    open: boolean;
    pending?: boolean;
    error?: string | null;
    result?: MeshInviteCreatedInfo | null;
    copied?: boolean;
    onCreate: (request: CreateMeshInviteRequest) => void;
    onCopy: (invite: MeshInviteCreatedInfo) => void;
  } = $props();

  let expiryPreset = $state('24h');
  let customTtl = $state('');
  let maxUses = $state('1');

  const expiryOptions = [
    { value: '1h', label: '1 hour' },
    { value: '24h', label: '24 hours' },
    { value: '168h', label: '7 days' },
    { value: 'custom', label: 'Custom' }
  ];

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const parsedMaxUses = Number(maxUses);
    onCreate({
      ttl: expiryPreset === 'custom' ? customTtl.trim() || undefined : expiryPreset,
      max_uses: Number.isFinite(parsedMaxUses) && parsedMaxUses > 0 ? parsedMaxUses : undefined
    });
  }
</script>

<AppDialog
  bind:open
  title={result ? 'Invite ready' : 'Create mesh invite'}
  description={result ? 'Share this link with the peer joining your mesh.' : 'Choose how long the invite remains valid and how often it can be used.'}
  size="standard"
  divided={false}
  {pending}
  closeLabel="Close invite dialog"
>
  {#if result}
    <div class="app-dialog-form">
      <div class="mesh-invite-result">
        <span class="mesh-invite-result-icon"><Check size={18} /></span>
        <div class="mesh-invite-result-main">
          <strong>{result.invite_id}</strong>
          <span title={result.url}>{result.url}</span>
        </div>
      </div>
      {#if error}<div class="alert-error" role="alert">{error}</div>{/if}
    </div>
  {:else}
    <form id="mesh-invite-form" class="app-dialog-form" onsubmit={submit}>
      <label class="app-dialog-field">
        <span class="app-dialog-field-label">Expires after</span>
        <AppSelect bind:value={expiryPreset} options={expiryOptions} ariaLabel="Invite expiry" />
        <span class="app-dialog-field-help">Short-lived invites reduce unintended reuse.</span>
      </label>

      {#if expiryPreset === 'custom'}
        <label class="app-dialog-field">
          <span class="app-dialog-field-label">Custom expiry</span>
          <input class="input-shell w-full" bind:value={customTtl} placeholder="12h" aria-label="Custom invite expiry" />
          <span class="app-dialog-field-help">Use a duration such as 30m, 12h, or 2d.</span>
        </label>
      {/if}

      <label class="app-dialog-field">
        <span class="app-dialog-field-label">Maximum uses</span>
        <input class="input-shell app-dialog-number-input" type="number" min="1" step="1" bind:value={maxUses} aria-label="Maximum invite uses" />
        <span class="app-dialog-field-help">Limit how many peers can consume this invite.</span>
      </label>

      {#if error}<div class="alert-error" role="alert">{error}</div>{/if}
    </form>
  {/if}

  {#snippet footer()}
    {#if result}
      <button class="action-btn" type="button" onclick={() => (open = false)}>Done</button>
      <button class="action-btn action-btn-primary" type="button" onclick={() => onCopy(result)}>
        <Clipboard size={15} />
        {copied ? 'Copied' : 'Copy link'}
      </button>
    {:else}
      <button class="action-btn" type="button" disabled={pending} onclick={() => (open = false)}>Cancel</button>
      <button class="action-btn action-btn-primary" form="mesh-invite-form" type="submit" disabled={pending || (expiryPreset === 'custom' && !customTtl.trim())}>
        {#if pending}<LoaderCircle size={15} class="animate-spin" />{/if}
        {pending ? 'Creating...' : 'Create invite'}
      </button>
    {/if}
  {/snippet}
</AppDialog>
