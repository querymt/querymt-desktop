<script lang="ts">
  import { goto } from '$app/navigation';
  import { Check, Copy, Globe, Link, LoaderCircle, Plus, SlidersHorizontal, X } from '@lucide/svelte';
  import Hint from '$lib/components/primitives/Hint.svelte';
  import { Popover } from 'bits-ui';
  import { untrack } from 'svelte';
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import WorkspacePathInput from '$lib/components/primitives/WorkspacePathInput.svelte';
  import HelpPopover from './HelpPopover.svelte';
  import SegmentedSwitch from './SegmentedSwitch.svelte';
  import SessionPicker from './SessionPicker.svelte';
  import {
    buildScheduleTrigger,
    CRON_SCHEDULES_AVAILABLE,
    DEFAULT_INTERVAL_MINUTES,
    DEFAULT_SCHEDULE_TIME,
    isCronPreset,
    type IntervalInput,
    describeSchedule,
    parseScheduleLimits,
    type LimitInputValue,
    scheduleFrequencyError,
    summarizeScheduleLimits,
    type SchedulePreset
  } from '$lib/domain/schedule-form';
  import { describeError, type ErrorReport } from '$lib/domain/error-details';
  import { listTimeZones, loadScheduleTimeZone, saveScheduleTimeZone } from '$lib/domain/schedule-timezone';
  import type { CommandPalettePrefill } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { mergeWorkspaceSuggestions } from '$lib/domain/workspace-suggestions';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';

  let { portalTarget = null }: { portalTarget?: HTMLElement | null } = $props();

  const cronHelpLinks = [
    { label: 'crontab.guru', url: 'https://crontab.guru' },
    { label: 'tool.crontap.com', url: 'https://tool.crontap.com/' }
  ];

  const presetDisabled = (value: SchedulePreset) => isCronPreset(value) && !CRON_SCHEDULES_AVAILABLE;
  const presetOptions: Array<{ value: SchedulePreset; label: string; disabled: boolean }> = (
    [
      { value: 'minutes', label: 'Minutes' },
      { value: 'hourly', label: 'Hourly' },
      { value: 'daily', label: 'Daily' },
      { value: 'weekdays', label: 'Weekdays' },
      { value: 'custom', label: 'Custom' }
    ] as const
  ).map((option) => ({ ...option, disabled: presetDisabled(option.value) }));
  const whereOptions = [
    { value: 'new' as const, label: 'New session', icon: Plus },
    { value: 'existing' as const, label: 'Existing session', icon: Link }
  ];
  const timeZoneOptions = listTimeZones().map((zone) => ({ value: zone, label: zone }));

  let agentId = $state('');
  let prompt = $state('');
  let mode = $state<'new' | 'existing'>('new');
  let workspace = $state('');
  let sessionId = $state('');
  let preset = $state<SchedulePreset>('hourly');
  let time = $state(DEFAULT_SCHEDULE_TIME);
  let customCron = $state('');
  let minutes = $state<IntervalInput>(DEFAULT_INTERVAL_MINUTES);
  let timezone = $state(loadScheduleTimeZone());
  let limitsOpen = $state(false);
  let maxRuns = $state<LimitInputValue>('');
  let maxSteps = $state<LimitInputValue>('');
  let maxCost = $state<LimitInputValue>('');
  let submitting = $state(false);
  let formError = $state<ErrorReport | null>(null);
  let detailsCopied = $state(false);
  // A session created for a failed attempt that could not be deleted again; reused on retry.
  let leftover: { agentId: string; cwd: string; sessionId: string } | null = null;

  const agents = $derived(
    agentsStore.configs.filter((config) => {
      if (agentsStore.statuses[config.id]?.state !== 'running') return false;
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.schedules && caps.methods.includes('querymt/schedules/create'));
    })
  );

  const agentSessions = $derived.by(() => {
    const sessions = agentId ? agentsStore.sessionsByAgent[agentId] ?? [] : [];
    return sessions.slice().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  });

  const frequencyError = $derived(
    presetDisabled(preset) ? 'This schedule type is not available yet.' : scheduleFrequencyError(preset, time, customCron, minutes)
  );
  // An empty custom field is just unfinished; only show an error once something is typed.
  const visibleFrequencyError = $derived(preset === 'custom' && !customCron.trim() ? null : frequencyError);
  const frequencySummary = $derived(describeSchedule(preset, time, customCron, minutes));
  const parsedLimits = $derived(parseScheduleLimits({ maxRuns, maxSteps, maxCost }));
  const limitsInvalid = $derived(Object.keys(parsedLimits.errors).length > 0);
  const hasLimits = $derived(Object.keys(parsedLimits.limits).length > 0);
  // Shown next to the footer button only when there is something to say.
  const limitsSummary = $derived(limitsInvalid ? 'Check the values' : hasLimits ? summarizeScheduleLimits(parsedLimits.limits) : '');
  const targetReady = $derived(mode === 'new' ? Boolean(workspace.trim()) : Boolean(sessionId));
  const canSubmit = $derived(
    !submitting && Boolean(agentId) && Boolean(prompt.trim()) && !frequencyError && targetReady && !limitsInvalid
  );

  let wasOpen = false;
  $effect(() => {
    const isOpen = commandPaletteStore.scheduleOpen;
    if (isOpen && !wasOpen) untrack(() => hydrate(commandPaletteStore.schedulePrefill));
    wasOpen = isOpen;
  });

  function hydrate(prefill: CommandPalettePrefill | null) {
    agentId = prefill?.agentId && agents.some((agent) => agent.id === prefill.agentId) ? prefill.agentId : agents[0]?.id ?? '';
    prompt = prefill?.prompt ?? '';
    workspace = prefill?.cwd ?? agentsStore.composerCwd ?? '';
    sessionId = prefill?.sessionId ?? '';
    mode = prefill?.sessionId ? 'existing' : 'new';
    preset = 'hourly';
    time = DEFAULT_SCHEDULE_TIME;
    customCron = '';
    minutes = DEFAULT_INTERVAL_MINUTES;
    timezone = loadScheduleTimeZone();
    limitsOpen = false;
    maxRuns = '';
    maxSteps = '';
    maxCost = '';
    formError = null;
    submitting = false;
  }

  async function discardSession(forAgent: string, cwd: string, createdId: string) {
    try {
      await agentsStore.deleteSession(forAgent, createdId);
    } catch {
      leftover = { agentId: forAgent, cwd, sessionId: createdId };
    }
  }

  async function copyDetails() {
    if (!formError) return;
    try {
      await navigator.clipboard.writeText(formError.details);
      detailsCopied = true;
      setTimeout(() => (detailsCopied = false), 1800);
    } catch {
      detailsCopied = false;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const trigger = buildScheduleTrigger({ preset, time, customCron, minutes, timezone });
    if (!canSubmit || !trigger) return;

    submitting = true;
    formError = null;
    detailsCopied = false;
    const targetAgent = agentId;
    const cwd = workspace.trim();
    let createdId: string | null = null;
    let stage = 'create session';
    let request: Record<string, unknown> | null = null;

    try {
      let targetSession = sessionId;
      if (mode === 'new') {
        if (leftover && leftover.agentId === targetAgent && leftover.cwd === cwd) {
          targetSession = leftover.sessionId;
        } else {
          createdId = (await agentsStore.createBackgroundSession(targetAgent, cwd)).sessionId;
          targetSession = createdId;
        }
      }

      stage = 'create schedule';
      request = {
        session_id: targetSession,
        prompt: prompt.trim(),
        trigger,
        ...parsedLimits.limits
      };
      await agentsStore.createSchedule(targetAgent, request as unknown as Parameters<typeof agentsStore.createSchedule>[1]);
      leftover = null;
      commandPaletteStore.closeSchedule();
      await goto('/automations');
    } catch (error) {
      formError = describeError(error, 'Failed to create the automation.', {
        action: 'querymt/schedules/create',
        stage,
        agentId: targetAgent,
        target: mode === 'new' ? { mode, cwd, createdSessionId: createdId } : { mode, sessionId },
        request
      });
      console.error('[automations] failed to create automation', formError.details);
      // Do not leave a session behind that no automation points at.
      if (createdId) await discardSession(targetAgent, cwd, createdId);
    } finally {
      submitting = false;
    }
  }
</script>

<AppDialog
  bind:open={commandPaletteStore.scheduleOpen}
  title="New automation"
  description="Run a prompt on a schedule."
  size="workflow"
  contentClass="schedule-dialog"
  portalTarget={portalTarget ?? undefined}
  pending={submitting}
  closeLabel="Close automation dialog"
  onDismiss={() => commandPaletteStore.closeSchedule()}
>
  <form id="schedule-form" class="app-dialog-form schedule-form" onsubmit={submit}>
    <label class="app-dialog-field">
      <span class="app-dialog-field-label">Prompt</span>
      <textarea class="input-shell schedule-prompt" bind:value={prompt} placeholder="What should the agent do each time?" rows="3"></textarea>
    </label>

    <div class="app-dialog-field" role="group" aria-labelledby="schedule-runs-label">
      <div class="schedule-label-row">
        <span class="app-dialog-field-label" id="schedule-runs-label">Runs</span>
        {#if !CRON_SCHEDULES_AVAILABLE}
          <HelpPopover label="Why Daily, Weekdays and Custom are disabled">
            Daily, Weekdays and Custom need cron scheduling, which the agent does not support yet. Minutes and Hourly work today.
          </HelpPopover>
        {/if}
      </div>
      <div class="schedule-switch-row schedule-switch-row-split">
        <SegmentedSwitch ariaLabel="Run frequency" options={presetOptions} bind:value={preset} />
        <span class="schedule-timezone">
          <Globe size={13} aria-hidden="true" />
          <AppSelect
            bind:value={timezone}
            options={timeZoneOptions}
            pill
            class="schedule-timezone-trigger"
            contentClass="app-select-content-compact"
            ariaLabel="Time zone"
            onValueChange={saveScheduleTimeZone}
          />
        </span>
      </div>
      {#if preset === 'minutes'}
        <div class="schedule-interval">
          <span>Every</span>
          <input class="schedule-interval-input" type="number" min="1" step="1" inputmode="numeric" bind:value={minutes} aria-label="Minutes between runs" />
          <span>minutes</span>
        </div>
      {:else if preset === 'daily' || preset === 'weekdays'}
        <input class="input-shell schedule-time-input" type="time" bind:value={time} aria-label="Time of day" />
      {:else if preset === 'custom'}
        <div class="schedule-cron-row">
          <input class="input-shell schedule-cron-input" bind:value={customCron} placeholder="0 9 * * 1-5" aria-label="Cron expression" spellcheck="false" />
          <HelpPopover label="About cron expressions" links={cronHelpLinks}>
            A cron expression has five fields: minute, hour, day of month, month and weekday.
            For example, <code>0 9 * * 1-5</code> runs at 09:00 on weekdays. These tools help you write or check one:
          </HelpPopover>
        </div>
      {/if}
      {#if visibleFrequencyError}
        <span class="app-dialog-field-error" role="alert">{visibleFrequencyError}</span>
      {:else if frequencySummary}
        <span class="app-dialog-field-help" data-testid="schedule-summary">{frequencySummary}</span>
      {:else}
        <span class="app-dialog-field-help">Five fields: minute, hour, day, month, weekday.</span>
      {/if}
    </div>

    <div class="app-dialog-field" role="group" aria-labelledby="schedule-where-label">
      <span class="app-dialog-field-label" id="schedule-where-label">Where</span>
      <div class="schedule-switch-row">
        <SegmentedSwitch ariaLabel="Session target" options={whereOptions} bind:value={mode} />
      </div>
      {#if mode === 'new'}
        <WorkspacePathInput scrollIntoViewOnOpen value={workspace} recentPaths={mergeWorkspaceSuggestions(workspacesStore.items, agentsStore.getRecentWorkspaces())} onInput={(next) => (workspace = next)} />
        <span class="app-dialog-field-help">Creates a dedicated session in this workspace.</span>
      {:else}
        <SessionPicker sessions={agentSessions} bind:value={sessionId} />
        <span class="app-dialog-field-help">Every run continues this session.</span>
      {/if}
    </div>

    {#if agents.length > 1}
      <div class="app-dialog-field">
        <span class="app-dialog-field-label">Agent</span>
        <AppSelect
          bind:value={agentId}
          options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
          ariaLabel="Agent"
          onValueChange={() => (sessionId = '')}
        />
      </div>
    {/if}

    {#if formError}
      <div class="alert-error schedule-error" role="alert">
        <span class="schedule-error-summary">{formError.summary}</span>
        <button class="schedule-error-copy" type="button" onclick={copyDetails}>
          {#if detailsCopied}<Check size={13} />Copied{:else}<Copy size={13} />Copy details{/if}
        </button>
        <Hint as="button" class="schedule-error-dismiss" type="button" text="Dismiss" aria-label="Dismiss error" onclick={() => { formError = null; detailsCopied = false; }}>
          <X size={14} aria-hidden="true" />
        </Hint>
      </div>
    {/if}
  </form>

  {#snippet footer()}
    <Popover.Root bind:open={limitsOpen}>
      <Popover.Trigger class="schedule-limits-trigger" type="button" aria-label="Limits">
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>Limits</span>
        {#if limitsSummary}<span class="schedule-limits-value" class:schedule-limits-value-error={limitsInvalid}>{limitsSummary}</span>{/if}
      </Popover.Trigger>
      <Popover.Portal to={portalTarget ?? undefined}>
        <Popover.Content class="schedule-limits-panel" side="top" align="start" sideOffset={8} collisionPadding={12}>
      <div class="schedule-limits-fields">
        <div class="schedule-limit-row">
          <div class="schedule-limit-label">
            <label for="schedule-max-runs">Max runs</label>
            <HelpPopover label="About max runs">Stop the automation after it has run this many times. Leave empty to keep it running until you pause or delete it.</HelpPopover>
          </div>
          <input id="schedule-max-runs" class="input-shell schedule-limit-input" type="number" min="1" step="1" inputmode="numeric" bind:value={maxRuns} placeholder="Unlimited" />
          {#if parsedLimits.errors.maxRuns}<span class="app-dialog-field-error schedule-limit-error" role="alert">{parsedLimits.errors.maxRuns}</span>{/if}
        </div>
        <div class="schedule-limit-row">
          <div class="schedule-limit-label">
            <label for="schedule-max-steps">Max steps per run</label>
            <HelpPopover label="About max steps per run">A step is one model call. This caps how many steps a single run may take, so a run that loops cannot go on forever. Leave empty for no cap.</HelpPopover>
          </div>
          <input id="schedule-max-steps" class="input-shell schedule-limit-input" type="number" min="1" step="1" inputmode="numeric" bind:value={maxSteps} placeholder="Unlimited" />
          {#if parsedLimits.errors.maxSteps}<span class="app-dialog-field-error schedule-limit-error" role="alert">{parsedLimits.errors.maxSteps}</span>{/if}
        </div>
        <div class="schedule-limit-row">
          <div class="schedule-limit-label">
            <label for="schedule-max-cost">Max cost per run (USD)</label>
            <HelpPopover label="About max cost per run">The most a single run may cost, in US dollars. Leave empty for no cap.</HelpPopover>
          </div>
          <input id="schedule-max-cost" class="input-shell schedule-limit-input" type="number" min="0" step="any" inputmode="decimal" bind:value={maxCost} placeholder="Unlimited" />
          {#if parsedLimits.errors.maxCost}<span class="app-dialog-field-error schedule-limit-error" role="alert">{parsedLimits.errors.maxCost}</span>{/if}
        </div>
      </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <button class="action-btn" type="button" disabled={submitting} onclick={() => commandPaletteStore.closeSchedule()}>Cancel</button>
    <button class="action-btn action-btn-accent" form="schedule-form" type="submit" disabled={!canSubmit}>
      {#if submitting}<LoaderCircle size={15} class="animate-spin" />{/if}
      {submitting ? 'Creating...' : 'Create automation'}
    </button>
  {/snippet}
</AppDialog>
