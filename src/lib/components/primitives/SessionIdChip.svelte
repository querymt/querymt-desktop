<script lang="ts">
  import { Check } from '@lucide/svelte';

  let {
    sessionId,
    class: className = ''
  }: {
    sessionId: string;
    class?: string;
  } = $props();

  const shortId = $derived(sessionId.slice(0, 13));
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(event: MouseEvent) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(sessionId);
      copied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copied = false;
      }, 1200);
    } catch (error) {
      console.error('Failed to copy session ID', error);
    }
  }
</script>

<button
  class={`session-id-chip ${className}`}
  type="button"
  title="Copy session ID"
  aria-label="Copy session ID"
  onclick={copy}
>
  <span class="session-id-chip-value">{shortId}</span>
  {#if copied}
    <span class="session-id-chip-copied" role="status">
      <Check size={11} aria-hidden="true" />
      <span>copied</span>
    </span>
  {/if}
</button>
