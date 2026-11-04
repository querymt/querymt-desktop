<script lang="ts">
  import AutomationRow from './AutomationRow.svelte';
  import type { AutomationGroup, ScheduleTargetSession } from '$lib/domain/automations';
  import type { ScheduleInfo } from '$lib/querymt/generated/types';

  let {
    group,
    sessions = {},
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
    /** Known sessions of the selected agent, keyed by session id. */
    sessions?: Record<string, ScheduleTargetSession | undefined>;
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
        session={sessions[schedule.session_public_id] ?? null}
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
