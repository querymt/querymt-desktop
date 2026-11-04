<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';

  // Renders `as` itself (no wrapper element) as a bits-ui tooltip trigger, so
  // existing markup, classes and test ids stay where they are. Replaces native
  // `title` tooltips. Extra props go to the rendered element; event handlers are
  // chained after the tooltip's own so neither side is overridden.
  let {
    text,
    detail = null,
    as = 'span',
    side = 'bottom',
    align = 'center',
    disabled = false,
    children,
    ...rest
  }: {
    text: string;
    /** Optional dimmed second line. */
    detail?: string | null;
    as?: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    disabled?: boolean;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();

  const multiline = $derived(!!detail || text.includes('\n'));

  function merge(triggerProps: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...triggerProps };
    for (const [key, value] of Object.entries(rest)) {
      const existing = merged[key];
      if (typeof value === 'function' && typeof existing === 'function') {
        merged[key] = (...args: unknown[]) => {
          (existing as (...a: unknown[]) => void)(...args);
          (value as (...a: unknown[]) => void)(...args);
        };
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }
</script>

<Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
  <Tooltip.Root disableHoverableContent {disabled}>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <svelte:element this={as} {...merge(props)}>{@render children?.()}</svelte:element>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content class={`app-tooltip-content ${multiline ? 'app-tooltip-multiline' : ''}`} {side} {align} sideOffset={6}>
        {text}
        {#if detail}<span class="app-tooltip-detail">{detail}</span>{/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
