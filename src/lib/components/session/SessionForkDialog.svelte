<script lang="ts">
  import { getContext } from 'svelte';
  import { Portal } from 'bits-ui';
  import { GitFork, LoaderCircle, X } from '@lucide/svelte';
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

  function close() {
    if (!pending) open = false;
  }

  async function confirm() {
    if (!pending && target) await onConfirm();
  }
</script>

{#if open && target}
  <Portal to={overlayPortalTarget}>
    <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
      <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close fork confirmation" onclick={close} disabled={pending}></button>
      <div class="dialog-modal-panel dialog-modal-panel-small relative z-10" role="dialog" aria-modal="true" aria-labelledby="fork-session-dialog-title" tabindex="-1" data-blocking-overlay="true">
        <div class="dialog-header">
          <div class="dialog-header-title-block">
            <div class="dialog-title" id="fork-session-dialog-title">Create a new fork?</div>
            <div class="dialog-subtitle">A new independent session will branch from {sourceTitle || 'this session'}.</div>
          </div>
          <div class="dialog-header-actions">
            <button class="dialog-close-button" type="button" aria-label="Close fork confirmation" onclick={close} disabled={pending}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div class="dialog-body">
          <div class="dialog-form">
            <div class="dialog-row-group">
              <div class="dialog-row dialog-row-muted dialog-row-full">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Prompt</div>
                  <div class="dialog-row-description session-undo-prompt">{target.prompt || 'Selected conversation boundary'}</div>
                </div>
              </div>
              {#if target.includesResponse && target.response}
                <div class="dialog-row dialog-row-muted dialog-row-full">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">Included response</div>
                    <div class="dialog-row-description session-undo-prompt">{target.response}</div>
                  </div>
                </div>
              {/if}
              <div class="dialog-row dialog-row-full">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">The source stays unchanged</div>
                  <div class="dialog-row-description">
                    {target.includesResponse
                      ? 'The fork includes this completed response. Current workspace files are not modified.'
                      : 'The fork stops at this prompt because no persisted assistant response is available. Current workspace files are not modified.'}
                  </div>
                </div>
              </div>
            </div>

            <div class="dialog-footer">
              <button class="action-btn" type="button" onclick={close} disabled={pending}>Cancel</button>
              <button class="action-btn" type="button" onclick={confirm} disabled={pending}>
                {#if pending}
                  <LoaderCircle size={14} class="animate-spin" />
                  Creating fork...
                {:else}
                  <GitFork size={14} />
                  Create and open fork
                {/if}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Portal>
{/if}
