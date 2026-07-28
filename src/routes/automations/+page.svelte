<script lang="ts">
  import { CalendarClock, LoaderCircle, Plus, RefreshCw } from '@lucide/svelte';
  import AutomationDeleteDialog from '$lib/components/automations/AutomationDeleteDialog.svelte';
  import AutomationGroup from '$lib/components/automations/AutomationGroup.svelte';
  import AutomationSummary from '$lib/components/automations/AutomationSummary.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import { classifySchedule, groupSchedules } from '$lib/domain/automations';
  import type { ScheduleInfo } from '$lib/querymt/generated/types';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';

  const scheduleAgents = $derived.by(() =>
    agentsStore.configs.filter((config) => {
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.schedules && caps.methods.includes('querymt/schedules/list'));
    })
  );

  let selectedAgentId = $state('');
  let refreshing = $state(false);
  let refreshAttempted = $state(false);
  let actionError = $state<string | null>(null);
  let pendingAction = $state<{ scheduleId: string; action: 'pause' | 'resume' | 'trigger' | 'delete' } | null>(null);
  let scheduleErrors = $state<Record<string, string | undefined>>({});
  let pendingDelete = $state<ScheduleInfo | null>(null);
  let deleteDialogOpen = $state(false);

  $effect(() => {
    if (!selectedAgentId && scheduleAgents.length > 0) selectedAgentId = scheduleAgents[0].id;
    if (selectedAgentId && !scheduleAgents.some((agent) => agent.id === selectedAgentId)) {
      selectedAgentId = scheduleAgents[0]?.id ?? '';
    }
  });

  const selectedCapabilities = $derived.by(() => selectedAgentId ? agentsStore.controlCapabilitiesByAgent[selectedAgentId] ?? null : null);
  const selectedSchedules = $derived.by(() => selectedAgentId ? agentsStore.schedulesByAgent[selectedAgentId]?.schedules ?? [] : []);
  const scheduleDataLoaded = $derived(Boolean(selectedAgentId && agentsStore.schedulesByAgent[selectedAgentId]));
  const scheduleGroups = $derived(groupSchedules(selectedSchedules));
  const activeCount = $derived(selectedSchedules.filter((schedule) => classifySchedule(schedule) === 'active').length);
  const pausedCount = $derived(selectedSchedules.filter((schedule) => classifySchedule(schedule) === 'paused').length);
  const attentionCount = $derived(selectedSchedules.filter((schedule) => classifySchedule(schedule) === 'attention').length);
  const selectedHealth = $derived.by(() => selectedAgentId ? agentsStore.controlHealthByAgent[selectedAgentId] ?? null : null);
  const healthWarning = $derived(selectedHealth && selectedHealth.state !== 'ready' ? selectedHealth.summary : null);

  function canRun(method: string) {
    return selectedCapabilities?.methods.includes(method) ?? false;
  }

  function openScheduleCreate() {
    commandPaletteStore.openSchedule({
      agentId: selectedAgentId || null,
      sessionId: null,
      cwd: null,
      prompt: null,
      nodeId: null
    });
  }

  async function refreshSchedules() {
    if (!selectedAgentId) return;
    refreshing = true;
    refreshAttempted = true;
    actionError = null;
    try {
      await agentsStore.refreshSchedulesForAgent(selectedAgentId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to load automations.';
    } finally {
      refreshing = false;
    }
  }

  async function runAction(action: 'pause' | 'resume' | 'trigger', schedule: ScheduleInfo) {
    if (!selectedAgentId) return;
    pendingAction = { scheduleId: schedule.public_id, action };
    scheduleErrors = { ...scheduleErrors, [schedule.public_id]: undefined };
    try {
      await agentsStore.runScheduleAction(selectedAgentId, action, schedule.public_id, schedule.node_id);
    } catch (error) {
      scheduleErrors = {
        ...scheduleErrors,
        [schedule.public_id]: error instanceof Error ? error.message : `Failed to ${action} automation.`
      };
    } finally {
      pendingAction = null;
    }
  }

  function requestDelete(schedule: ScheduleInfo) {
    pendingDelete = schedule;
    scheduleErrors = { ...scheduleErrors, [schedule.public_id]: undefined };
    deleteDialogOpen = true;
  }

  async function confirmDelete(schedule: ScheduleInfo) {
    if (!selectedAgentId) return;
    pendingAction = { scheduleId: schedule.public_id, action: 'delete' };
    scheduleErrors = { ...scheduleErrors, [schedule.public_id]: undefined };
    try {
      await agentsStore.runScheduleAction(selectedAgentId, 'delete', schedule.public_id, schedule.node_id);
      deleteDialogOpen = false;
      pendingDelete = null;
    } catch (error) {
      scheduleErrors = {
        ...scheduleErrors,
        [schedule.public_id]: error instanceof Error ? error.message : 'Failed to delete automation.'
      };
    } finally {
      pendingAction = null;
    }
  }
</script>

<div class="settings-page automations-page">
  <div class="page-toolbar automations-page-toolbar">
    <SectionHeader title="Automations" description="Scheduled tasks, run status, and controls." />
    <div class="automations-page-actions">
      {#if scheduleAgents.length > 1}
        <AppSelect bind:value={selectedAgentId} options={scheduleAgents.map((agent) => ({ value: agent.id, label: agent.name }))} pill ariaLabel="Automation agent" />
      {/if}
      <IconTooltipButton
        label={refreshing ? 'Refreshing automations' : 'Refresh automations'}
        icon={refreshing ? LoaderCircle : RefreshCw}
        iconClass={refreshing ? 'animate-spin' : ''}
        size={16}
        disabled={!selectedAgentId || refreshing}
        onclick={refreshSchedules}
      />
      <IconTooltipButton label="Create automation" icon={Plus} tone="primary" size={16} disabled={!selectedAgentId || !canRun('querymt/schedules/create')} onclick={openScheduleCreate} />
    </div>
  </div>

  <div class="settings-unified-panel">
    {#if scheduleAgents.length === 0}
      <section class="settings-section" aria-label="Automation availability">
        <div class="state-panel">
          <span class="state-panel-icon"><CalendarClock size={17} /></span>
          <div class="state-panel-copy">
            <strong>Automations are not available</strong>
            <p>Connect an agent that supports scheduled tasks to create and manage automations.</p>
          </div>
        </div>
      </section>
    {:else if refreshing && !scheduleDataLoaded}
      <section class="settings-section" aria-label="Loading automations" aria-busy="true">
        <div class="state-skeleton-list">
          {#each Array(3) as _}
            <div class="state-skeleton-row"><span class="state-skeleton-copy"><i></i><i></i></span><span class="state-skeleton-actions"></span></div>
          {/each}
        </div>
      </section>
    {:else if actionError && !scheduleDataLoaded}
      <section class="settings-section">
        <div class="state-panel state-panel-error" role="alert">
          <span class="state-panel-icon"><CalendarClock size={17} /></span>
          <div class="state-panel-copy"><strong>Automations could not be loaded</strong><p>{actionError}</p></div>
          <button class="action-btn" type="button" onclick={refreshSchedules}>Try again</button>
        </div>
      </section>
    {:else}
      <AutomationSummary total={selectedSchedules.length} active={activeCount} paused={pausedCount} attention={attentionCount} healthMessage={healthWarning} />

      {#if actionError}<div class="state-inline-error" role="alert"><span class="min-w-0 flex-1">{actionError}</span><button class="action-btn !px-3 !py-1.5 text-xs" type="button" onclick={refreshSchedules}>Retry</button></div>{/if}

      {#if selectedSchedules.length === 0}
        <section class="settings-section" aria-label="Automations">
          <div class="state-panel">
            <span class="state-panel-icon"><CalendarClock size={17} /></span>
            <div class="state-panel-copy">
              <strong>{refreshAttempted || scheduleDataLoaded ? 'No automations yet' : 'No automations loaded yet'}</strong>
              <p>Schedule prompts to run against new or existing sessions.</p>
            </div>
            <button class="action-btn action-btn-primary" type="button" onclick={openScheduleCreate}><Plus size={15} />Create automation</button>
          </div>
        </section>
      {:else}
        {#each scheduleGroups as group (group.id)}
          <AutomationGroup
            {group}
            {pendingAction}
            errors={scheduleErrors}
            canPause={canRun('querymt/schedules/pause')}
            canResume={canRun('querymt/schedules/resume')}
            canTrigger={canRun('querymt/schedules/trigger')}
            canDelete={canRun('querymt/schedules/delete')}
            onAction={runAction}
            onDelete={requestDelete}
          />
        {/each}
      {/if}
    {/if}
  </div>
</div>

<AutomationDeleteDialog
  bind:open={deleteDialogOpen}
  schedule={pendingDelete}
  pending={pendingAction?.action === 'delete'}
  error={pendingDelete ? scheduleErrors[pendingDelete.public_id] ?? null : null}
  onConfirm={confirmDelete}
/>
