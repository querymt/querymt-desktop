<script lang="ts">
  import { ChevronDown, ChevronUp } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import {
    groupSessionTurnNavItems,
    scrollDeltaToRevealRect,
    type SessionTurnNavItem
  } from '$lib/domain/session-turn-navigation';

  let {
    items,
    activeId = null,
    previousResponseId = null,
    nextResponseId = null,
    visibleInset = null,
    onNavigate
  }: {
    items: SessionTurnNavItem[];
    activeId?: string | null;
    previousResponseId?: string | null;
    nextResponseId?: string | null;
    visibleInset?: number | null;
    onNavigate: (id: string) => void;
  } = $props();

  let tickScroller: HTMLDivElement | null = $state(null);

  const groups = $derived(groupSessionTurnNavItems(items));
  const insetStyle = $derived(
    visibleInset == null ? undefined : `--session-turn-nav-inset:${visibleInset}px`
  );

  $effect(() => {
    const id = activeId;
    const scroller = tickScroller;
    if (!id || !scroller) return;
    const button = scroller.querySelector<HTMLElement>(`[data-nav-item-id="${id}"]`);
    if (!button) return;
    const delta = scrollDeltaToRevealRect(scroller.getBoundingClientRect(), button.getBoundingClientRect());
    if (delta !== 0) scroller.scrollTop += delta;
  });
</script>

<nav class="session-turn-navigation" aria-label="Turn navigation" style={insetStyle}>
  <IconTooltipButton
    label="Previous response"
    icon={ChevronUp}
    controlSize="compact"
    size={14}
    ariaDisabled={!previousResponseId}
    onclick={() => previousResponseId && onNavigate(previousResponseId)}
  />

  <div bind:this={tickScroller} class="session-turn-navigation-ticks">
    {#each groups as group (group[0].turnId)}
      <div class="session-turn-navigation-group">
        {#each group as item (item.id)}
          <button
            class={`session-turn-nav-tick session-turn-nav-tick-${item.kind} ${item.id === activeId ? 'session-turn-nav-tick-active' : ''}`}
            type="button"
            data-nav-item-id={item.id}
            aria-label={item.label}
            aria-current={item.id === activeId ? 'true' : undefined}
            onclick={() => onNavigate(item.id)}
          ></button>
        {/each}
      </div>
    {/each}
  </div>

  <IconTooltipButton
    label="Next response"
    icon={ChevronDown}
    controlSize="compact"
    size={14}
    ariaDisabled={!nextResponseId}
    onclick={() => nextResponseId && onNavigate(nextResponseId)}
  />
</nav>
