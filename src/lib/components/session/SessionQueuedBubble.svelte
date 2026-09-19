<script lang="ts">
  import { Clock, Navigation, Plus } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import type { PendingSessionInput } from '$lib/domain/types';

  let {
    inputs = []
  }: {
    inputs?: PendingSessionInput[];
  } = $props();

  let open = $state(false);
  let panelElement = $state<HTMLDivElement | null>(null);
  let triggerElement: HTMLElement | null = null;

  const hint = $derived(`${inputs.length} waiting ${inputs.length === 1 ? 'message' : 'messages'}`);

  // The session dock is its own stacking context (fixed, z-index 34), so the
  // open panel portals to <body> to paint above page-level overlays.
  function portalToBody(node: HTMLDivElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      }
    };
  }

  function toggleQueuedPanel(event: MouseEvent) {
    triggerElement = event.currentTarget as HTMLElement;
    open = !open;
  }

  $effect(() => {
    if (!open) return;
    const panel = panelElement;
    const trigger = triggerElement;
    if (!panel || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    panel.style.right = `${Math.max(0, window.innerWidth - rect.right)}px`;
    panel.style.bottom = `${Math.max(0, window.innerHeight - rect.top + 8)}px`;
  });

  $effect(() => {
    if (!open) return;
    if (inputs.length === 0) {
      open = false;
      return;
    }
    const close = () => (open = false);
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelElement?.contains(target) || triggerElement?.contains(target)) return;
      open = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false;
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('scroll', close, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  });
</script>

{#if inputs.length > 0}
  <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
    <Tooltip.Root disableHoverableContent>
      <Tooltip.Trigger
        type="button"
        class={`session-queued-bubble ${open ? 'open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={hint}
        onclick={toggleQueuedPanel}
      >
        <Clock size={14} aria-hidden="true" />
        <span class="session-queued-bubble-title">{inputs.length}</span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="app-tooltip-content" sideOffset={6}>
          {hint}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}

{#if open}
  <div
    bind:this={panelElement}
    use:portalToBody
    class="session-queued-panel"
    role="dialog"
    aria-label="Waiting messages"
  >
    <div class="session-queued-panel-heading">Waiting messages</div>
    {#each inputs as input (input.inputId)}
      <div class="session-queued-panel-item">
        <span class="session-queued-panel-state">
          {#if input.delivery === 'queue'}
            <Plus size={12} aria-hidden="true" />
          {:else}
            <Navigation size={12} aria-hidden="true" />
          {/if}
          {input.state}
        </span>
        <span class="session-queued-panel-prompt" title={input.prompt}>
          {input.prompt || `${input.attachments.length} attachment(s)`}
        </span>
      </div>
    {/each}
  </div>
{/if}
