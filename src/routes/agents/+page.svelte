<script lang="ts">
  import {
    Bot,
    CirclePlus,
    Info,
    Pencil,
    Play,
    RefreshCw,
    RotateCcw,
    Square,
    ToggleLeft,
    ToggleRight,
    Trash2,
    X
  } from '@lucide/svelte';
  import { getContext, onMount } from 'svelte';
  import { Portal } from 'bits-ui';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import SidecarLogList from '$lib/components/primitives/SidecarLogList.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import type { AgentConfig } from '$lib/domain/types';

  type AgentDialogMode = 'add' | 'edit' | null;

  let agentDialogMode = $state<AgentDialogMode>(null);
  let selectedAgentId = $state<string | null>(null);
  let pendingDeleteAgentId = $state<string | null>(null);
  let draftName = $state('');
  let draftCommandLine = $state('');

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const agentCards = $derived.by(() =>
    agentsStore.configs.map((config) => ({
      config,
      status: agentsStore.statuses[config.id],
      sessions: agentsStore.sessionsByAgent[config.id] ?? [],
      logs: agentsStore.logsByAgent[config.id] ?? [],
      connectionState: agentsStore.connectionStates[config.id] ?? 'idle',
      controlCapabilities: agentsStore.controlCapabilitiesByAgent[config.id] ?? null,
      controlHealth: agentsStore.controlHealthByAgent[config.id] ?? {
        state: 'unknown',
        summary: 'Capabilities not checked yet.',
        missingMethods: [],
        missingFeatures: []
      },
      error: agentsStore.agentErrors[config.id] ?? agentsStore.statuses[config.id]?.lastError ?? null
    }))
  );

  const selectedCard = $derived.by(() =>
    selectedAgentId ? agentCards.find((card) => card.config.id === selectedAgentId) ?? null : null
  );

  function statusClass(state?: string | null, connectionState?: string | null, controlState?: string | null) {
    if (state === 'failed' || connectionState === 'failed' || controlState === 'failed' || controlState === 'degraded') {
      return 'status-dot-degraded';
    }
    if (state === 'running' && connectionState !== 'failed' && controlState !== 'failed') return 'status-dot-running';
    if (state === 'starting' || state === 'stopping') return 'status-dot-starting';
    return 'status-dot-stopped';
  }

  function statusLabel(config: AgentConfig) {
    const status = agentsStore.statuses[config.id];
    if (status?.state) return status.state;
    return agentsStore.connectionStates[config.id] ?? 'idle';
  }

  function openAddDialog() {
    agentDialogMode = 'add';
    draftName = '';
    draftCommandLine = '';
  }

  function openEditDialog(card: (typeof agentCards)[number]) {
    agentDialogMode = 'edit';
    selectedAgentId = card.config.id;
    draftName = card.config.name;
    draftCommandLine = card.config.commandLine;
  }

  function closeAgentDialog() {
    agentDialogMode = null;
    draftName = '';
    draftCommandLine = '';
  }

  function openDetails(agentId: string) {
    selectedAgentId = agentId;
  }

  function closeDetails() {
    selectedAgentId = null;
  }

  function closeTopmostOverlay() {
    if (agentDialogMode) {
      closeAgentDialog();
      return true;
    }

    if (pendingDeleteAgentId) {
      pendingDeleteAgentId = null;
      return true;
    }

    if (selectedAgentId) {
      closeDetails();
      return true;
    }

    return false;
  }

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (closeTopmostOverlay()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeydown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeydown, { capture: true });
  });

  async function saveAgentDialog() {
    const name = draftName.trim();
    const commandLine = draftCommandLine.trim();
    if (!name || !commandLine) return;

    if (agentDialogMode === 'add') {
      const config = agentsStore.createConfig(name, commandLine);
      agentsStore.saveConfig(config);
      closeAgentDialog();
      await agentsStore.refreshAgent(config);
      if (config.autoStart) {
        await agentsStore.startConfiguredAgent(config.id);
      }
      return;
    }

    if (agentDialogMode === 'edit' && selectedCard) {
      agentsStore.updateConfig(selectedCard.config.id, { name, commandLine });
      closeAgentDialog();
      await agentsStore.refreshAgent(selectedCard.config);
    }
  }

  async function confirmDeleteAgent() {
    if (!pendingDeleteAgentId) return;
    const deletingSelected = pendingDeleteAgentId === selectedAgentId;
    await agentsStore.deleteConfig(pendingDeleteAgentId);
    if (deletingSelected) {
      selectedAgentId = null;
    }
    pendingDeleteAgentId = null;
  }
</script>

<div class="space-y-4 page-width-wide">
  <div class="page-toolbar">
    <SectionHeader
      eyebrow="Configured ACP commands"
      title="Agents"
      description="A simple list of configured agents with quick lifecycle controls. Open details only when you need capabilities, sessions, or logs."
    />

    <div class="compact-toolbar">
      <IconTooltipButton label="Refresh agents" icon={RefreshCw} size={16} onclick={() => agentsStore.initialize()} />
      <IconTooltipButton label="Add agent" icon={CirclePlus} tone="primary" size={16} onclick={() => openAddDialog()} />
    </div>
  </div>

  <section>
    {#if agentCards.length === 0}
      <div class="empty-state">
        <div class="flex items-start gap-3">
          <span class="icon-swatch"><Bot size={16} /></span>
          <div>
            <div class="text-sm font-medium">No agents configured</div>
            <div class="panel-copy mt-1">Add a command line with the + button and it will appear here as a manageable ACP agent.</div>
          </div>
        </div>
      </div>
    {:else}
      <div class="agent-list">
        {#each agentCards as card}
          <article class="agent-list-row">
            <div class="agent-list-row-inner flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0 flex flex-1 items-center gap-3">
                <span class={`status-dot ${statusClass(card.status?.state, card.connectionState, card.controlHealth.state)}`}></span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="truncate text-sm font-medium">{card.config.name}</div>
                    <span class="badge">{statusLabel(card.config)}</span>
                    {#if card.config.autoStart}
                      <span class="badge">auto-start</span>
                    {/if}
                  </div>
                  <div class="mt-1 truncate text-xs text-[var(--muted)]">{card.config.commandLine}</div>
                </div>
              </div>

              <div class="compact-toolbar">
                <IconTooltipButton label="Details" icon={Info} onclick={() => openDetails(card.config.id)} />
                <IconTooltipButton label="Edit" icon={Pencil} onclick={() => openEditDialog(card)} />
                {#if card.status?.state === 'running' || card.status?.state === 'starting' || card.status?.state === 'stopping'}
                  <IconTooltipButton label="Stop" icon={Square} onclick={() => agentsStore.stopConfiguredAgent(card.config.id)} />
                  <IconTooltipButton label="Restart" icon={RotateCcw} onclick={() => agentsStore.restartConfiguredAgent(card.config.id)} />
                {:else}
                  <IconTooltipButton label="Start" icon={Play} onclick={() => agentsStore.startConfiguredAgent(card.config.id)} />
                {/if}
                <IconTooltipButton
                  label={card.config.autoStart ? 'Disable auto-start' : 'Enable auto-start'}
                  icon={card.config.autoStart ? ToggleRight : ToggleLeft}
                  onclick={() => agentsStore.updateConfig(card.config.id, { autoStart: !card.config.autoStart })}
                />
                <IconTooltipButton label="Delete" icon={Trash2} tone="danger" onclick={() => (pendingDeleteAgentId = card.config.id)} />
              </div>
            </div>

            {#if card.error}
              <div class="agent-list-error alert-error">
                {card.error}
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if agentDialogMode}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close agent dialog" onclick={() => closeAgentDialog()}></button>
        <div class="panel relative z-10 w-full max-w-3xl p-5 space-y-4" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-lg font-semibold">{agentDialogMode === 'add' ? 'Add agent' : 'Edit agent'}</div>
              <div class="text-sm text-[var(--muted)]">Set the display name and ACP command line.</div>
            </div>
            <IconTooltipButton label="Close agent dialog" icon={X} onclick={() => closeAgentDialog()} />
          </div>

          <div class="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
            <label class="block space-y-2">
              <span class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Agent name</span>
              <input class="input-shell w-full" placeholder="Agent name" bind:value={draftName} />
            </label>
            <label class="block space-y-2">
              <span class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Command line</span>
              <input class="input-shell w-full" placeholder="/path/to/executable --acp" bind:value={draftCommandLine} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false} inputmode="text" />
            </label>
          </div>

          <div class="compact-toolbar justify-end">
            <button class="action-btn" type="button" onclick={() => closeAgentDialog()}>Cancel</button>
            <button class="action-btn action-btn-primary" type="button" onclick={() => saveAgentDialog()} disabled={!draftName.trim() || !draftCommandLine.trim()}>
              {agentDialogMode === 'add' ? 'Add agent' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  {/if}

  {#if pendingDeleteAgentId}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close delete confirmation" onclick={() => (pendingDeleteAgentId = null)}></button>
        <div class="panel relative z-10 w-full max-w-md p-5 space-y-4" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
          <div>
            <div class="text-lg font-semibold">Delete agent</div>
            <div class="text-sm text-[var(--muted)]">Remove this configured agent from the desktop app?</div>
          </div>
          <div class="compact-toolbar justify-end">
            <button class="action-btn" type="button" onclick={() => (pendingDeleteAgentId = null)}>Cancel</button>
            <button class="action-btn action-btn-danger" type="button" onclick={() => confirmDeleteAgent()}>Delete</button>
          </div>
        </div>
      </div>
    </Portal>
  {/if}

  {#if selectedCard}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-40 flex justify-end">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close details" onclick={() => closeDetails()}></button>
        <div class="agent-details-panel relative z-10 h-full w-full max-w-2xl overflow-auto border-l border-[var(--border)] bg-[var(--bg-panel-strong)] p-5 shadow-2xl" role="dialog" aria-modal="true" tabindex="-1" data-blocking-overlay="true">
        <div class="flex items-start justify-between gap-3">
          <div>
              <div class="flex items-center gap-3">
                <span class={`status-dot ${statusClass(selectedCard.status?.state, selectedCard.connectionState, selectedCard.controlHealth.state)}`}></span>

              <div class="text-lg font-semibold">{selectedCard.config.name}</div>
            </div>
            <div class="mt-1 text-sm text-[var(--muted)]">{selectedCard.config.commandLine}</div>
          </div>
          <IconTooltipButton label="Close details" icon={X} onclick={() => closeDetails()} />
        </div>

        <div class="mt-5 space-y-4">
          <section class="surface-muted p-4 space-y-2">
            <div class="text-sm font-medium">Runtime</div>
            <div class="text-sm text-[var(--muted)]">State: {selectedCard.status?.state ?? selectedCard.connectionState}</div>
            {#if selectedCard.status?.pid != null}<div class="text-sm text-[var(--muted)]">PID: {selectedCard.status.pid}</div>{/if}
            {#if selectedCard.status?.version}<div class="text-sm text-[var(--muted)]">Version: {selectedCard.status.version}</div>{/if}
            {#if selectedCard.status?.message}<div class="text-sm text-[var(--muted)]">{selectedCard.status.message}</div>{/if}
          </section>

          <section class="surface-muted p-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-medium">Control health</div>
              <IconTooltipButton
                label="Refresh capabilities"
                icon={RefreshCw}
                onclick={() => agentsStore.refreshCapabilities(selectedCard.config.id)}
              />
            </div>
            <div class="text-sm text-[var(--muted)]">{selectedCard.controlHealth.summary}</div>
            <div class="flex flex-wrap gap-2 text-xs">
              <span class="badge">{selectedCard.controlHealth.state}</span>
              <span class="badge">{selectedCard.connectionState}</span>
              {#if selectedCard.controlCapabilities}
                <span class="badge">api v{selectedCard.controlCapabilities.querymt_control_version}</span>
                <span class="badge">{selectedCard.controlCapabilities.agent.kind}</span>
              {/if}
            </div>
            {#if selectedCard.controlHealth.missingMethods.length > 0}
              <div class="text-sm text-[var(--muted)]">Missing methods: {selectedCard.controlHealth.missingMethods.join(', ')}</div>
            {/if}
            {#if selectedCard.controlHealth.missingFeatures.length > 0}
              <div class="text-sm text-[var(--muted)]">Missing features: {selectedCard.controlHealth.missingFeatures.join(', ')}</div>
            {/if}
          </section>

          <section class="surface-muted p-4 space-y-2">
            <div class="text-sm font-medium">Capabilities</div>
            {#if selectedCard.controlCapabilities}
              <div class="flex flex-wrap gap-2 text-xs">
                {#if selectedCard.controlCapabilities.agent.display_name}<span class="badge">{selectedCard.controlCapabilities.agent.display_name}</span>{/if}
                {#if selectedCard.controlCapabilities.agent.version}<span class="badge">{selectedCard.controlCapabilities.agent.version}</span>{/if}
                {#if selectedCard.controlCapabilities.transport.mesh}<span class="badge">mesh</span>{/if}
                {#if selectedCard.controlCapabilities.transport.websocket}<span class="badge">websocket</span>{/if}
                {#if selectedCard.controlCapabilities.features.models}<span class="badge">models</span>{/if}
                {#if selectedCard.controlCapabilities.features.schedules}<span class="badge">schedules</span>{/if}
                {#if selectedCard.controlCapabilities.features.remote_sessions}<span class="badge">remote sessions</span>{/if}
                {#if selectedCard.controlCapabilities.features.mesh_invites}<span class="badge">mesh invites</span>{/if}
                {#if selectedCard.controlCapabilities.features.auth}<span class="badge">auth</span>{/if}
              </div>
            {:else}
              <div class="text-sm text-[var(--muted)]">No capabilities loaded yet.</div>
            {/if}
          </section>

          <section class="surface-muted p-4 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm font-medium">Sessions</div>
              <span class="badge">{selectedCard.sessions.length}</span>
            </div>
            {#if selectedCard.sessions.length === 0}
              <div class="text-sm text-[var(--muted)]">No sessions loaded for this agent.</div>
            {:else}
              <div class="space-y-2">
                {#each selectedCard.sessions as session}
                  <div class="surface-muted px-3 py-2">
                    <div class="text-sm font-medium">{session.title}</div>
                    <div class="mt-1 text-xs text-[var(--muted)]">{session.sessionId}</div>
                    {#if session.cwd}<div class="mt-1 text-xs text-[var(--muted)]">{session.cwd}</div>{/if}
                  </div>
                {/each}
              </div>
            {/if}
          </section>

          <section class="space-y-3">
            <div class="text-sm font-medium">Logs</div>
            <SidecarLogList logs={selectedCard.logs} title={`${selectedCard.config.name} logs`} emptyMessage="No logs yet for this agent." />
          </section>
        </div>
        </div>
      </div>
    </Portal>
  {/if}
</div>
