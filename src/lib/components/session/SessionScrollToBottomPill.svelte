<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { ChevronDown } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';

  let {
    visible = false,
    alignLeft = null,
    alignWidth = null,
    onScrollToBottom
  }: {
    visible?: boolean;
    alignLeft?: number | null;
    alignWidth?: number | null;
    onScrollToBottom: () => void;
  } = $props();

  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const pillIntro = {
    delay: prefersReducedMotion ? 0 : 60,
    duration: prefersReducedMotion ? 0 : 160,
    easing: cubicOut,
    y: 10
  };
  const pillOutro = {
    duration: prefersReducedMotion ? 0 : 120,
    easing: cubicOut,
    y: 6
  };

  const positionStyle = $derived.by(() => {
    if (alignLeft == null || alignWidth == null) return '';
    return `left:${alignLeft}px;width:${alignWidth}px;transform:none;`;
  });
</script>

{#if visible}
  <div class="session-scroll-bottom-pill-host" style={positionStyle} in:fly={pillIntro} out:fly={pillOutro}>
    <span class="session-scroll-bottom-slot">
      <IconTooltipButton
        label="Scroll to latest message and follow new content"
        icon={ChevronDown}
        size={16}
        onclick={onScrollToBottom}
      />
    </span>
  </div>
{/if}