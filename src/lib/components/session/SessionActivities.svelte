<script lang="ts">
  import { AlertTriangle, CheckCircle2, LoaderCircle, Wrench } from '@lucide/svelte';
  import SessionToolBlock from '$lib/components/session/SessionToolBlock.svelte';
  import type { SessionActivityItem } from '$lib/domain/session-conversation';

  let {
    activities,
    activeToolCallId = null
  }: {
    activities: SessionActivityItem[];
    activeToolCallId?: string | null;
  } = $props();

  let detailsOpen = $state(false);
  let userToggled = $state(false);
  let lastActivityStateKey = $state('');

  const hasRunningActivity = $derived.by(() =>
    activities.some((activity) => activity.tool.id === activeToolCallId || activity.tool.status === 'in_progress')
  );
  const runningCount = $derived(activities.filter((activity) => activity.tool.status === 'in_progress').length);
  const failedCount = $derived(activities.filter((activity) => activity.tool.status === 'failed').length);
  const completedCount = $derived(activities.filter((activity) => activity.tool.status === 'completed').length);
  const activeLabel = $derived.by(() => {
    const active = activities.find((activity) => activity.tool.id === activeToolCallId) ?? activities.find((activity) => activity.tool.status === 'in_progress');
    return active?.tool.title ?? null;
  });
  const summaryState = $derived.by(() => {
    if (failedCount > 0) return 'failed';
    if (hasRunningActivity) return 'running';
    if (completedCount === activities.length) return 'completed';
    return 'idle';
  });
  const summaryText = $derived.by(() => {
    const noun = activities.length === 1 ? 'activity' : 'activities';
    if (activeLabel) return activeLabel;
    if (runningCount > 0) return `${runningCount} running`;
    if (failedCount > 0) return `${failedCount} failed${completedCount > 0 ? ` · ${completedCount} done` : ''}`;
    if (completedCount === activities.length) return `${activities.length} ${noun} completed`;
    return `${activities.length} ${noun}`;
  });

  $effect(() => {
    const nextKey = activities.map((activity) => `${activity.tool.id}:${activity.tool.status}`).join('|');
    if (nextKey !== lastActivityStateKey) {
      lastActivityStateKey = nextKey;
      if (!userToggled || hasRunningActivity) {
        detailsOpen = hasRunningActivity;
      }
      if (hasRunningActivity) {
        userToggled = false;
      }
    }
  });

  function handleToggle(event: Event) {
    const target = event.currentTarget as HTMLDetailsElement;
    detailsOpen = target.open;
    userToggled = true;
  }
</script>

{#if activities.length > 0}
  <details class="details-reset session-activities" bind:open={detailsOpen} ontoggle={handleToggle}>
    <summary class="session-activities-summary">
      <span class="session-activities-summary-main">
        <span class={`session-activities-icon session-activities-icon-${summaryState}`} aria-label="Activities">
          {#if summaryState === 'failed'}
            <AlertTriangle size={14} />
          {:else if summaryState === 'running'}
            <LoaderCircle size={14} class="animate-spin" />
          {:else if summaryState === 'completed'}
            <CheckCircle2 size={14} />
          {:else}
            <Wrench size={14} />
          {/if}
        </span>
        <span class="session-activities-preview">{summaryText}</span>
      </span>
      <span class="badge">{activities.length}</span>
    </summary>
    <div class="session-activities-list">
      {#each activities as activity}
        <SessionToolBlock tool={activity.tool} open={activity.tool.id === activeToolCallId || activity.tool.status === 'in_progress'} />
      {/each}
    </div>
  </details>
{/if}
