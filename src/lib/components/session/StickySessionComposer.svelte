<script lang="ts">
  import { fly } from 'svelte/transition';
  import { CornerDownLeft, Expand, SendHorizontal } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';

  let {
    prompt = '',
    loading = false,
    visible = false,
    onPromptInput,
    onSendPrompt,
    onExpand
  }: {
    prompt?: string;
    loading?: boolean;
    visible?: boolean;
    onPromptInput: (value: string) => void;
    onSendPrompt: () => void;
    onExpand: () => void;
  } = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSendPrompt();
    }
  }
</script>

{#if visible}
  <div class="sticky-session-composer" transition:fly={{ y: 18, duration: 180 }}>
    <div class="sticky-session-composer-shell">
      <button class="sticky-session-expand" type="button" onclick={onExpand} aria-label="Jump to full composer">
        <Expand size={14} />
        <span>Expand</span>
      </button>

      <div class="sticky-session-input-shell">
        <input
          class="sticky-session-input"
          type="text"
          value={prompt}
          placeholder="Reply to this session…"
          oninput={(event) => onPromptInput((event.currentTarget as HTMLInputElement).value)}
          onkeydown={handleKeydown}
        />
        <div class="sticky-session-hint">
          <CornerDownLeft size={12} />
          <span>Send</span>
        </div>
      </div>

      <IconTooltipButton label="Send reply" icon={SendHorizontal} tone="primary" size={16} disabled={loading} onclick={onSendPrompt} />
    </div>
  </div>
{/if}
