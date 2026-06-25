<script lang="ts">
  import { goto } from '$app/navigation';
  import { Bot, CalendarClock, ChevronDown, Link, MessageSquarePlus, Network, Plus, RefreshCw, Search, SendHorizontal, X } from '@lucide/svelte';
  import { Command, Dialog } from 'bits-ui';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import type { CommandPalettePrefill, DesktopSessionSummary } from '$lib/domain/types';
  import type { RemoteSessionInfo } from '$lib/querymt/generated/types';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';

  type CommandAction = {
    id: string;
    title: string;
    subtitle: string;
    section: string;
    keywords: string[];
    disabled?: boolean;
    run: () => Promise<void> | void;
  };

  let { portalTarget = null }: { portalTarget?: HTMLElement | null } = $props();

  let scheduleAgentId = $state('');
  let schedulePrompt = $state('');
  let scheduleWorkspace = $state('');
  let scheduleMode = $state<'new' | 'existing'>('new');
  let scheduleSessionId = $state('');
  let schedulePreset = $state<'hourly' | 'daily' | 'weekdays' | 'custom'>('hourly');
  let scheduleCron = $state('0 * * * *');
  let scheduleAdvanced = $state(false);
  let scheduleMaxRuns = $state('');
  let scheduleMaxSteps = $state('');
  let scheduleMaxCost = $state('');
  let remoteNodeId = $state('');
  let remoteWorkspace = $state('');
  let attachNodeId = $state('');
  let attachSessionId = $state('');
  let formError = $state<string | null>(null);
  let submitting = $state(false);
  let loadingRemoteSessions = $state(false);

  const onlineAgents = $derived.by(() =>
    agentsStore.configs.filter((config) => agentsStore.statuses[config.id]?.state === 'running')
  );

  const scheduleCapableAgents = $derived.by(() =>
    onlineAgents.filter((config) => {
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.schedules && caps.methods.includes('querymt/schedules/create'));
    })
  );

  const remoteCapableAgents = $derived.by(() =>
    onlineAgents.filter((config) => {
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.remote_sessions && caps.methods.includes('querymt/remote/createSession'));
    })
  );

  const sessionChoices = $derived.by(() => {
    const sessions = scheduleAgentId ? agentsStore.sessionsByAgent[scheduleAgentId] ?? [] : [];
    return sessions.slice().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  });

  const remoteNodeChoices = $derived.by(() => {
    const nodes = scheduleAgentId ? agentsStore.meshNodesByAgent[scheduleAgentId]?.nodes ?? [] : [];
    return nodes
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((node) => ({
        value: node.id,
        label: `${node.label || node.id}${node.active_sessions ? ` · ${node.active_sessions} active` : ''}`
      }));
  });

  const loadedRemoteSessionList = $derived.by(() =>
    scheduleAgentId && attachNodeId ? agentsStore.remoteSessionsByAgent[scheduleAgentId]?.[attachNodeId] ?? null : null
  );

  const remoteSessionChoices = $derived.by(() =>
    (loadedRemoteSessionList?.sessions ?? [])
      .slice()
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
      .map((session) => ({ value: session.id, label: remoteSessionLabel(session) }))
  );

  const isDialogFormMode = $derived(commandPaletteStore.mode !== 'commands');
  const dialogTitle = $derived.by(() => {
    if (commandPaletteStore.mode === 'schedule') return 'Schedule Prompt';
    if (commandPaletteStore.mode === 'remote-create') return 'Create Remote Session';
    if (commandPaletteStore.mode === 'remote-attach') return 'Attach Remote Session';
    return 'Command Palette';
  });
  const dialogSubtitle = $derived.by(() => {
    if (commandPaletteStore.mode === 'schedule') return 'Create a recurring task or attach it to an existing session.';
    if (commandPaletteStore.mode === 'remote-create') return 'Start a session on a selected mesh node.';
    if (commandPaletteStore.mode === 'remote-attach') return 'Continue an existing remote session from a mesh node.';
    return 'Cmd+P for fast actions and creation flows.';
  });

  const commands = $derived.by(() => {
    const actions: CommandAction[] = [
      {
        id: 'new-session-prompt',
        title: 'New session with prompt',
        subtitle: 'Go to Today and focus the prompt composer.',
        section: 'Create',
        keywords: ['new', 'session', 'prompt', 'today'],
        disabled: onlineAgents.length === 0,
        run: async () => {
          await goto('/');
          agentsStore.requestPromptFocus();
          commandPaletteStore.close();
        }
      },
      {
        id: 'new-blank-session',
        title: 'New blank session',
        subtitle: 'Create a blank interactive session from the Today view.',
        section: 'Create',
        keywords: ['blank', 'session', 'workspace'],
        disabled: onlineAgents.length === 0,
        run: async () => {
          await goto('/');
          commandPaletteStore.close();
        }
      },
      {
        id: 'schedule-prompt',
        title: 'Schedule a prompt',
        subtitle: 'Create a scheduled task with a new background session by default.',
        section: 'Create',
        keywords: ['schedule', 'automation', 'cron', 'task'],
        disabled: scheduleCapableAgents.length === 0,
        run: () => {
          commandPaletteStore.openSchedule({
            agentId: scheduleCapableAgents[0]?.id ?? null,
            sessionId: agentsStore.activeSessionId,
            cwd: agentsStore.composerCwd || agentsStore.activeSessionId ? agentsStore.composerCwd : null,
            prompt: agentsStore.composerPrompt,
            nodeId: null
          });
          hydrateScheduleState(commandPaletteStore.prefill);
        }
      },
      {
        id: 'schedule-current-session',
        title: 'Schedule current session',
        subtitle: 'Attach a scheduled task to the currently focused session.',
        section: 'Create',
        keywords: ['schedule', 'current', 'session', 'follow-up'],
        disabled: !(agentsStore.activeAgentId && agentsStore.activeSessionId),
        run: () => {
          commandPaletteStore.openSchedule({
            agentId: agentsStore.activeAgentId,
            sessionId: agentsStore.activeSessionId,
            cwd: null,
            prompt: null,
            nodeId: null
          });
          hydrateScheduleState(commandPaletteStore.prefill, true);
        }
      },
      {
        id: 'create-remote-session',
        title: 'Create remote session',
        subtitle: 'Start a remote session on a mesh node.',
        section: 'Mesh',
        keywords: ['remote', 'mesh', 'session', 'create'],
        disabled: remoteCapableAgents.length === 0,
        run: () => {
          commandPaletteStore.openRemoteCreate({ agentId: remoteCapableAgents[0]?.id ?? null });
          hydrateRemoteCreateState(commandPaletteStore.prefill);
        }
      },
      {
        id: 'attach-remote-session',
        title: 'Attach remote session',
        subtitle: 'Attach an existing remote session from a node.',
        section: 'Mesh',
        keywords: ['remote', 'mesh', 'attach', 'session'],
        disabled: remoteCapableAgents.length === 0,
        run: () => {
          commandPaletteStore.openRemoteAttach({ agentId: remoteCapableAgents[0]?.id ?? null });
          hydrateRemoteAttachState(commandPaletteStore.prefill);
        }
      },
      {
        id: 'open-automations',
        title: 'Open Automations',
        subtitle: 'View and control existing schedules.',
        section: 'Navigate',
        keywords: ['automations', 'schedules'],
        run: async () => {
          await goto('/automations');
          commandPaletteStore.close();
        }
      },
      {
        id: 'open-mesh',
        title: 'Open Mesh',
        subtitle: 'View mesh status, nodes, and remote sessions.',
        section: 'Navigate',
        keywords: ['mesh', 'remote', 'nodes'],
        run: async () => {
          await goto('/mesh');
          commandPaletteStore.close();
        }
      }
    ];

    return actions;
  });

  $effect(() => {
    if (!commandPaletteStore.open) {
      formError = null;
      submitting = false;
      loadingRemoteSessions = false;
      return;
    }

    if (commandPaletteStore.mode === 'schedule') {
      hydrateScheduleState(commandPaletteStore.prefill);
    } else if (commandPaletteStore.mode === 'remote-create') {
      hydrateRemoteCreateState(commandPaletteStore.prefill);
    } else if (commandPaletteStore.mode === 'remote-attach') {
      hydrateRemoteAttachState(commandPaletteStore.prefill);
    }
  });

  function hydrateScheduleState(prefill: CommandPalettePrefill | null, forceExisting = false) {
    scheduleAgentId =
      prefill?.agentId ?? scheduleAgentId ?? scheduleCapableAgents[0]?.id ?? agentsStore.activeAgentId ?? '';
    schedulePrompt = prefill?.prompt ?? schedulePrompt ?? '';
    scheduleWorkspace = prefill?.cwd ?? scheduleWorkspace ?? agentsStore.composerCwd ?? '';
    scheduleSessionId = prefill?.sessionId ?? scheduleSessionId ?? '';
    scheduleMode = forceExisting || prefill?.sessionId ? 'existing' : 'new';
    schedulePreset = 'hourly';
    scheduleCron = '0 * * * *';
    scheduleAdvanced = scheduleMode === 'existing';
    formError = null;
  }

  function hydrateRemoteCreateState(prefill: CommandPalettePrefill | null) {
    const agentId = ((prefill?.agentId ?? scheduleAgentId) || remoteCapableAgents[0]?.id) ?? '';
    scheduleAgentId = agentId;
    remoteNodeId = resolveNodeSelection(agentId, prefill?.nodeId ?? remoteNodeId);
    remoteWorkspace = prefill?.cwd ?? remoteWorkspace ?? '';
    formError = null;
  }

  function hydrateRemoteAttachState(prefill: CommandPalettePrefill | null) {
    const agentId = ((prefill?.agentId ?? scheduleAgentId) || remoteCapableAgents[0]?.id) ?? '';
    scheduleAgentId = agentId;
    attachNodeId = resolveNodeSelection(agentId, prefill?.nodeId ?? attachNodeId);
    attachSessionId = resolveSessionSelection(agentId, attachNodeId, prefill?.sessionId ?? attachSessionId);
    formError = null;
  }

  function presetCron() {
    if (schedulePreset === 'hourly') return '0 * * * *';
    if (schedulePreset === 'daily') return '0 9 * * *';
    if (schedulePreset === 'weekdays') return '0 9 * * 1-5';
    return scheduleCron.trim();
  }

  async function submitSchedule() {
    if (!scheduleAgentId || !schedulePrompt.trim()) {
      formError = 'Agent and prompt are required.';
      return;
    }

    submitting = true;
    formError = null;

    try {
      let sessionId = scheduleSessionId.trim();

      if (scheduleMode === 'new') {
        if (!scheduleWorkspace.trim()) {
          throw new Error('Workspace is required for a new scheduled session.');
        }
        const created = await agentsStore.createBackgroundSession(scheduleAgentId, scheduleWorkspace.trim());
        sessionId = created.sessionId;
      } else if (!sessionId) {
        throw new Error('Pick an existing session to attach this schedule.');
      }

      await agentsStore.createSchedule(scheduleAgentId, {
        session_id: sessionId,
        prompt: schedulePrompt.trim(),
        trigger: {
          kind: 'cron',
          expr: presetCron()
        },
        max_runs: scheduleMaxRuns ? Number(scheduleMaxRuns) : undefined,
        max_steps: scheduleMaxSteps ? Number(scheduleMaxSteps) : undefined,
        max_cost_usd: scheduleMaxCost ? Number(scheduleMaxCost) : undefined
      });

      await goto('/automations');
      commandPaletteStore.close();
    } catch (error) {
      formError = error instanceof Error ? error.message : 'Failed to create scheduled task.';
    } finally {
      submitting = false;
    }
  }

  async function submitRemoteCreate() {
    if (!scheduleAgentId || !remoteNodeId.trim()) {
      formError = 'Agent and node are required.';
      return;
    }

    submitting = true;
    formError = null;
    try {
      await agentsStore.createRemoteSession(scheduleAgentId, remoteNodeId.trim(), remoteWorkspace.trim() || undefined);
      await goto('/mesh');
      commandPaletteStore.close();
    } catch (error) {
      formError = error instanceof Error ? error.message : 'Failed to create remote session.';
    } finally {
      submitting = false;
    }
  }

  async function loadAttachRemoteSessions() {
    if (!scheduleAgentId || !attachNodeId) {
      formError = 'Select an agent and node first.';
      return;
    }

    loadingRemoteSessions = true;
    formError = null;
    try {
      const result = await agentsStore.refreshRemoteSessionsForAgent(scheduleAgentId, attachNodeId);
      attachSessionId = resolveSessionSelection(scheduleAgentId, attachNodeId, attachSessionId) || (result.sessions[0]?.id ?? '');
    } catch (error) {
      formError = error instanceof Error ? error.message : 'Failed to load remote sessions.';
    } finally {
      loadingRemoteSessions = false;
    }
  }

  async function submitRemoteAttach() {
    if (!scheduleAgentId || !attachNodeId.trim() || !attachSessionId.trim()) {
      formError = 'Agent, node, and session are required.';
      return;
    }

    submitting = true;
    formError = null;
    try {
      await agentsStore.attachRemoteSession(scheduleAgentId, attachNodeId.trim(), attachSessionId.trim());
      await goto('/mesh');
      commandPaletteStore.close();
    } catch (error) {
      formError = error instanceof Error ? error.message : 'Failed to attach remote session.';
    } finally {
      submitting = false;
    }
  }

  function openScheduleFromContext(prefill: CommandPalettePrefill | null = null, existing = false) {
    commandPaletteStore.openSchedule(prefill);
    hydrateScheduleState(prefill, existing);
  }

  function sessionLabel(session: DesktopSessionSummary) {
    return `${session.title || session.sessionId} · ${session.cwd || 'No workspace'} · ${session.updatedAt || 'No activity yet'}`;
  }

  function remoteSessionLabel(session: RemoteSessionInfo) {
    const title = session.title || session.id;
    const details = [session.cwd, session.updated_at].filter(Boolean);
    return details.length > 0 ? `${title} · ${details.join(' · ')}` : title;
  }

  function remoteNodesFor(agentId: string) {
    return agentsStore.meshNodesByAgent[agentId]?.nodes ?? [];
  }

  function resolveNodeSelection(agentId: string, preferredNodeId: string | null | undefined) {
    const nodes = remoteNodesFor(agentId);
    if (preferredNodeId && (nodes.length === 0 || nodes.some((node) => node.id === preferredNodeId))) {
      return preferredNodeId;
    }
    return nodes.slice().sort((a, b) => a.label.localeCompare(b.label))[0]?.id ?? '';
  }

  function resolveSessionSelection(agentId: string, nodeId: string, preferredSessionId: string | null | undefined) {
    const sessions = agentsStore.remoteSessionsByAgent[agentId]?.[nodeId]?.sessions ?? [];
    if (preferredSessionId && (sessions.length === 0 || sessions.some((session) => session.id === preferredSessionId))) {
      return preferredSessionId;
    }
    return '';
  }

  function handleRemoteCreateAgentChange(agentId: string) {
    scheduleAgentId = agentId;
    remoteNodeId = resolveNodeSelection(agentId, remoteNodeId);
  }

  function handleRemoteAttachAgentChange(agentId: string) {
    scheduleAgentId = agentId;
    attachNodeId = resolveNodeSelection(agentId, attachNodeId);
    attachSessionId = resolveSessionSelection(agentId, attachNodeId, attachSessionId);
  }

  function handleAttachNodeChange(nodeId: string) {
    attachNodeId = nodeId;
    attachSessionId = resolveSessionSelection(scheduleAgentId, nodeId, attachSessionId);
  }
</script>

<Dialog.Root bind:open={commandPaletteStore.open}>
  <Dialog.Portal to={portalTarget ?? undefined}>
    <Dialog.Overlay class="model-picker-backdrop" />
    <Dialog.Content
      class={`model-picker-modal command-palette-modal ${isDialogFormMode ? 'command-palette-modal-form' : ''} !p-0`}
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      <div class="dialog-header">
        <div class="dialog-header-title-block">
          <Dialog.Title class="dialog-title">{dialogTitle}</Dialog.Title>
          <Dialog.Description class="dialog-subtitle">{dialogSubtitle}</Dialog.Description>
        </div>
        <div class="dialog-header-actions">
          {#if commandPaletteStore.mode !== 'commands'}
            <button class="dialog-header-button" type="button" onclick={() => commandPaletteStore.setMode('commands')}>
              Back
            </button>
          {/if}
        </div>
      </div>

      <div class={isDialogFormMode ? 'dialog-body' : 'p-4'}>
        {#if commandPaletteStore.mode === 'commands'}
          <Command.Root label="Command palette" loop>
            <div class="model-search-shell">
              <Search size={15} />
              <Command.Input
                bind:value={commandPaletteStore.query}
                autofocus
                class="model-search-input"
                placeholder="Search commands, actions, and navigation…"
              />
            </div>

            <div class="picker-scroll-frame mt-3">
              <Command.List class="picker-scroll-area max-h-[26rem]">
                <Command.Empty>
                  <div class="surface-muted px-3 py-3 text-xs text-[var(--muted)]">
                    No matching commands.
                  </div>
                </Command.Empty>

                <Command.Group value="create">
                  <Command.GroupHeading class="px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Create</Command.GroupHeading>
                  <Command.GroupItems class="model-picker-list mt-2">
                    {#each commands.filter((item) => item.section === 'Create') as item, index}
                      <Command.Item
                      value={item.title}
                      keywords={item.keywords}
                      disabled={item.disabled}
                      onSelect={() => item.run()}
                      class={`model-picker-row ${index > 0 ? 'model-picker-row-separated' : ''} ${item.disabled ? 'opacity-50' : ''}`}
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-medium">{item.title}</div>
                        <div class="muted truncate text-xs">{item.subtitle}</div>
                      </div>
                      <span class="badge">Create</span>
                      </Command.Item>
                    {/each}
                  </Command.GroupItems>
                </Command.Group>

                <Command.Group value="mesh">
                  <Command.GroupHeading class="mt-4 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Mesh</Command.GroupHeading>
                  <Command.GroupItems class="model-picker-list mt-2">
                  {#each commands.filter((item) => item.section === 'Mesh') as item, index}
                    <Command.Item
                      value={item.title}
                      keywords={item.keywords}
                      disabled={item.disabled}
                      onSelect={() => item.run()}
                      class={`model-picker-row ${index > 0 ? 'model-picker-row-separated' : ''} ${item.disabled ? 'opacity-50' : ''}`}
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-sm font-medium">{item.title}</div>
                        <div class="muted truncate text-xs">{item.subtitle}</div>
                      </div>
                      <span class="badge">Mesh</span>
                    </Command.Item>
                  {/each}
                  </Command.GroupItems>
                </Command.Group>

                <Command.Group value="navigate">
                  <Command.GroupHeading class="mt-4 px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Navigate</Command.GroupHeading>
                  <Command.GroupItems class="model-picker-list mt-2">
                    {#each commands.filter((item) => item.section === 'Navigate') as item, index}
                      <Command.Item
                        value={item.title}
                        keywords={item.keywords}
                        onSelect={() => item.run()}
                        class={`model-picker-row ${index > 0 ? 'model-picker-row-separated' : ''}`}
                      >
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-sm font-medium">{item.title}</div>
                          <div class="muted truncate text-xs">{item.subtitle}</div>
                        </div>
                        <span class="badge">Navigate</span>
                      </Command.Item>
                    {/each}
                  </Command.GroupItems>
                </Command.Group>
              </Command.List>
            </div>
          </Command.Root>
        {:else if commandPaletteStore.mode === 'schedule'}
          <div class="dialog-form">
            <div class="dialog-row-group">
              <div class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Agent</div>
                  <div class="dialog-row-description">Choose the agent that will run this scheduled task.</div>
                </div>
                <AppSelect class="dialog-row-control" bind:value={scheduleAgentId} options={scheduleCapableAgents.map((agent) => ({ value: agent.id, label: agent.name }))} ariaLabel="Agent" />
              </div>

              <label class="dialog-row dialog-row-stacked">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Prompt</div>
                  <div class="dialog-row-description">Describe the recurring task you want the agent to run.</div>
                </div>
                <textarea class="input-shell min-h-[120px] w-full" bind:value={schedulePrompt} placeholder="Write the scheduled prompt..."></textarea>
              </label>

              <div class="dialog-row dialog-row-stacked">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Target</div>
                  <div class="dialog-row-description">Start fresh or attach the scheduled prompt to an existing session.</div>
                </div>
                <div class="dialog-segmented dialog-segmented-two">
                  <button class={`action-btn dialog-segmented-button ${scheduleMode === 'new' ? 'dialog-segmented-button-active' : ''}`} type="button" onclick={() => (scheduleMode = 'new')}>
                    <Plus size={15} />
                    New session
                  </button>
                  <button class={`action-btn dialog-segmented-button ${scheduleMode === 'existing' ? 'dialog-segmented-button-active' : ''}`} type="button" onclick={() => { scheduleMode = 'existing'; scheduleAdvanced = true; }}>
                    <Link size={15} />
                    Existing session
                  </button>
                </div>
              </div>

              {#if scheduleMode === 'new'}
                <label class="dialog-row">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">Workspace</div>
                    <div class="dialog-row-description">Run in this workspace path.</div>
                  </div>
                  <input class="input-shell dialog-row-control" bind:value={scheduleWorkspace} placeholder="Workspace path" />
                </label>
              {:else}
                <div class="dialog-row">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">Session</div>
                    <div class="dialog-row-description">Attach follow-up work to this session.</div>
                  </div>
                  <AppSelect class="dialog-row-control" bind:value={scheduleSessionId} options={[{ value: '', label: 'Select session...' }, ...sessionChoices.map((session) => ({ value: session.sessionId, label: sessionLabel(session) }))]} ariaLabel="Session" />
                </div>
              {/if}

              <div class="dialog-row dialog-row-stacked">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Frequency</div>
                  <div class="dialog-row-description">Choose a preset or provide a custom cron expression.</div>
                </div>
                <div class="dialog-segmented dialog-segmented-four">
                  <button class={`action-btn dialog-segmented-button ${schedulePreset === 'hourly' ? 'dialog-segmented-button-active' : ''}`} type="button" onclick={() => { schedulePreset = 'hourly'; scheduleCron = '0 * * * *'; }}>
                    Hourly
                  </button>
                  <button class={`action-btn dialog-segmented-button ${schedulePreset === 'daily' ? 'dialog-segmented-button-active' : ''}`} type="button" onclick={() => { schedulePreset = 'daily'; scheduleCron = '0 9 * * *'; }}>
                    Daily
                  </button>
                  <button class={`action-btn dialog-segmented-button ${schedulePreset === 'weekdays' ? 'dialog-segmented-button-active' : ''}`} type="button" onclick={() => { schedulePreset = 'weekdays'; scheduleCron = '0 9 * * 1-5'; }}>
                    Weekdays
                  </button>
                  <button class={`action-btn dialog-segmented-button ${schedulePreset === 'custom' ? 'dialog-segmented-button-active' : ''}`} type="button" onclick={() => (schedulePreset = 'custom')}>
                    Custom
                  </button>
                </div>
              </div>

              {#if schedulePreset === 'custom'}
                <label class="dialog-row">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">Cron expression</div>
                    <div class="dialog-row-description">Use standard five-field cron syntax.</div>
                  </div>
                  <input class="input-shell dialog-row-control" bind:value={scheduleCron} placeholder="0 9 * * 1-5" />
                </label>
              {/if}
            </div>

            <details class="dialog-row-group dialog-row dialog-row-stacked dialog-advanced" bind:open={scheduleAdvanced}>
              <summary class="dialog-advanced-summary cursor-pointer">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Advanced</div>
                  <div class="dialog-row-description">Limit runs, steps, or estimated cost for this task.</div>
                </div>
                <ChevronDown class="dialog-advanced-chevron" size={17} />
              </summary>
              <div class="dialog-advanced-fields">
                <input class="input-shell" bind:value={scheduleMaxRuns} placeholder="Max runs" />
                <input class="input-shell" bind:value={scheduleMaxSteps} placeholder="Max steps" />
                <input class="input-shell" bind:value={scheduleMaxCost} placeholder="Max cost USD" />
              </div>
            </details>

            {#if formError}
              <div class="alert-error">{formError}</div>
            {/if}

            <div class="dialog-footer">
              <button class="action-btn" type="button" onclick={() => commandPaletteStore.close()}>
                Cancel
              </button>
              <button class="action-btn action-btn-primary" type="button" disabled={submitting} onclick={() => submitSchedule()}>
                <SendHorizontal size={15} />
                Create
              </button>
            </div>
          </div>
        {:else if commandPaletteStore.mode === 'remote-create'}
          <div class="dialog-form">
            <div class="dialog-row-group">
              <div class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Agent</div>
                  <div class="dialog-row-description">Choose the local agent that can reach the mesh.</div>
                </div>
                <AppSelect class="dialog-row-control" value={scheduleAgentId} options={remoteCapableAgents.map((agent) => ({ value: agent.id, label: agent.name }))} ariaLabel="Agent" onValueChange={handleRemoteCreateAgentChange} />
              </div>

              <div class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Node</div>
                  <div class="dialog-row-description">Start the remote session on this mesh node.</div>
                </div>
                <AppSelect class="dialog-row-control" bind:value={remoteNodeId} options={remoteNodeChoices.length > 0 ? remoteNodeChoices : [{ value: '', label: 'No mesh nodes loaded' }]} ariaLabel="Node" disabled={remoteNodeChoices.length === 0} />
              </div>

              <label class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Working directory</div>
                  <div class="dialog-row-description">Leave empty to use the node default.</div>
                </div>
                <input class="input-shell dialog-row-control" bind:value={remoteWorkspace} placeholder="Optional" />
              </label>
            </div>

            {#if formError}
              <div class="alert-error">{formError}</div>
            {/if}

            <div class="dialog-footer">
              <button class="action-btn" type="button" onclick={() => commandPaletteStore.close()}>Cancel</button>
              <button class="action-btn action-btn-primary" type="button" disabled={submitting || !scheduleAgentId || !remoteNodeId} onclick={() => submitRemoteCreate()}>
                <MessageSquarePlus size={15} />
                Create
              </button>
            </div>
          </div>
        {:else}
          <div class="dialog-form">
            <div class="dialog-row-group">
              <div class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Agent</div>
                  <div class="dialog-row-description">Choose the local agent that can reach the mesh.</div>
                </div>
                <AppSelect class="dialog-row-control" value={scheduleAgentId} options={remoteCapableAgents.map((agent) => ({ value: agent.id, label: agent.name }))} ariaLabel="Agent" onValueChange={handleRemoteAttachAgentChange} />
              </div>

              <div class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Node</div>
                  <div class="dialog-row-description">Look up sessions from this mesh node.</div>
                </div>
                <AppSelect class="dialog-row-control" value={attachNodeId} options={remoteNodeChoices.length > 0 ? remoteNodeChoices : [{ value: '', label: 'No mesh nodes loaded' }]} ariaLabel="Node" disabled={remoteNodeChoices.length === 0} onValueChange={handleAttachNodeChange} />
              </div>

              <div class="dialog-row">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Remote sessions</div>
                  <div class="dialog-row-description">
                    {#if !attachNodeId}
                      Select a node to inspect its sessions.
                    {:else if loadedRemoteSessionList}
                      {loadedRemoteSessionList.total_count} session{loadedRemoteSessionList.total_count === 1 ? '' : 's'} found on this node.
                    {:else}
                      Load sessions from the selected node.
                    {/if}
                  </div>
                </div>
                <button class="action-btn dialog-row-action" type="button" disabled={!scheduleAgentId || !attachNodeId || loadingRemoteSessions} onclick={() => loadAttachRemoteSessions()}>
                  <RefreshCw size={14} class={loadingRemoteSessions ? 'animate-spin' : ''} />
                  {loadedRemoteSessionList ? 'Reload' : 'Load'}
                </button>
              </div>

              {#if loadedRemoteSessionList && remoteSessionChoices.length === 0}
                <div class="dialog-row dialog-row-muted">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">Session</div>
                    <div class="dialog-row-description">No remote sessions found on this node.</div>
                  </div>
                </div>
              {:else if remoteSessionChoices.length > 0}
                <div class="dialog-row">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">Session</div>
                    <div class="dialog-row-description">Attach to this remote conversation.</div>
                  </div>
                  <AppSelect class="dialog-row-control" bind:value={attachSessionId} options={[{ value: '', label: 'Select session...' }, ...remoteSessionChoices]} ariaLabel="Remote session" />
                </div>
              {/if}
            </div>

            {#if formError}
              <div class="alert-error">{formError}</div>
            {/if}

            <div class="dialog-footer">
              <button class="action-btn" type="button" onclick={() => commandPaletteStore.close()}>Cancel</button>
              <button class="action-btn action-btn-primary" type="button" disabled={submitting || loadingRemoteSessions || !scheduleAgentId || !attachNodeId || !attachSessionId} onclick={() => submitRemoteAttach()}>
                <Link size={15} />
                Attach
              </button>
            </div>
          </div>
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
