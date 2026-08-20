<script lang="ts">
  import {
    AlertTriangle,
    Bot,
    CirclePlus,
    Info,
    Pencil,
    LoaderCircle,
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
  import AppConfirmDialog from '$lib/components/primitives/AppConfirmDialog.svelte';
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import SidecarLogList from '$lib/components/primitives/SidecarLogList.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import type { AgentConfig } from '$lib/domain/types';

  type AgentDialogMode = 'add' | 'edit' | null;
  type AgentMessageTone = 'error' | 'warning';

  interface AgentMessage {
    label: string;
    detail: string;
    tone: AgentMessageTone;
  }

  let agentDialogMode = $state<AgentDialogMode>(null);
  let selectedAgentId = $state<string | null>(null);
  let editingAgentId = $state<string | null>(null);
  let pendingDeleteAgentId = $state<string | null>(null);
  let logViewerOpen = $state(false);
  let draftName = $state('');
  let draftTransport = $state<AgentConfig['transport']>('stdio');
  let draftCommandLine = $state('');
  let draftWebSocketUrl = $state('');

  const transportOptions = [
    { value: 'stdio', label: 'Local process' },
    { value: 'websocket', label: 'WebSocket endpoint' }
  ];

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

  const attentionCards = $derived.by(() => agentCards.filter(isAttentionCard));

  const selectedCard = $derived.by(() =>
    selectedAgentId ? agentCards.find((card) => card.config.id === selectedAgentId) ?? null : null
  );

  const editingCard = $derived.by(() =>
    editingAgentId ? agentCards.find((card) => card.config.id === editingAgentId) ?? null : null
  );

  const selectedMessages = $derived.by(() => (selectedCard ? getAgentMessages(selectedCard) : []));
  const initialLoading = $derived(agentsStore.loading && !agentsStore.error && agentCards.length === 0);
  const refreshing = $derived(agentsStore.loading && agentCards.length > 0);

  function statusClass(state?: string | null, connectionState?: string | null, controlState?: string | null) {
    if (state === 'failed' || connectionState === 'failed' || controlState === 'failed' || controlState === 'degraded') {
      return 'status-dot-degraded';
    }
    if (state === 'running' && connectionState !== 'failed' && controlState !== 'failed') return 'status-dot-running';
    if (connectionState === 'connecting' || connectionState === 'reconnecting' || state === 'starting' || state === 'stopping') return 'status-dot-starting';
    return 'status-dot-stopped';
  }

  function statusLabel(config: AgentConfig) {
    if (config.transport === 'websocket') {
      return agentsStore.connectionStates[config.id] ?? 'idle';
    }
    const status = agentsStore.statuses[config.id];
    return status?.state ?? agentsStore.connectionStates[config.id] ?? 'idle';
  }

  function endpointLabel(config: AgentConfig) {
    return config.transport === 'websocket' ? config.websocketUrl ?? 'WebSocket endpoint missing' : config.commandLine;
  }

  function transportLabel(config: AgentConfig) {
    return config.transport === 'websocket' ? 'WebSocket endpoint' : 'Local process';
  }

  function stateTone(state: string | null | undefined) {
    if (state === 'running' || state === 'initialized' || state === 'ready') return 'success';
    if (state === 'failed') return 'danger';
    if (state === 'starting' || state === 'stopping' || state === 'connecting' || state === 'reconnecting' || state === 'degraded' || state === 'legacy') {
      return 'warning';
    }
    return 'muted';
  }

  function isConnected(config: AgentConfig) {
    return config.transport === 'websocket'
      ? agentsStore.connectionStates[config.id] === 'initialized' || agentsStore.connectionStates[config.id] === 'loading-sessions'
      : ['running', 'starting', 'stopping'].includes(agentsStore.statuses[config.id]?.state ?? '');
  }

  function isAttentionCard(card: (typeof agentCards)[number]) {
    return (
      card.connectionState !== 'reconnecting' &&
      (card.status?.state === 'failed' ||
      Boolean(card.status?.lastError) ||
      Boolean(card.error) ||
      card.connectionState === 'failed' ||
      card.controlHealth.state === 'failed' ||
      card.controlHealth.state === 'degraded')
    );
  }

  function getAttentionMessage(card: (typeof agentCards)[number]) {
    if (card.error) return card.error;
    if (card.status?.lastError) return card.status.lastError;
    if (card.status?.state === 'failed' && card.status.message) return card.status.message;
    if (card.connectionState === 'failed') return 'Connection to this agent failed.';
    if (card.controlHealth.state === 'failed' || card.controlHealth.state === 'degraded') return card.controlHealth.summary;
    return card.status?.message ?? card.controlHealth.summary;
  }

  function getAttentionKind(card: (typeof agentCards)[number]) {
    if (card.status?.state === 'failed' || card.status?.lastError) return 'Runtime';
    if (card.error || card.connectionState === 'failed') return 'Connection';
    if (card.controlHealth.state === 'failed' || card.controlHealth.state === 'degraded') return 'Compatibility';
    return 'Status';
  }

  function addAgentMessage(messages: AgentMessage[], seen: Set<string>, message: AgentMessage) {
    const detail = message.detail.trim();
    if (!detail) return;

    const key = detail.replace(/\s+/g, ' ').toLocaleLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    messages.push({ ...message, detail });
  }

  function getAgentMessages(card: (typeof agentCards)[number]): AgentMessage[] {
    const messages: AgentMessage[] = [];
    const seen = new Set<string>();

    addAgentMessage(messages, seen, {
      label: 'Runtime error',
      detail: card.status?.lastError ?? '',
      tone: 'error'
    });
    addAgentMessage(messages, seen, {
      label: 'Client error',
      detail: card.error ?? '',
      tone: 'error'
    });

    if (card.status?.state === 'failed' || card.status?.state === 'starting' || card.status?.state === 'stopping') {
      addAgentMessage(messages, seen, {
        label: 'Runtime message',
        detail: card.status.message,
        tone: card.status.state === 'failed' ? 'error' : 'warning'
      });
    }

    if (card.connectionState === 'failed' || card.connectionState === 'reconnecting') {
      addAgentMessage(messages, seen, {
        label: 'Connection',
        detail: card.connectionState === 'failed' ? 'Connection to this agent failed.' : 'Reconnecting to this agent.',
        tone: card.connectionState === 'failed' ? 'error' : 'warning'
      });
    }

    if (card.controlHealth.state === 'legacy' || card.controlHealth.state === 'degraded' || card.controlHealth.state === 'failed') {
      addAgentMessage(messages, seen, {
        label: 'Control health',
        detail: card.controlHealth.summary,
        tone: card.controlHealth.state === 'failed' ? 'error' : 'warning'
      });
    }

    if (card.controlHealth.missingMethods.length > 0) {
      addAgentMessage(messages, seen, {
        label: 'Missing methods',
        detail: card.controlHealth.missingMethods.join(', '),
        tone: 'warning'
      });
    }

    if (card.controlHealth.missingFeatures.length > 0) {
      addAgentMessage(messages, seen, {
        label: 'Missing features',
        detail: card.controlHealth.missingFeatures.join(', '),
        tone: 'warning'
      });
    }

    return messages;
  }

  function openAddDialog() {
    agentDialogMode = 'add';
    editingAgentId = null;
    draftName = '';
    draftTransport = 'stdio';
    draftCommandLine = '';
    draftWebSocketUrl = '';
  }

  function openEditDialog(card: (typeof agentCards)[number]) {
    agentDialogMode = 'edit';
    editingAgentId = card.config.id;
    selectedAgentId = null;
    draftName = card.config.name;
    draftTransport = card.config.transport;
    draftCommandLine = card.config.commandLine;
    draftWebSocketUrl = card.config.websocketUrl ?? '';
  }

  function closeAgentDialog() {
    agentDialogMode = null;
    editingAgentId = null;
    draftName = '';
    draftTransport = 'stdio';
    draftCommandLine = '';
    draftWebSocketUrl = '';
  }

  function openDetails(agentId: string) {
    logViewerOpen = false;
    selectedAgentId = agentId;
  }

  function closeDetails() {
    logViewerOpen = false;
    selectedAgentId = null;
  }

  function closeTopmostOverlay() {
    if (logViewerOpen) {
      logViewerOpen = false;
      return true;
    }

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

  async function refreshAgents() {
    await agentsStore.initialize();
  }

  async function saveAgentDialog() {
    const name = draftName.trim();
    const endpoint = draftTransport === 'websocket' ? draftWebSocketUrl.trim() : draftCommandLine.trim();
    if (!name || !endpoint) return;

    if (agentDialogMode === 'add') {
      const config = agentsStore.createConfig(name, draftTransport, endpoint);
      agentsStore.saveConfig(config);
      closeAgentDialog();
      await agentsStore.refreshAgent(config);
      if (config.autoStart) await agentsStore.startConfiguredAgent(config.id);
      return;
    }

    if (agentDialogMode === 'edit' && editingCard) {
      const config = editingCard.config;
      const updates =
        draftTransport === 'websocket'
          ? { name, transport: draftTransport, commandLine: '', websocketUrl: endpoint }
          : { name, transport: draftTransport, commandLine: endpoint, websocketUrl: undefined };
      agentsStore.updateConfig(config.id, updates);
      closeAgentDialog();
      await agentsStore.refreshAgent({ ...config, ...updates });
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

<div class="agents-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Agents"
      description="Configure connections, inspect status, and control agent runtimes."
    />

    <div class="compact-toolbar">
      <IconTooltipButton
        label={refreshing ? 'Refreshing agents' : 'Refresh agents'}
        icon={refreshing ? LoaderCircle : RefreshCw}
        iconClass={refreshing ? 'animate-spin' : ''}
        size={16}
        disabled={agentsStore.loading}
        onclick={() => refreshAgents()}
      />
      <IconTooltipButton label="Add agent" icon={CirclePlus} size={16} onclick={() => openAddDialog()} />
    </div>
  </div>

  <div class="agents-unified-panel">
    <section class="settings-section" aria-label="Configured agents">
      {#if initialLoading}
        <div class="state-skeleton-list" aria-label="Loading agents" aria-busy="true">
          {#each Array(3) as _}
            <div class="state-skeleton-row">
              <span class="state-skeleton-avatar"></span>
              <span class="state-skeleton-copy"><i></i><i></i></span>
              <span class="state-skeleton-actions"></span>
            </div>
          {/each}
        </div>
      {:else if agentsStore.error && agentCards.length === 0}
        <div class="state-panel state-panel-error" role="alert">
          <span class="state-panel-icon"><AlertTriangle size={17} /></span>
          <div class="state-panel-copy">
            <strong>Agents could not be loaded</strong>
            <p>{agentsStore.error}</p>
          </div>
          <button class="action-btn" type="button" onclick={() => refreshAgents()}>Try again</button>
        </div>
      {:else if agentCards.length === 0}
        <div class="state-panel">
          <span class="state-panel-icon"><Bot size={17} /></span>
          <div class="state-panel-copy">
            <strong>No agents configured</strong>
            <p>Add a local ACP command or connect to an ACP WebSocket endpoint.</p>
          </div>
          <button class="action-btn action-btn-primary" type="button" onclick={openAddDialog}>Add agent</button>
        </div>
      {:else}
        {#if agentsStore.error}
          <div class="state-inline-error" role="alert">
            <AlertTriangle size={15} />
            <span class="min-w-0 flex-1"><strong>Some agents could not be refreshed.</strong> {agentsStore.error}</span>
            <button class="action-btn action-btn-compact" type="button" onclick={() => refreshAgents()}>Retry</button>
          </div>
        {:else if refreshing}
          <div class="state-inline-progress" role="status"><LoaderCircle size={14} class="animate-spin" /><span>Refreshing agent status…</span></div>
        {/if}
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
                      {#if isAttentionCard(card)}
                        <button class="agent-issue-chip" type="button" title={getAttentionMessage(card)} onclick={() => openDetails(card.config.id)}>
                          Issue
                        </button>
                      {/if}
                    </div>
                    <div class="mt-1 truncate text-xs text-[var(--muted)]">{endpointLabel(card.config)}</div>
                  </div>
                </div>

                <div class="compact-toolbar">
                  <IconTooltipButton label={`Details for ${card.config.name}`} icon={Info} onclick={() => openDetails(card.config.id)} />
                  <IconTooltipButton label={`Edit ${card.config.name}`} icon={Pencil} onclick={() => openEditDialog(card)} />
                  {#if isConnected(card.config)}
                    <IconTooltipButton label={card.config.transport === 'websocket' ? 'Disconnect' : 'Stop'} icon={Square} onclick={() => agentsStore.stopConfiguredAgent(card.config.id)} />
                    <IconTooltipButton label={card.config.transport === 'websocket' ? 'Reconnect' : 'Restart'} icon={RotateCcw} onclick={() => agentsStore.restartConfiguredAgent(card.config.id)} />
                  {:else}
                    <IconTooltipButton label={card.config.transport === 'websocket' ? 'Connect' : 'Start'} icon={Play} onclick={() => agentsStore.startConfiguredAgent(card.config.id)} />
                  {/if}
                  <IconTooltipButton
                    label={card.config.autoStart ? 'Disable auto-start' : 'Enable auto-start'}
                    icon={card.config.autoStart ? ToggleRight : ToggleLeft}
                    onclick={() => agentsStore.updateConfig(card.config.id, { autoStart: !card.config.autoStart })}
                  />
                  <IconTooltipButton label={`Delete ${card.config.name}`} icon={Trash2} tone="danger" onclick={() => (pendingDeleteAgentId = card.config.id)} />
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    {#if attentionCards.length > 0}
      <section class="settings-section agent-attention-section">
        <div class="settings-section-header settings-section-header-action">
          <div>
            <h2>Needs attention</h2>
            <p>Review agents with runtime, connection, or compatibility issues.</p>
          </div>
          <span class="badge">{attentionCards.length}</span>
        </div>

        <div class="agent-attention-list">
          {#each attentionCards as card}
            <article class="agent-attention-row">
              <div class="min-w-0 flex flex-1 items-center gap-3">
                <span class={`status-dot ${statusClass(card.status?.state, card.connectionState, card.controlHealth.state)}`}></span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="truncate text-sm font-medium">{card.config.name}</div>
                    <span class="agent-attention-kind">{getAttentionKind(card)}</span>
                  </div>
                  <div class="mt-1 truncate text-xs text-[var(--muted)]">{getAttentionMessage(card)}</div>
                </div>
              </div>
              <button class="action-btn action-btn-compact" type="button" onclick={() => openDetails(card.config.id)}>
                Details
              </button>
            </article>
          {/each}
        </div>
      </section>
    {/if}
  </div>

  {#if agentDialogMode}
    <AppDialog
      open={true}
      title={agentDialogMode === 'add' ? 'Add agent' : 'Edit agent'}
      description="Choose a local process or an already-running ACP WebSocket endpoint."
      size="workflow"
      closeLabel="Close agent dialog"
      portalTarget={overlayPortalTarget}
      onDismiss={closeAgentDialog}
    >
      <form id="agent-dialog-form" class="app-dialog-form" onsubmit={(event) => { event.preventDefault(); saveAgentDialog(); }}>
        <label class="app-dialog-field">
          <span class="app-dialog-field-label">Agent name</span>
          <input class="input-shell w-full" placeholder="Agent name" bind:value={draftName} />
          <span class="app-dialog-field-help">Shown in sidebars, settings, and session controls.</span>
        </label>

        <label class="app-dialog-field">
          <span class="app-dialog-field-label">Connection type</span>
          <AppSelect bind:value={draftTransport} options={transportOptions} ariaLabel="Agent connection type" />
          <span class="app-dialog-field-help">Local processes are managed by Desktop. WebSocket agents run independently.</span>
        </label>

        {#if draftTransport === 'stdio'}
          <label class="app-dialog-field">
            <span class="app-dialog-field-label">Command line</span>
            <input class="input-shell w-full" placeholder="/path/to/executable --acp" bind:value={draftCommandLine} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false} inputmode="text" />
            <span class="app-dialog-field-help">Executable and arguments used to start the ACP agent.</span>
          </label>
        {:else}
          <label class="app-dialog-field">
            <span class="app-dialog-field-label">Agent address</span>
            <input class="input-shell w-full" placeholder="127.0.0.1:3030" bind:value={draftWebSocketUrl} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false} inputmode="url" />
            <span class="app-dialog-field-help">Host and port for an independently running ACP WebSocket server.</span>
          </label>
        {/if}
      </form>

      {#snippet footer()}
        <button class="action-btn" type="button" onclick={() => closeAgentDialog()}>Cancel</button>
        <button class="action-btn action-btn-accent" form="agent-dialog-form" type="submit" disabled={!draftName.trim() || !(draftTransport === 'websocket' ? draftWebSocketUrl.trim() : draftCommandLine.trim())}>
          {agentDialogMode === 'add' ? 'Add agent' : 'Save changes'}
        </button>
      {/snippet}
    </AppDialog>
  {/if}

  {#if pendingDeleteAgentId}
    {@const pendingDeleteAgent = agentCards.find((card) => card.config.id === pendingDeleteAgentId)?.config}
    <AppConfirmDialog
      open={true}
      title={`Delete ${pendingDeleteAgent?.name ?? 'agent'}?`}
      description="The desktop configuration will be removed. Existing session data stays on disk."
      confirmLabel="Delete"
      portalTarget={overlayPortalTarget}
      onConfirm={confirmDeleteAgent}
      onDismiss={() => (pendingDeleteAgentId = null)}
    />
  {/if}

  {#if selectedCard}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-40 flex justify-end">
        <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close details" onclick={() => closeDetails()}></button>
        <div
          class="agent-details-panel relative z-10"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agent-details-title"
          tabindex="-1"
          data-blocking-overlay="true"
        >
          <header class="agent-details-header">
            <div class="agent-details-heading">
              <span class={`status-dot ${statusClass(selectedCard.status?.state, selectedCard.connectionState, selectedCard.controlHealth.state)}`}></span>
              <div>
                <h2 id="agent-details-title">{selectedCard.config.name}</h2>
                <p>{transportLabel(selectedCard.config)}</p>
              </div>
            </div>
            <IconTooltipButton label="Close details" icon={X} onclick={() => closeDetails()} />
          </header>

          <div class="agent-details-body">
            <section class="agent-details-overview" aria-label="Agent overview">
              <div class="agent-details-overview-stats">
                <div class="agent-details-overview-stat">
                  <span>Runtime</span>
                  <strong class={`agent-details-tone-${stateTone(selectedCard.config.transport === 'websocket' ? 'external' : selectedCard.status?.state)}`}>
                    {selectedCard.config.transport === 'websocket' ? 'External' : selectedCard.status?.state ?? 'Stopped'}
                  </strong>
                </div>
                <div class="agent-details-overview-stat">
                  <span>Connection</span>
                  <strong class={`agent-details-tone-${stateTone(selectedCard.connectionState)}`}>{selectedCard.connectionState}</strong>
                </div>
                <div class="agent-details-overview-stat">
                  <span>Sessions</span>
                  <strong aria-label={`${selectedCard.sessions.length} ${selectedCard.sessions.length === 1 ? 'session' : 'sessions'}`}>{selectedCard.sessions.length}</strong>
                </div>
                <div class="agent-details-overview-stat">
                  <span>Control health</span>
                  <strong class={`agent-details-tone-${stateTone(selectedCard.controlHealth.state)}`}>{selectedCard.controlHealth.state}</strong>
                </div>
              </div>
              <div class="agent-details-overview-context">
                <span class="agent-details-context-label">Endpoint</span>
                <code title={endpointLabel(selectedCard.config)}>{endpointLabel(selectedCard.config)}</code>
                <span class="agent-details-context-separator" aria-hidden="true"></span>
                <span>{selectedCard.config.transport}</span>
              </div>
            </section>

            <section class="agent-details-section" aria-labelledby="agent-runtime-title">
              <div class="agent-details-section-header">
                <div>
                  <h3 id="agent-runtime-title">Runtime</h3>
                  <p>{selectedCard.config.transport === 'websocket' ? 'Connection configuration for this independently managed server.' : 'Local process and connection configuration.'}</p>
                </div>
              </div>
              <dl class="agent-details-list">
                {#if selectedCard.config.transport === 'stdio'}
                  <div><dt>Process ID</dt><dd class="agent-details-mono">{selectedCard.status?.pid ?? 'Unavailable'}</dd></div>
                  <div><dt>Version</dt><dd class="agent-details-mono">{selectedCard.status?.version ?? 'Unavailable'}</dd></div>
                {/if}
                <div><dt>Enabled</dt><dd>{selectedCard.config.enabled ? 'Yes' : 'No'}</dd></div>
                <div><dt>Auto start</dt><dd>{selectedCard.config.autoStart ? 'On' : 'Off'}</dd></div>
              </dl>
            </section>

            <section class="agent-details-section" aria-labelledby="agent-control-title">
              <div class="agent-details-section-header agent-details-section-header-action">
                <div>
                  <h3 id="agent-control-title">Control health</h3>
                  <p>Compatibility between Desktop and this agent's control API.</p>
                </div>
                <IconTooltipButton
                  label="Refresh capabilities"
                  icon={RefreshCw}
                  controlSize="compact"
                  onclick={() => agentsStore.refreshCapabilities(selectedCard.config.id)}
                />
              </div>
              <dl class="agent-details-list">
                <div><dt>Control API</dt><dd class="agent-details-mono">{selectedCard.controlCapabilities ? `v${selectedCard.controlCapabilities.querymt_control_version}` : 'Not loaded'}</dd></div>
                <div><dt>Agent</dt><dd>{selectedCard.controlCapabilities?.agent.display_name ?? selectedCard.config.name}</dd></div>
                <div><dt>Methods</dt><dd>{selectedCard.controlCapabilities?.methods.length ?? 0}</dd></div>
                <div><dt>Notifications</dt><dd>{selectedCard.controlCapabilities?.notifications?.length ?? 0}</dd></div>
              </dl>
            </section>

            <section class="agent-details-section" aria-labelledby="agent-capabilities-title">
              <div class="agent-details-section-header">
                <div>
                  <h3 id="agent-capabilities-title">Capabilities</h3>
                  <p>Transports and product features reported by the agent.</p>
                </div>
              </div>
              {#if selectedCard.controlCapabilities}
                <div class="agent-details-capability-list">
                  <div class="agent-details-capability-row">
                    <span>Agent</span>
                    <div>
                      <span class="agent-details-chip">{selectedCard.controlCapabilities.agent.kind}</span>
                      {#if selectedCard.controlCapabilities.agent.version}<span class="agent-details-chip">v{selectedCard.controlCapabilities.agent.version}</span>{/if}
                    </div>
                  </div>
                  <div class="agent-details-capability-row">
                    <span>Transport</span>
                    <div>
                      {#if selectedCard.controlCapabilities.transport.acp}<span class="agent-details-chip">ACP</span>{/if}
                      {#if selectedCard.controlCapabilities.transport.stdio}<span class="agent-details-chip">stdio</span>{/if}
                      {#if selectedCard.controlCapabilities.transport.websocket}<span class="agent-details-chip">WebSocket</span>{/if}
                      {#if selectedCard.controlCapabilities.transport.mesh}<span class="agent-details-chip">mesh</span>{/if}
                    </div>
                  </div>
                  <div class="agent-details-capability-row">
                    <span>Features</span>
                    <div>
                      {#if selectedCard.controlCapabilities.features.models}<span class="agent-details-chip">models</span>{/if}
                      {#if selectedCard.controlCapabilities.features.schedules}<span class="agent-details-chip">schedules</span>{/if}
                      {#if selectedCard.controlCapabilities.features.remote_schedules}<span class="agent-details-chip">remote schedules</span>{/if}
                      {#if selectedCard.controlCapabilities.features.remote_sessions}<span class="agent-details-chip">remote sessions</span>{/if}
                      {#if selectedCard.controlCapabilities.features.mesh}<span class="agent-details-chip">mesh</span>{/if}
                      {#if selectedCard.controlCapabilities.features.mesh_invites}<span class="agent-details-chip">mesh invites</span>{/if}
                      {#if selectedCard.controlCapabilities.features.profiles}<span class="agent-details-chip">profiles</span>{/if}
                      {#if selectedCard.controlCapabilities.features.auth}<span class="agent-details-chip">auth</span>{/if}
                    </div>
                  </div>
                </div>
              {:else}
                <div class="agent-details-empty">No capabilities loaded yet.</div>
              {/if}
            </section>

            {#if selectedMessages.length > 0}
              <section class="agent-details-section" aria-labelledby="agent-diagnostics-title">
                <div class="agent-details-section-header agent-details-section-header-action">
                  <div>
                    <h3 id="agent-diagnostics-title">Diagnostics</h3>
                    <p>Issues requiring attention from the runtime, connection, or control API.</p>
                  </div>
                  <span class="agent-details-section-count">{selectedMessages.length}</span>
                </div>
                <div class="agent-message-list">
                  {#each selectedMessages as message}
                    <div class={`agent-message-row agent-message-row-${message.tone}`}>
                      <div class="agent-message-label">{message.label}</div>
                      <div class="agent-message-detail">{message.detail}</div>
                    </div>
                  {/each}
                </div>
              </section>
            {/if}

            {#if selectedCard.config.transport === 'stdio'}
              <section class="agent-details-logs-summary" aria-labelledby="agent-runtime-logs-title">
                <div>
                  <h3 id="agent-runtime-logs-title">Runtime logs</h3>
                  <p>{selectedCard.logs.length} {selectedCard.logs.length === 1 ? 'entry' : 'entries'} retained</p>
                </div>
                <button class="action-btn action-btn-compact" type="button" onclick={() => (logViewerOpen = true)}>Open log console</button>
              </section>
            {/if}
          </div>
        </div>

        {#if logViewerOpen}
          <div class="agent-log-viewer-layer">
            <button class="agent-log-viewer-backdrop" type="button" aria-label="Dismiss expanded logs" onclick={() => (logViewerOpen = false)}></button>
            <div
              class="agent-log-viewer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="agent-log-viewer-title"
              data-blocking-overlay="true"
            >
              <header class="agent-log-viewer-header">
                <div>
                  <h2 id="agent-log-viewer-title">{selectedCard.config.name} runtime logs</h2>
                  <p>{selectedCard.logs.length} {selectedCard.logs.length === 1 ? 'entry' : 'entries'} retained</p>
                </div>
                <IconTooltipButton label="Close expanded logs" icon={X} onclick={() => (logViewerOpen = false)} />
              </header>
              <div class="agent-log-viewer-body">
                <SidecarLogList
                  logs={selectedCard.logs}
                  title={`${selectedCard.config.name} runtime logs`}
                  showHeader={false}
                  emptyMessage="No logs yet for this agent."
                />
              </div>
            </div>
          </div>
        {/if}
      </div>
    </Portal>
  {/if}
</div>
