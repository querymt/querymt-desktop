<script lang="ts">
  import AutomationRow from './AutomationRow.svelte';
  import type { AutomationGroup } from '$lib/domain/automations';
  import type { ScheduleInfo } from '$lib/querymt/generated/types';

  let {
    group,
    pendingAction = null,
    errors = {},
    canPause = false,
    canResume = false,
    canTrigger = false,
    canDelete = false,
    onAction,
    onDelete
  }: {
    group: AutomationGroup;
    pendingAction?: { scheduleId: string; action: string } | null;
    errors?: Record<string, string | undefined>;
    canPause?: boolean;
    canResume?: boolean;
    canTrigger?: boolean;
    canDelete?: boolean;
    onAction: (action: 'pause' | 'resume' | 'trigger', schedule: ScheduleInfo) => void;
    onDelete: (schedule: ScheduleInfo) => void;
  } = $props();
</script>

<section class="settings-section automation-group" aria-labelledby={`automation-group-${group.id}`}>
  <div class="settings-section-header settings-section-header-action">
    <div><h2 id={`automation-group-${group.id}`}>{group.label}</h2></div>
    <span class="badge">{group.schedules.length}</span>
  </div>
  <div class="automation-list">
    {#each group.schedules as schedule (schedule.public_id)}
      <AutomationRow
        {schedule}
        group={group.id}
        pendingAction={pendingAction?.scheduleId === schedule.public_id ? pendingAction.action : null}
        error={errors[schedule.public_id]}
        {canPause}
        {canResume}
        {canTrigger}
        {canDelete}
        {onAction}
        {onDelete}
      />
    {/each}
  </div>
</section>
