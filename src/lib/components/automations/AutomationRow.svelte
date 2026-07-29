<script lang="ts">
  import { Ellipsis, LoaderCircle, Pause, Play, Trash2, Zap } from '@lucide/svelte';
  import type { AutomationGroupId } from '$lib/domain/automations';
  import { scheduleTargetLabel, scheduleTimingSummary, scheduleTriggerExpression, scheduleTriggerLabel } from '$lib/domain/automations';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import type { ScheduleInfo } from '$lib/querymt/generated/types';

  let {
    schedule,
    group,
    pendingAction = null,
    error = null,
    canPause = false,
    canResume = false,
    canTrigger = false,
    canDelete = false,
    onAction,
    onDelete
  }: {
    schedule: ScheduleInfo;
    group: AutomationGroupId;
    pendingAction?: string | null;
    error?: string | null;
    canPause?: boolean;
    canResume?: boolean;
    canTrigger?: boolean;
    canDelete?: boolean;
    onAction: (action: 'pause' | 'resume' | 'trigger', schedule: ScheduleInfo) => void;
    onDelete: (schedule: ScheduleInfo) => void;
  } = $props();

  let detailsOpen = $state(false);
  const pending = $derived(pendingAction !== null);
</script>

<article class={`automation-row automation-row-${group}`}>
  <div class="automation-row-main">
    <div class="automation-row-title-line">
      <div class="automation-row-title">{scheduleTriggerLabel(schedule)}</div>
      {#if group === 'attention'}<span class="automation-state-chip automation-state-chip-danger">Needs attention</span>{/if}
      {#if group === 'paused'}<span class="automation-state-chip">Paused</span>{/if}
    </div>
    <div class="automation-row-timing">{scheduleTimingSummary(schedule)}</div>
    <div class="automation-row-target">{scheduleTargetLabel(schedule)}</div>
  </div>

  <div class="automation-row-actions">
    {#if group === 'paused'}
      <IconTooltipButton
        label={`Resume ${scheduleTriggerLabel(schedule)}`}
        icon={pendingAction === 'resume' ? LoaderCircle : Play}
        iconClass={pendingAction === 'resume' ? 'animate-spin' : ''}
        disabled={!canResume || pending}
        onclick={() => onAction('resume', schedule)}
      />
    {:else if group !== 'completed'}
      <IconTooltipButton
        label={`Run ${scheduleTriggerLabel(schedule)} now`}
        icon={pendingAction === 'trigger' ? LoaderCircle : Zap}
        iconClass={pendingAction === 'trigger' ? 'animate-spin' : ''}
        disabled={!canTrigger || pending}
        onclick={() => onAction('trigger', schedule)}
      />
      <IconTooltipButton
        label={`Pause ${scheduleTriggerLabel(schedule)}`}
        icon={pendingAction === 'pause' ? LoaderCircle : Pause}
        iconClass={pendingAction === 'pause' ? 'animate-spin' : ''}
        disabled={!canPause || pending}
        onclick={() => onAction('pause', schedule)}
      />
    {/if}

    <details class="automation-row-menu">
      <summary class="automation-row-menu-trigger" aria-label={`More actions for ${scheduleTriggerLabel(schedule)}`} title="More actions"><Ellipsis size={16} /></summary>
      <div class="automation-row-menu-content">
        {#if group === 'paused'}
          <button type="button" disabled={!canTrigger || pending} onclick={() => onAction('trigger', schedule)}><Zap size={14} />Run now</button>
        {/if}
        <button type="button" onclick={() => (detailsOpen = !detailsOpen)}>{detailsOpen ? 'Hide details' : 'Show details'}</button>
        <button class="automation-row-menu-danger" type="button" aria-label={`Delete ${scheduleTriggerLabel(schedule)}`} disabled={!canDelete || pending} onclick={() => onDelete(schedule)}><Trash2 size={14} />Delete automation</button>
      </div>
    </details>
  </div>

  {#if error}
    <div class="automation-row-error" role="alert">{error}</div>
  {/if}

  {#if detailsOpen}
    <dl class="automation-row-details">
      <div><dt>Schedule</dt><dd>{schedule.public_id}</dd></div>
      <div><dt>Task</dt><dd>{schedule.task_public_id}</dd></div>
      <div><dt>Expression</dt><dd>{scheduleTriggerExpression(schedule) ?? 'Unavailable'}</dd></div>
      <div><dt>Runs</dt><dd>{schedule.run_count}{schedule.max_runs ? ` / ${schedule.max_runs}` : ''}</dd></div>
      <div><dt>Runtime limit</dt><dd>{schedule.max_runtime_seconds}s</dd></div>
      <div><dt>Updated</dt><dd>{schedule.updated_at}</dd></div>
    </dl>
  {/if}
</article>
