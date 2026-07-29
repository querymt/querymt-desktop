<script lang="ts">
  import { AlertTriangle, ChevronDown, Wrench } from '@lucide/svelte';
  import SessionReasoningBlock from '$lib/components/session/SessionReasoningBlock.svelte';
  import SessionToolBlock from '$lib/components/session/SessionToolBlock.svelte';
  import type { SessionConversationWorkGroup } from '$lib/domain/session-conversation';

  let {
    group,
    initiallyExpanded = false,
    onDisclosureChange
  }: {
    group: SessionConversationWorkGroup;
    initiallyExpanded?: boolean;
    onDisclosureChange?: (anchor: HTMLElement, expanded: boolean) => void;
  } = $props();

  let expanded = $state(false);

  $effect(() => {
    if (initiallyExpanded) expanded = true;
  });
  const compactActiveContent = $derived.by(() => {
    if (group.settled || group.content.length <= 3) return group.content;
    const failed = group.content.filter((item) => item.type === 'tool' && item.tool.status === 'failed');
    const latest = group.content.slice(-2);
    const visibleIds = new Set([...failed, ...latest].map((item) => item.id));
    return group.content.filter((item) => visibleIds.has(item.id));
  });
  const visibleContent = $derived(expanded ? group.content : compactActiveContent);
  const hiddenActiveCount = $derived(Math.max(0, group.content.length - compactActiveContent.length));
  const summaryLabel = $derived.by(() => {
    const parts: string[] = [];
    if (group.toolCount > 0) parts.push(`${group.toolCount} tool call${group.toolCount === 1 ? '' : 's'}`);
    if (group.reasoningCount > 0) parts.push(`${group.reasoningCount} reasoning step${group.reasoningCount === 1 ? '' : 's'}`);
    return parts.length > 0 ? `Worked through ${parts.join(' and ')}` : 'Worked';
  });
  const summaryAccessibleLabel = $derived(
    `${summaryLabel}${group.failedToolCount > 0 ? `, ${group.failedToolCount} failed` : ''}`
  );

  function toggleSettled(event: MouseEvent) {
    const button = event.currentTarget as HTMLButtonElement;
    expanded = !expanded;
    onDisclosureChange?.(button, expanded);
  }

  function toggleActiveHistory(event: MouseEvent) {
    const button = event.currentTarget as HTMLButtonElement;
    expanded = !expanded;
    onDisclosureChange?.(button, expanded);
  }
</script>

<section class:session-work-group-settled={group.settled} class:session-work-group-expanded={expanded} class="session-work-group" aria-label="Agent work">
  {#if group.settled}
    <button class="session-work-summary" type="button" aria-label={summaryAccessibleLabel} aria-expanded={expanded} onclick={toggleSettled}>
      <span class="session-work-summary-icon" aria-hidden="true"><Wrench size={14} /></span>
      <span class="session-work-summary-label">{summaryLabel}</span>
      {#if group.failedToolCount > 0}
        <span class="session-work-summary-failure"><AlertTriangle size={12} /> {group.failedToolCount} failed</span>
      {/if}
      <ChevronDown class="session-work-summary-chevron" size={14} aria-hidden="true" />
    </button>
  {:else if hiddenActiveCount > 0}
    <button class="session-work-history-toggle" type="button" aria-expanded={expanded} onclick={toggleActiveHistory}>
      <ChevronDown size={13} aria-hidden="true" />
      <span>{expanded ? 'Show fewer work entries' : `+${hiddenActiveCount} previous work ${hiddenActiveCount === 1 ? 'entry' : 'entries'}`}</span>
    </button>
  {/if}

  {#if expanded || !group.settled}
    <div class="session-work-list">
      {#each visibleContent as item (item.id)}
        {#if item.type === 'reasoning'}
          <SessionReasoningBlock reasoning={[item]} />
        {:else}
          <SessionToolBlock tool={item.tool} />
        {/if}
      {/each}
    </div>
  {/if}
</section>
