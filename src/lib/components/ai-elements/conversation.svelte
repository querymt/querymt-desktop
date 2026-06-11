<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    empty = false,
    emptyTitle = 'No messages yet',
    emptyDescription = 'Start a conversation to see messages here.',
    class: className = '',
    children
  }: {
    empty?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div class={`session-conversation-shell ${className}`} role="log">
  {#if empty}
    <div class="empty-state">
      <div class="text-sm font-medium">{emptyTitle}</div>
      <div class="panel-copy mt-1">{emptyDescription}</div>
    </div>
  {:else}
    <div class="session-conversation-content">
      {@render children?.()}
    </div>
  {/if}
</div>
