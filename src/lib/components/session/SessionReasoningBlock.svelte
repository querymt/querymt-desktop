<script lang="ts">
  import { ChevronDown, Sparkles } from '@lucide/svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';

  let { reasoning }: { reasoning: Array<{ id: string; html: string; isLive: boolean }> } = $props();

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
  const live = $derived(reasoning.some((entry) => entry.isLive));
</script>

{#if reasoning.length > 0}
  <details class:session-reasoning-live={live} class="details-reset session-reasoning" aria-label={`Reasoning - ${previewTitle}`}>
    <summary class="session-reasoning-summary" aria-label={`Reasoning - ${previewTitle}`}>
      <span class="session-reasoning-icon" aria-hidden="true"><Sparkles size={14} /></span>
      <span class="session-reasoning-preview">{previewTitle}</span>
      <span class="session-reasoning-disclosure" aria-hidden="true"><ChevronDown size={13} /></span>
    </summary>
    <div class="session-reasoning-body">
      {#each reasoning as entry}
        <div class="session-reasoning-entry markdown-body" use:enhanceCodeBlocks>{@html entry.html}</div>
      {/each}
    </div>
  </details>
{/if}
