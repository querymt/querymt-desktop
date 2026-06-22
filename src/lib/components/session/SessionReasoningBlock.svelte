<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import { Sparkles } from '@lucide/svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';

  let {
    reasoning,
    open = false
  }: {
    reasoning: Array<{ id: string; html: string; isLive: boolean }>;
    open?: boolean;
  } = $props();

  const previewMaxLength = 122;

  function stripHtml(html: string) {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncatePreview(text: string) {
    return text.length > previewMaxLength ? `${text.slice(0, previewMaxLength - 3)}...` : text;
  }

  const previewTitle = $derived.by(() => {
    const first = reasoning.map((entry) => stripHtml(entry.html)).find(Boolean);
    return first ? truncatePreview(first) : 'Thinking';
  });
</script>

{#if reasoning.length > 0}
  <details class="details-reset session-reasoning" {open}>
    <summary class="session-reasoning-summary">
      <span class="session-reasoning-summary-main">
        <Tooltip.Root delayDuration={250} disableHoverableContent>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <span {...props} class="session-reasoning-icon" aria-label="Reasoning"><Sparkles size={14} /></span>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="app-tooltip-content" sideOffset={6}>Reasoning</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <span class="session-reasoning-preview">{previewTitle}</span>
      </span>
      <span class="badge">{reasoning.length}</span>
    </summary>
    <div class="session-reasoning-body">
      {#each reasoning as entry}
        <div class="session-reasoning-entry markdown-body" use:enhanceCodeBlocks>{@html entry.html}</div>
      {/each}
    </div>
  </details>
{/if}
