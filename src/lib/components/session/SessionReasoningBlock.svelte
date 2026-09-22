<script lang="ts">
  import { ChevronDown, Sparkles } from '@lucide/svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';
  import { renderMarkdownToHtml, splitStreamingMarkdown } from '$lib/domain/markdown';
  import type { SessionReasoningContent } from '$lib/domain/session-conversation';

  let { reasoning }: { reasoning: SessionReasoningContent[] } = $props();

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

  function reasoningParts(entry: SessionReasoningContent) {
    if (entry.isLive && entry.text) return splitStreamingMarkdown(entry.text);
    return { frozenHtml: entry.html, tailText: '' };
  }

  function summaryHtml(entry: SessionReasoningContent) {
    if (entry.isLive && entry.text) return renderMarkdownToHtml(entry.text);
    if (entry.html) return entry.html;
    return entry.text ? renderMarkdownToHtml(entry.text) : '';
  }

  function entryPreview(entry: SessionReasoningContent) {
    if (entry.summary) return stripHtml(summaryHtml(entry));
    const parts = reasoningParts(entry);
    return stripHtml(parts.frozenHtml) || parts.tailText.trim();
  }

  const summaryRun = $derived(reasoning.length > 0 && reasoning.every((entry) => entry.summary));
  const expandable = $derived(!summaryRun || reasoning.length > 1);
  const previewTitle = $derived.by(() => {
    for (let index = reasoning.length - 1; index >= 0; index -= 1) {
      const text = entryPreview(reasoning[index]);
      if (text) return truncatePreview(text);
    }
    return 'Thinking';
  });
  const live = $derived(reasoning.some((entry) => entry.isLive));
</script>

{#if reasoning.length > 0}
  {#if expandable}
    <details class:session-reasoning-live={live} class="details-reset session-reasoning" aria-label={`Reasoning - ${previewTitle}`}>
      <summary class="session-reasoning-summary" aria-label={`Reasoning - ${previewTitle}`}>
        <span class="session-reasoning-icon" aria-hidden="true"><Sparkles size={14} /></span>
        <span class="session-reasoning-preview">{previewTitle}</span>
        <span class="session-reasoning-disclosure" aria-hidden="true"><ChevronDown size={13} /></span>
      </summary>
      {#if summaryRun}
        <div class="session-reasoning-body session-reasoning-summary-list">
          {#each reasoning as entry (entry.id)}
            <div class="session-reasoning-summary-item">
              <span class="session-reasoning-summary-bullet" aria-hidden="true">-</span>
              <div class="session-reasoning-summary-markdown">{@html summaryHtml(entry)}</div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="session-reasoning-body">
          {#each reasoning as entry (entry.id)}
            {@const parts = reasoningParts(entry)}
            <div class="session-reasoning-entry markdown-body" use:enhanceCodeBlocks>
              {#if parts.frozenHtml}<div class="session-reasoning-frozen">{@html parts.frozenHtml}</div>{/if}
              {#if parts.tailText}<div class="session-reasoning-tail">{parts.tailText}</div>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </details>
  {:else}
    <div class:session-reasoning-live={live} class="session-reasoning session-reasoning-static" aria-label={`Reasoning - ${previewTitle}`}>
      <span class="session-reasoning-icon" aria-hidden="true"><Sparkles size={14} /></span>
      <span class="session-reasoning-preview">{previewTitle}</span>
    </div>
  {/if}
{/if}
