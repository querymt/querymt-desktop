<script lang="ts">
  import { Check } from '@lucide/svelte';

  let {
    value,
    display = null,
    title = 'Copy',
    as = 'button',
    class: className = ''
  }: {
    /** Text placed on the clipboard. */
    value: string;
    /** Optional display text overriding the value. */
    display?: string | null;
    title?: string;
    /** Use `span` where a nested `<button>` would be invalid (e.g. inside an accordion trigger). */
    as?: 'button' | 'span';
    class?: string;
  } = $props();

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(event: MouseEvent | KeyboardEvent) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copied = false;
      }, 1200);
    } catch (error) {
      console.error('Failed to copy', error);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void copy(event);
  }
</script>

<svelte:element
  this={as}
  class={`copy-chip ${className}`}
  title={copied ? 'Copied' : title}
  aria-label={title}
  type={as === 'button' ? 'button' : undefined}
  role={as === 'span' ? 'button' : undefined}
  tabindex={as === 'span' ? -1 : undefined}
  onclick={copy}
  onkeydown={as === 'span' ? handleKeydown : undefined}
>
  <span class="copy-chip-label">{display ?? value}</span>
  {#if copied}
    <span class="copy-chip-copied" role="status">
      <Check size={11} aria-hidden="true" />
      <span>copied</span>
    </span>
  {/if}
</svelte:element>
