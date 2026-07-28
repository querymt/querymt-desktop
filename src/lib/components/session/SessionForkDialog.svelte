<script lang="ts">
  import { getContext } from 'svelte';
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import type { SessionForkTarget } from '$lib/domain/session-fork';

  let {
    open = $bindable(false),
    sourceTitle,
    target,
    pending = false,
    onConfirm
  }: {
    open?: boolean;
    sourceTitle: string;
    target: SessionForkTarget | null;
    pending?: boolean;
    onConfirm: () => void | Promise<void>;
  } = $props();

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  async function confirm() {
    if (!pending && target) await onConfirm();
  }
</script>

{#if open && target}
  <AppDialog
    bind:open
    title="Create a new fork?"
    description={`A new independent session will branch from ${sourceTitle || 'this session'}. The source and current workspace stay unchanged.`}
    size="standard"
    {pending}
    closeLabel="Close fork confirmation"
    portalTarget={overlayPortalTarget}
  >
    <div class="app-dialog-form">
      <div class="app-dialog-field">
        <span class="app-dialog-field-label">Prompt</span>
        <span class="app-dialog-field-help session-undo-prompt">{target.prompt || 'Selected conversation boundary'}</span>
      </div>
      {#if target.includesResponse && target.response}
        <div class="app-dialog-field app-dialog-disclosure">
          <span class="app-dialog-field-label">Included response</span>
          <span class="app-dialog-field-help session-undo-prompt">{target.response}</span>
        </div>
      {/if}
    </div>

    {#snippet footer()}
      <button class="action-btn" type="button" onclick={() => (open = false)} disabled={pending}>Cancel</button>
      <button class="action-btn action-btn-primary" type="button" onclick={confirm} disabled={pending}>
        {pending ? 'Creating fork...' : 'Create and open fork'}
      </button>
    {/snippet}
  </AppDialog>
{/if}
