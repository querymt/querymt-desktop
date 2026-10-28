<script lang="ts">
  import { Clock, Navigation, Plus, X } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import type { PendingSessionInput } from '$lib/domain/types';

  let {
    inputs = [],
    onDiscardQueued
  }: {
    inputs?: PendingSessionInput[];
    onDiscardQueued?: (inputId: string) => void | Promise<void>;
  } = $props();

  const panelId = $props.id();
  let open = $state(false);
  let panelElement = $state<HTMLElement>();
  let triggerElement = $state<HTMLButtonElement>();

  const orderedInputs = $derived(
    inputs.toSorted((left, right) => left.createdAt - right.createdAt)
  );
  const hint = $derived(`${inputs.length} waiting ${inputs.length === 1 ? 'message' : 'messages'}`);

  $effect(() => {
    if (inputs.length === 0) open = false;
  });

  function toggleQueuedPanel(event: MouseEvent) {
    triggerElement = event.currentTarget as HTMLButtonElement;
    open = !open;
  }

  function handlePointerDown(event: MouseEvent) {
    if (!open || !(event.target instanceof Node)) return;
    if (panelElement?.contains(event.target) || triggerElement?.contains(event.target)) return;
    open = false;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape') return;
    if (panelElement?.contains(document.activeElement)) triggerElement?.focus();
    open = false;
  }
</script>

<svelte:document onkeydown={handleKeyDown} onmousedown={handlePointerDown} />

{#if inputs.length > 0}
  <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
    <Tooltip.Root disableHoverableContent>
      <Tooltip.Trigger
        type="button"
        class={`session-queued-bubble ${open ? 'open' : ''}`}
        aria-controls={panelId}
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
  <section
    bind:this={panelElement}
    id={panelId}
    class="session-queued-panel"
    aria-label="Waiting messages"
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Allow keyboard scrolling even when only steering messages are listed.) -->
    <div class="session-queued-panel-list" role="region" aria-label="Waiting message list" tabindex="0">
      {#each orderedInputs as input (input.inputId)}
        <div class="session-queued-panel-item">
          <span class="session-queued-panel-state">
            {#if input.delivery === 'queue'}
              <Plus size={12} aria-hidden="true" />
              <span class="sr-only">Queued message:</span>
            {:else}
              <Navigation size={12} aria-hidden="true" />
              <span class="sr-only">Steering message:</span>
            {/if}
            {input.state}
          </span>
          <span class="session-queued-panel-prompt">
            {input.prompt || `${input.attachments.length} attachment(s)`}
          </span>
          {#if input.delivery === 'queue' && input.state === 'queued' && onDiscardQueued}
            <button
              type="button"
              class="session-queued-panel-remove"
              aria-label="Remove queued message"
              disabled={input.discardPending}
              onclick={() => void onDiscardQueued(input.inputId)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}
