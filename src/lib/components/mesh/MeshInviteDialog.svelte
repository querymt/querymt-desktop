<script lang="ts">
  import { Check, Clipboard, LoaderCircle, X } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
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

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="model-picker-backdrop" />
    <Dialog.Content class="model-picker-modal command-palette-modal-form !p-0">
      <div class="dialog-header">
        <div class="dialog-header-title-block">
          <Dialog.Title class="dialog-title">{result ? 'Invite ready' : 'Create mesh invite'}</Dialog.Title>
          <Dialog.Description class="dialog-subtitle">{result ? 'Share this link with the peer joining your mesh.' : 'Set how long the invite remains valid and how often it can be used.'}</Dialog.Description>
        </div>
        <div class="dialog-header-actions">
          <button class="dialog-close-button" type="button" aria-label="Close invite dialog" disabled={pending} onclick={() => (open = false)}><X size={16} /></button>
        </div>
      </div>

      <div class="dialog-body">
        {#if result}
          <div class="mesh-invite-result">
            <span class="mesh-invite-result-icon"><Check size={18} /></span>
            <div class="mesh-invite-result-main">
              <strong>{result.invite_id}</strong>
              <span title={result.url}>{result.url}</span>
            </div>
          </div>
          {#if error}<div class="alert-error" role="alert">{error}</div>{/if}
          <div class="dialog-footer">
            <button class="action-btn" type="button" onclick={() => (open = false)}>Done</button>
            <button class="action-btn action-btn-primary" type="button" onclick={() => onCopy(result)}>
              <Clipboard size={15} />
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        {:else}
          <form class="dialog-form" onsubmit={submit}>
            <div class="dialog-row-group">
              <div class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Expires after</div>
                  <div class="dialog-row-description">Short-lived invites reduce unintended reuse.</div>
                </div>
                <AppSelect class="dialog-row-control" bind:value={expiryPreset} options={expiryOptions} ariaLabel="Invite expiry" />
              </div>
              {#if expiryPreset === 'custom'}
                <div class="dialog-row">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">Custom expiry</div>
                    <div class="dialog-row-description">Use a duration such as 30m, 12h, or 2d.</div>
                  </div>
                  <input class="input-shell dialog-row-control" bind:value={customTtl} placeholder="12h" aria-label="Custom invite expiry" />
                </div>
              {/if}
              <div class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Maximum uses</div>
                  <div class="dialog-row-description">Limit how many peers can consume this invite.</div>
                </div>
                <input class="input-shell dialog-row-control" type="number" min="1" step="1" bind:value={maxUses} aria-label="Maximum invite uses" />
              </div>
            </div>

            {#if error}<div class="alert-error" role="alert">{error}</div>{/if}

            <div class="dialog-footer">
              <button class="action-btn" type="button" disabled={pending} onclick={() => (open = false)}>Cancel</button>
              <button class="action-btn action-btn-primary" type="submit" disabled={pending || (expiryPreset === 'custom' && !customTtl.trim())}>
                {#if pending}<LoaderCircle size={15} class="animate-spin" />{/if}
                {pending ? 'Creating…' : 'Create invite'}
              </button>
            </div>
          </form>
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
