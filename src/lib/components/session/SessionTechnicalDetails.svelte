<script lang="ts">
  import { Bug, X } from '@lucide/svelte';
  import { Portal } from 'bits-ui';
  import { getContext, onMount } from 'svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    open = $bindable(false),
    showTrigger = false
  }: {
    session: ActiveSessionViewModel;
    open?: boolean;
    showTrigger?: boolean;
  } = $props();

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const eventCount = $derived(session.events.length);
  const tooltipLabel = $derived(
    eventCount === 0 ? 'Debug events' : `Debug events (${eventCount})`
  );

  function closeModal() {
    open = false;
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        closeModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
</script>

{#if showTrigger}
  <div class="session-debug-trigger-row">
    <IconTooltipButton icon={Bug} label={tooltipLabel} size={16} onclick={() => (open = true)} />
  </div>
{/if}

{#if open}
  <Portal to={overlayPortalTarget}>
    <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        class="absolute inset-0 h-full w-full cursor-default"
        type="button"
        aria-label="Close debug events"
        onclick={() => closeModal()}
      ></button>
      <div
        class="panel session-debug-modal relative z-10 flex max-h-[min(85vh,44rem)] w-full max-w-2xl flex-col p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-debug-modal-title"
        tabindex="-1"
        data-blocking-overlay="true"
      >
        <div class="flex shrink-0 items-start justify-between gap-3">
          <div class="min-w-0">
            <div id="session-debug-modal-title" class="text-lg font-semibold">Debug events</div>
            <div class="muted text-sm">
              {#if session.sessionId}
                Session {session.sessionId}
              {:else}
                Technical stream for this session
              {/if}
              {#if eventCount > 0}
                <span> · {eventCount} event{eventCount === 1 ? '' : 's'}</span>
              {/if}
            </div>
          </div>
          <IconTooltipButton label="Close debug events" icon={X} onclick={() => closeModal()} />
        </div>

        <div class="session-debug-modal-body mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {#if session.events.length === 0}
            <div class="muted text-sm">No technical events recorded yet.</div>
          {:else}
            {#each session.events as event (event.id)}
              <div class="surface-muted px-3 py-2">
                <div class="muted mb-1 text-[11px] uppercase tracking-[0.16em]">{event.kind}</div>
                <div class="whitespace-pre-wrap text-sm">{event.text}</div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  </Portal>
{/if}