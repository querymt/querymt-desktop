<script lang="ts">
  import { Pause, Play, Plus, RefreshCw, Trash2, Zap } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';

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

  function selectedCapabilitySummary() {
    if (!selectedCapabilities) return loading ? 'Refreshing schedule capabilities' : 'No capabilities reported yet';

    const details = [`API v${selectedCapabilities.querymt_control_version}`, selectedCapabilities.agent.kind];
    if (selectedCapabilities.features.schedules) details.push('Schedules');
    if (selectedCapabilities.features.remote_schedules) details.push('Remote schedules');
    return details.join(' · ');
  }

  function selectedHealthSummary() {
    if (!selectedAgent) return 'No agent selected';
    return agentsStore.controlHealthByAgent[selectedAgent.id]?.summary ?? 'No control summary yet';
  }

  function lastActionSummary() {
    if (!lastAction) return 'No schedule actions yet';
    return `${lastAction.action} ${lastAction.success ? 'ok' : 'failed'}`;
  }

  function scheduleMeta(schedule: (typeof selectedSchedules)[number]) {
    const details = [schedule.state, `runs ${schedule.run_count}`, `failures ${schedule.consecutive_failures}`, `max runtime ${schedule.max_runtime_seconds}s`];
    if (schedule.max_runs) details.push(`max runs ${schedule.max_runs}`);
    if (schedule.next_run_at) details.push(`next ${schedule.next_run_at}`);
    if (schedule.last_run_at) details.push(`last ${schedule.last_run_at}`);
    return details.join(' · ');
  }

  function openScheduleCreate() {
    commandPaletteStore.openSchedule({
      agentId: selectedAgentId || null,
      sessionId: agentsStore.activeSessionId,
      cwd: agentsStore.composerCwd || null,
      prompt: agentsStore.composerPrompt,
      nodeId: null
    });
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

<div class="settings-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Automations"
      description="Manage scheduled tasks and automation health."
    />
  </div>

  <div class="settings-unified-panel">
    {#if scheduleAgents.length === 0}
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2>Agent</h2>
            <p>No connected agents currently advertise `querymt/schedules/list`.</p>
          </div>
        </div>
      </section>
    {:else}
      <section class="settings-section">
        <div class="settings-section-header settings-section-header-action">
          <div>
            <h2>Agent</h2>
            <p>Choose the agent that provides schedule controls.</p>
          </div>
          <IconTooltipButton label="Refresh schedules" icon={RefreshCw} size={16} disabled={!selectedAgentId || loading} onclick={() => refreshSchedules()} />
        </div>

        <div class="settings-preference-list">
          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Active agent</div>
              <div class="settings-preference-description">{selectedCapabilitySummary()}</div>
            </div>
            <AppSelect bind:value={selectedAgentId} options={scheduleAgents.map((agent) => ({ value: agent.id, label: agent.name }))} pill ariaLabel="Agent" />
          </div>

          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Health</div>
              <div class="settings-preference-description">{selectedHealthSummary()}</div>
            </div>
          </div>

          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Last action</div>
              <div class="settings-preference-description">{lastActionSummary()}</div>
            </div>
          </div>
        </div>
      </section>

      {#if actionError}
        <div class="alert-error settings-section-message">
          {actionError}
        </div>
      {/if}

      <section class="settings-section">
        <div class="settings-section-header settings-section-header-action">
          <div>
            <h2>Schedules</h2>
            <p>Review active automations and run quick actions.</p>
          </div>
          <button class="action-btn action-btn-primary" type="button" onclick={() => openScheduleCreate()}>
            <Plus size={15} />
            Create
          </button>
        </div>

        {#if selectedSchedules.length === 0}
          <div class="empty-state">
            <div class="text-sm font-medium">No schedules loaded yet</div>
            <div class="panel-copy mt-1">Refresh to inspect the selected agent's automation queue.</div>
          </div>
        {:else}
          <div class="mesh-item-list">
            {#each selectedSchedules as schedule}
              <article class="mesh-item-row">
                <div class="mesh-item-main">
                  <div class="mesh-item-title">{schedule.public_id}</div>
                  <div class="mesh-item-description">session {schedule.session_public_id} · task {schedule.task_public_id}{schedule.node_id ? ` · node ${schedule.node_id}` : ''}</div>
                  <div class="mesh-item-meta">{scheduleMeta(schedule)}</div>
                </div>

                <div class="mesh-item-actions">
                  <IconTooltipButton
                    label="Pause"
                    icon={Pause}
                    disabled={!canRun('querymt/schedules/pause') || loading}
                    onclick={() => runAction('pause', schedule.public_id, schedule.node_id)}
                  />
                  <IconTooltipButton
                    label="Resume"
                    icon={Play}
                    disabled={!canRun('querymt/schedules/resume') || loading}
                    onclick={() => runAction('resume', schedule.public_id, schedule.node_id)}
                  />
                  <IconTooltipButton
                    label="Trigger"
                    icon={Zap}
                    disabled={!canRun('querymt/schedules/trigger') || loading}
                    onclick={() => runAction('trigger', schedule.public_id, schedule.node_id)}
                  />
                  <IconTooltipButton
                    label="Delete"
                    icon={Trash2}
                    tone="danger"
                    disabled={!canRun('querymt/schedules/delete') || loading}
                    onclick={() => runAction('delete', schedule.public_id, schedule.node_id)}
                  />
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>
