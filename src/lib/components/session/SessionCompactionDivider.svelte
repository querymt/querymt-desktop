<script lang="ts">
  import { ChevronDown, FoldVertical, LoaderCircle, TriangleAlert } from '@lucide/svelte';
  import { describeCompaction } from '$lib/domain/session-compaction';
  import { renderMarkdownToHtml } from '$lib/domain/markdown';
  import type { SessionCompactionItem } from '$lib/domain/types';

  let { compaction }: { compaction: SessionCompactionItem } = $props();

  let expanded = $state(false);
  const panelId = $props.id();
  const presentation = $derived(describeCompaction(compaction));
  const hasSummary = $derived(compaction.summary.trim().length > 0);
  // Streaming summaries stay plain text until settled, like live assistant output.
  const summaryHtml = $derived(
    expanded && hasSummary && compaction.status !== 'in_progress' ? renderMarkdownToHtml(compaction.summary) : ''
  );
</script>

<section
  class={`session-compaction session-compaction-${presentation.tone}`}
  data-compaction-id={compaction.id}
  data-turn-id={`compaction-${compaction.id}`}
  aria-label={presentation.title}
>
  <div class="session-compaction-rule" role="separator" aria-hidden="true"></div>
  <div class="session-compaction-header">
    <span class="session-compaction-mark" aria-hidden="true">
      {#if presentation.tone === 'running'}
        <LoaderCircle size={14} class="animate-spin" />
      {:else if presentation.tone === 'failed'}
        <TriangleAlert size={14} />
      {:else}
        <FoldVertical size={14} />
      {/if}
    </span>
    <span class="session-compaction-title" class:session-compaction-title-live={presentation.tone === 'running'}>
      {presentation.title}
    </span>
    {#if presentation.detail}
      <span class="session-compaction-detail">{presentation.detail}</span>
    {/if}
    {#if hasSummary}
      <button
        type="button"
        class="session-compaction-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        onclick={() => (expanded = !expanded)}
      >
        {expanded ? 'Hide summary' : 'Show summary'}
        <ChevronDown size={12} class={expanded ? 'session-compaction-chevron-open' : ''} aria-hidden="true" />
      </button>
    {/if}
  </div>
  <div class="session-compaction-rule" aria-hidden="true"></div>
  {#if expanded && hasSummary}
    <div id={panelId} class="session-compaction-summary">
      {#if summaryHtml}
        <div class="markdown-body">{@html summaryHtml}</div>
      {:else}
        <p class="session-compaction-summary-live">{compaction.summary}</p>
      {/if}
    </div>
  {/if}
</section>
