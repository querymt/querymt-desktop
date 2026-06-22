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
        <span class="session-activities-label"><Wrench size={14} /> Activities</span>
        <span class="badge">{activities.length}</span>
      </span>
      <span class="session-activities-summary-status">
        {#if activeLabel}
          <span class="session-activities-status-chip session-activities-status-chip-running">
            <LoaderCircle size={12} class="animate-spin" />
            <span>{activeLabel}</span>
          </span>
        {/if}
        {#if runningCount > 0}
          <span class="session-activities-status-chip session-activities-status-chip-running">
            <LoaderCircle size={12} class="animate-spin" />
            <span>{runningCount} running</span>
          </span>
        {/if}
        {#if failedCount > 0}
          <span class="session-activities-status-chip session-activities-status-chip-failed">
            <AlertTriangle size={12} />
            <span>{failedCount} failed</span>
          </span>
        {/if}
        {#if completedCount > 0}
          <span class="session-activities-status-chip session-activities-status-chip-completed">
            <CheckCircle2 size={12} />
            <span>{completedCount} done</span>
          </span>
        {/if}
      </span>
    </summary>
    <div class="session-activities-list">
      {#each activities as activity}
        <SessionToolBlock tool={activity.tool} open={activity.tool.id === activeToolCallId || activity.tool.status === 'in_progress'} />
      {/each}
    </div>
  </details>
{/if}
