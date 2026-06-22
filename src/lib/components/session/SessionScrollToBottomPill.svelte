<script lang="ts">
  import { fly } from 'svelte/transition';
  import { ChevronDown } from '@lucide/svelte';

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

  const positionStyle = $derived.by(() => {
    if (alignLeft == null || alignWidth == null) return '';
    return `left:${alignLeft}px;width:${alignWidth}px;transform:none;`;
  });
</script>

{#if visible && alignLeft != null && alignWidth != null}
  <div class="session-scroll-bottom-pill-host" style={positionStyle} transition:fly={{ y: 10, duration: 160 }}>
    <button class="session-composer-dock-collapsed session-scroll-bottom-pill" type="button" onclick={onScrollToBottom}>
      <span>Latest</span>
      <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>
{/if}