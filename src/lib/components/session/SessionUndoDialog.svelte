<script lang="ts">
  import { getContext } from 'svelte';
  import { Portal } from 'bits-ui';
  import { LoaderCircle, RotateCcw, X } from '@lucide/svelte';

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

  function close() {
    if (!pending) open = false;
  }

  async function confirm() {
    if (pending) return;
    await onConfirm();
  }
</script>

{#if open}
  <Portal to={overlayPortalTarget}>
    <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
      <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close undo confirmation" onclick={close} disabled={pending}></button>
      <div class="dialog-modal-panel dialog-modal-panel-small relative z-10" role="dialog" aria-modal="true" aria-labelledby="undo-session-dialog-title" tabindex="-1" data-blocking-overlay="true">
        <div class="dialog-header">
          <div class="dialog-header-title-block">
            <div class="dialog-title" id="undo-session-dialog-title">Undo workspace changes?</div>
            <div class="dialog-subtitle">
              {affectedTurns > 1
                ? `This rolls back this turn and ${affectedTurns - 1} later turn${affectedTurns === 2 ? '' : 's'}.`
                : 'This rolls back the latest turn.'}
            </div>
          </div>
          <div class="dialog-header-actions">
            <button class="dialog-close-button" type="button" aria-label="Close undo confirmation" onclick={close} disabled={pending}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div class="dialog-body">
          <div class="dialog-form">
            <div class="dialog-row-group">
              <div class="dialog-row dialog-row-muted dialog-row-full">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Prompt boundary</div>
                  <div class="dialog-row-description session-undo-prompt">{prompt || 'Selected conversation turn'}</div>
                </div>
              </div>
              <div class="dialog-row dialog-row-full">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Files in the workspace will change</div>
                  <div class="dialog-row-description">QueryMT restores tracked files to this prompt boundary. You can use Redo afterward to restore the current workspace state.</div>
                </div>
              </div>
            </div>

            <div class="dialog-footer">
              <button class="action-btn" type="button" onclick={close} disabled={pending}>Cancel</button>
              <button class="action-btn action-btn-danger" type="button" onclick={confirm} disabled={pending}>
                {#if pending}
                  <LoaderCircle size={14} class="animate-spin" />
                  Undoing...
                {:else}
                  <RotateCcw size={14} />
                  Undo changes
                {/if}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Portal>
{/if}
