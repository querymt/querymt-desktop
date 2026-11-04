<script lang="ts">
  import { Check } from '@lucide/svelte';
  import Hint from '$lib/components/primitives/Hint.svelte';

  let {
    sessionId,
    length = 13,
    tooltip = false,
    class: className = ''
  }: {
    sessionId: string;
    /** Characters of the id to display; the full id is always what gets copied. */
    length?: number;
    /** Show the hint in a bits-ui tooltip instead of a native title. */
    tooltip?: boolean;
    class?: string;
  } = $props();

  const shortId = $derived(sessionId.slice(0, length));
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

{#snippet content()}
  <span class="session-id-chip-value">{shortId}</span>
  {#if copied}
    <span class="session-id-chip-copied" role="status">
      <Check size={11} aria-hidden="true" />
      <span>copied</span>
    </span>
  {/if}
{/snippet}

{#if tooltip}
  <Hint
    text={copied ? 'Copied' : 'Copy session ID'}
    as="button"
    class={`session-id-chip ${className}`}
    type="button"
    aria-label="Copy session ID"
    onclick={copy}
  >
    {@render content()}
  </Hint>
{:else}
  <button
    class={`session-id-chip ${className}`}
    type="button"
    title="Copy session ID"
    aria-label="Copy session ID"
    onclick={copy}
  >
    {@render content()}
  </button>
{/if}
