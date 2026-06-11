<script lang="ts">
  import { Wrench } from '@lucide/svelte';
  import SessionToolBlock from '$lib/components/session/SessionToolBlock.svelte';
  import type { SessionActivityItem } from '$lib/domain/session-conversation';

  let {
    activities,
    activeToolCallId = null
  }: {
    activities: SessionActivityItem[];
    activeToolCallId?: string | null;
  } = $props();

  const hasRunningActivity = $derived.by(() =>
    activities.some((activity) => activity.tool.id === activeToolCallId || activity.tool.status === 'in_progress' || activity.tool.status === 'failed')
  );
</script>

{#if activities.length > 0}
  <details class="details-reset session-activities" open={hasRunningActivity}>
    <summary class="session-activities-summary">
      <span class="row-tight"><Wrench size={14} /> Activities</span>
      <span class="badge">{activities.length}</span>
    </summary>
    <div class="session-activities-list">
      {#each activities as activity}
        <SessionToolBlock tool={activity.tool} open={activity.tool.id === activeToolCallId || activity.tool.status === 'in_progress' || activity.tool.status === 'failed'} />
      {/each}
    </div>
  </details>
{/if}
