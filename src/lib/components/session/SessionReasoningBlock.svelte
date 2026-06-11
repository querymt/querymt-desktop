<script lang="ts">
  import { Sparkles } from '@lucide/svelte';

  let {
    reasoning,
    open = false
  }: {
    reasoning: Array<{ id: string; html: string; isLive: boolean }>;
    open?: boolean;
  } = $props();
</script>

{#if reasoning.length > 0}
  <details class="details-reset session-reasoning" {open}>
    <summary class="session-reasoning-summary">
      <span class="session-message-avatar"><Sparkles size={14} /></span>
      <span>Reasoning</span>
      <span class="badge">{reasoning.length}</span>
    </summary>
    <div class="session-reasoning-body">
      {#each reasoning as entry}
        <div class="session-reasoning-entry markdown-body">{@html entry.html}</div>
      {/each}
    </div>
  </details>
{/if}
