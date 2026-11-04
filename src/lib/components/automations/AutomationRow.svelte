<script lang="ts">
  import { getContext } from 'svelte';
  import { DropdownMenu } from 'bits-ui';
  import { Ellipsis, Info, LoaderCircle, Pause, Play, Trash2, Zap } from '@lucide/svelte';
  import type { AutomationGroupId, ScheduleTargetSession } from '$lib/domain/automations';
  import { formatDuration, formatTimestamp, scheduleTargetLabel, scheduleTimingSummary, scheduleTriggerExpression, scheduleTriggerLabel } from '$lib/domain/automations';
  import Hint from '$lib/components/primitives/Hint.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import type { ScheduleInfo } from '$lib/querymt/generated/types';

  let {
    schedule,
    group,
    session = null,
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
    /** The session this automation runs in, when the agent's session list knows it. */
    session?: ScheduleTargetSession | null;
    pendingAction?: string | null;
    error?: string | null;
    canPause?: boolean;
    canResume?: boolean;
    canTrigger?: boolean;
    canDelete?: boolean;
    onAction: (action: 'pause' | 'resume' | 'trigger', schedule: ScheduleInfo) => void;
    onDelete: (schedule: ScheduleInfo) => void;
  } = $props();

  const getOverlayTarget = getContext<(() => HTMLElement | null) | undefined>('app-overlay-target');
  const portalTarget = $derived(getOverlayTarget?.() ?? undefined);
  let detailsOpen = $state(false);
  let menuOpen = $state(false);
  const pending = $derived(pendingAction !== null);
  const targetLabel = $derived(scheduleTargetLabel(schedule, session));
</script>

<article class={`automation-row automation-row-${group}`}>
  <div class="automation-row-main">
    <div class="automation-row-title-line">
      <div class="automation-row-title">{scheduleTriggerLabel(schedule)}</div>
      {#if group === 'attention'}<span class="automation-state-chip automation-state-chip-danger">Needs attention</span>{/if}
      {#if group === 'paused'}<span class="automation-state-chip">Paused</span>{/if}
    </div>
    <div class="automation-row-timing">{scheduleTimingSummary(schedule)}</div>
    {#if session?.cwd}
      <Hint as="div" class="automation-row-target" text={session.cwd}>{targetLabel}</Hint>
    {:else}
      <div class="automation-row-target">{targetLabel}</div>
    {/if}
  </div>

  <div class="automation-row-actions">
    {#if group === 'paused'}
      <IconTooltipButton
        label={`Resume ${scheduleTriggerLabel(schedule)}`}
        icon={pendingAction === 'resume' ? LoaderCircle : Play}
        iconClass={pendingAction === 'resume' ? 'animate-spin' : ''}
        controlSize="compact"
        disabled={!canResume || pending}
        onclick={() => onAction('resume', schedule)}
      />
    {:else if group !== 'completed'}
      <IconTooltipButton
        label={`Run ${scheduleTriggerLabel(schedule)} now`}
        icon={pendingAction === 'trigger' ? LoaderCircle : Zap}
        iconClass={pendingAction === 'trigger' ? 'animate-spin' : ''}
        controlSize="compact"
        disabled={!canTrigger || pending}
        onclick={() => onAction('trigger', schedule)}
      />
      <IconTooltipButton
        label={`Pause ${scheduleTriggerLabel(schedule)}`}
        icon={pendingAction === 'pause' ? LoaderCircle : Pause}
        iconClass={pendingAction === 'pause' ? 'animate-spin' : ''}
        controlSize="compact"
        disabled={!canPause || pending}
        onclick={() => onAction('pause', schedule)}
      />
    {/if}

    <DropdownMenu.Root bind:open={menuOpen}>
      <DropdownMenu.Trigger class="icon-btn icon-btn-compact" aria-label={`More actions for ${scheduleTriggerLabel(schedule)}`}>
        <Ellipsis size={14} strokeWidth={2} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal to={portalTarget}>
        <DropdownMenu.Content class="session-actions-content" sideOffset={5} align="end" loop>
          {#if group === 'paused'}
            <DropdownMenu.Item disabled={!canTrigger || pending} onSelect={() => onAction('trigger', schedule)}>
              <Zap size={14} />Run now
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Item onSelect={() => (detailsOpen = !detailsOpen)}>
            <Info size={14} />{detailsOpen ? 'Hide details' : 'Show details'}
          </DropdownMenu.Item>
          <DropdownMenu.Separator class="session-actions-separator" />
          <DropdownMenu.Item class="session-actions-danger" disabled={!canDelete || pending} aria-label={`Delete ${scheduleTriggerLabel(schedule)}`} onSelect={() => onDelete(schedule)}>
            <Trash2 size={14} />Delete automation
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
      <div><dt>Runtime limit</dt><dd>{formatDuration(schedule.max_runtime_seconds)}</dd></div>
      <div><dt>Updated</dt><dd>{formatTimestamp(schedule.updated_at)}</dd></div>
    </dl>
  {/if}
</article>
