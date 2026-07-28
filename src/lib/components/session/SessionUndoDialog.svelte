<script lang="ts">
  import { getContext } from 'svelte';
  import AppConfirmDialog from '$lib/components/primitives/AppConfirmDialog.svelte';

  let {
    open = $bindable(false),
    prompt,
    affectedTurns,
    pending = false,
    onConfirm
  }: {
    open?: boolean;
    prompt: string;
    affectedTurns: number;
    pending?: boolean;
    onConfirm: () => void | Promise<void>;
  } = $props();

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);
  const description = $derived(
    affectedTurns > 1
      ? `This rolls back this turn and ${affectedTurns - 1} later turn${affectedTurns === 2 ? '' : 's'}. You can use Redo afterward.`
      : 'This rolls back the latest turn. You can use Redo afterward.'
  );

  async function confirm() {
    if (!pending) await onConfirm();
  }
</script>

{#if open}
  <AppConfirmDialog
    bind:open
    title="Undo workspace changes?"
    {description}
    confirmLabel="Undo changes"
    pendingLabel="Undoing..."
    {pending}
    tone="neutral"
    portalTarget={overlayPortalTarget}
    onConfirm={confirm}
  >
    <div class="app-dialog-field">
      <span class="app-dialog-field-label">Prompt boundary</span>
      <span class="app-dialog-field-help session-undo-prompt">{prompt || 'Selected conversation turn'}</span>
    </div>
  </AppConfirmDialog>
{/if}
