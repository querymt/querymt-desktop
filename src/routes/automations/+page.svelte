<script lang="ts">
  import { Pause, Play, RefreshCw, Trash2, Zap } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';

  const scheduleAgents = $derived.by(() =>
    agentsStore.configs.filter((config) => {
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.schedules && caps.methods.includes('querymt/schedules/list'));
    })
  );

  let selectedAgentId = $state<string>('');
  let loading = $state(false);
  let actionError = $state<string | null>(null);

  $effect(() => {
    if (!selectedAgentId && scheduleAgents.length > 0) {
      selectedAgentId = scheduleAgents[0].id;
    }
    if (selectedAgentId && !scheduleAgents.some((agent) => agent.id === selectedAgentId)) {
      selectedAgentId = scheduleAgents[0]?.id ?? '';
    }
  });

  const selectedAgent = $derived.by(
    () => scheduleAgents.find((agent) => agent.id === selectedAgentId) ?? null
  );
  const selectedCapabilities = $derived.by(
    () => (selectedAgentId ? agentsStore.controlCapabilitiesByAgent[selectedAgentId] ?? null : null)
  );
  const selectedSchedules = $derived.by(
    () => (selectedAgentId ? agentsStore.schedulesByAgent[selectedAgentId]?.schedules ?? [] : [])
  );
  const lastAction = $derived.by(
    () => (selectedAgentId ? agentsStore.lastScheduleActionByAgent[selectedAgentId] ?? null : null)
  );

  function canRun(method: string) {
    return selectedCapabilities?.methods.includes(method) ?? false;
  }

  async function refreshSchedules() {
    if (!selectedAgentId) {
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.refreshSchedulesForAgent(selectedAgentId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to load schedules.';
    } finally {
      loading = false;
    }
  }

  async function runAction(action: 'pause' | 'resume' | 'trigger' | 'delete', schedulePublicId: string, nodeId?: string) {
    if (!selectedAgentId) {
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.runScheduleAction(selectedAgentId, action, schedulePublicId, nodeId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : `Failed to ${action} schedule.`;
    } finally {
      loading = false;
    }
  }
</script>

<div class="space-y-4 page-width-wide">
  <div class="page-toolbar">
    <SectionHeader
      eyebrow="Scheduled control"
      title="Automations"
      description="Overview existing automated tasks, inspect health, and pause or remove tasks quickly. Use Cmd+P for creation flows."
    />

    <div class="compact-toolbar">
      <button class="icon-btn" type="button" aria-label="Refresh schedules" disabled={!selectedAgentId || loading} onclick={() => refreshSchedules()}>
        <RefreshCw size={16} />
      </button>
    </div>
  </div>

  {#if scheduleAgents.length === 0}
    <div class="panel empty-state p-6 text-sm text-[var(--muted)]">
      No connected agents currently advertise `querymt/schedules/list`.
    </div>
  {:else}
    <section class="panel p-4 space-y-4">
      <div class="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-end">
        <label class="space-y-2">
          <span class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Agent</span>
          <AppSelect bind:value={selectedAgentId} options={scheduleAgents.map((agent) => ({ value: agent.id, label: agent.name }))} ariaLabel="Agent" />
        </label>

        <div class="flex flex-wrap gap-2 text-xs">
          {#if selectedCapabilities}
            <span class="badge">api v{selectedCapabilities.querymt_control_version}</span>
            <span class="badge">{selectedCapabilities.agent.kind}</span>
            {#if selectedCapabilities.features.schedules}<span class="badge">schedules</span>{/if}
            {#if selectedCapabilities.features.remote_schedules}<span class="badge">remote schedules</span>{/if}
          {/if}
        </div>
      </div>

      {#if selectedAgent}
        <div class="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
          <span class="badge">{agentsStore.controlHealthByAgent[selectedAgent.id]?.summary ?? 'No control summary yet.'}</span>
          {#if lastAction}
            <span class="badge">last action: {lastAction.action} {lastAction.success ? 'ok' : 'failed'}</span>
          {/if}
          <span>Use <span class="kbd !px-2 !py-0.5">Cmd+P</span> to create a scheduled task.</span>
        </div>
      {/if}

      {#if actionError}
        <div class="alert-error">
          {actionError}
        </div>
      {/if}

      {#if selectedSchedules.length === 0}
        <div class="empty-state">
          <div class="text-sm font-medium">No schedules loaded yet</div>
          <div class="panel-copy mt-1">Refresh to inspect the selected agent’s automation queue.</div>
        </div>
      {:else}
        <div class="space-y-3">
          {#each selectedSchedules as schedule}
            <article class="surface-muted p-4 space-y-3">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div class="text-sm font-medium">{schedule.public_id}</div>
                  <div class="mt-1 text-xs text-[var(--muted)]">
                    session {schedule.session_public_id} • task {schedule.task_public_id}
                  </div>
                </div>

                <div class="compact-toolbar">
                  <span class="badge">{schedule.state}</span>
                  {#if schedule.node_id}<span class="badge">{schedule.node_id}</span>{/if}
                  <button
                    class="icon-btn"
                    type="button"
                    aria-label={`Pause ${schedule.public_id}`}
                    disabled={!canRun('querymt/schedules/pause') || loading}
                    onclick={() => runAction('pause', schedule.public_id, schedule.node_id)}
                  >
                    <Pause size={15} />
                  </button>
                  <button
                    class="icon-btn"
                    type="button"
                    aria-label={`Resume ${schedule.public_id}`}
                    disabled={!canRun('querymt/schedules/resume') || loading}
                    onclick={() => runAction('resume', schedule.public_id, schedule.node_id)}
                  >
                    <Play size={15} />
                  </button>
                  <button
                    class="icon-btn"
                    type="button"
                    aria-label={`Trigger ${schedule.public_id}`}
                    disabled={!canRun('querymt/schedules/trigger') || loading}
                    onclick={() => runAction('trigger', schedule.public_id, schedule.node_id)}
                  >
                    <Zap size={15} />
                  </button>
                  <button
                    class="icon-btn"
                    type="button"
                    aria-label={`Delete ${schedule.public_id}`}
                    disabled={!canRun('querymt/schedules/delete') || loading}
                    onclick={() => runAction('delete', schedule.public_id, schedule.node_id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div class="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                <span>runs {schedule.run_count}</span>
                <span>• failures {schedule.consecutive_failures}</span>
                <span>• max runtime {schedule.max_runtime_seconds}s</span>
                {#if schedule.max_runs}<span>• max runs {schedule.max_runs}</span>{/if}
                {#if schedule.next_run_at}<span>• next {schedule.next_run_at}</span>{/if}
                {#if schedule.last_run_at}<span>• last {schedule.last_run_at}</span>{/if}
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>
