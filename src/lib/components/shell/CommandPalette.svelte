<script lang="ts">
  import { goto } from '$app/navigation';
  import { Bot, CalendarClock, Link, MessageSquarePlus, Network, Plus, Search, SendHorizontal, X } from '@lucide/svelte';
  import { Command, Dialog } from 'bits-ui';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import type { CommandPalettePrefill, DesktopSessionSummary } from '$lib/domain/types';
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
    scheduleAgentId = prefill?.agentId ?? remoteCapableAgents[0]?.id ?? '';
    remoteNodeId = prefill?.nodeId ?? remoteNodeId ?? '';
    remoteWorkspace = prefill?.cwd ?? remoteWorkspace ?? '';
    formError = null;
  }

  function hydrateRemoteAttachState(prefill: CommandPalettePrefill | null) {
    scheduleAgentId = prefill?.agentId ?? remoteCapableAgents[0]?.id ?? '';
    attachNodeId = prefill?.nodeId ?? attachNodeId ?? '';
    attachSessionId = prefill?.sessionId ?? attachSessionId ?? '';
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
</script>

<Dialog.Root bind:open={commandPaletteStore.open}>
  <Dialog.Portal to={portalTarget ?? undefined}>
    <Dialog.Overlay class="model-picker-backdrop" />
    <Dialog.Content
      class="model-picker-modal command-palette-modal !p-0"
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      <div class="border-b border-[var(--border)] px-4 py-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-medium">Command palette</div>
            <div class="muted text-xs">Cmd+P for fast actions and creation flows.</div>
          </div>
          {#if commandPaletteStore.mode !== 'commands'}
            <button class="action-btn !px-3 !py-1.5 text-xs" type="button" onclick={() => commandPaletteStore.setMode('commands')}>
              Back
            </button>
          {/if}
        </div>
      </div>

      <div class="p-4">
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

            <Command.List class="mt-3 max-h-[26rem] overflow-y-auto pr-1">
              <Command.Empty>
                <div class="surface-muted px-3 py-3 text-xs text-[var(--muted)]">
                  No matching commands.
                </div>
              </Command.Empty>

              <Command.Group value="create">
                <Command.GroupHeading class="px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">Create</Command.GroupHeading>
                <Command.GroupItems class="mt-2 space-y-1">
                  {#each commands.filter((item) => item.section === 'Create') as item}
                    <Command.Item
                      value={item.title}
                      keywords={item.keywords}
                      disabled={item.disabled}
                      onSelect={() => item.run()}
                      class={`model-picker-row ${item.disabled ? 'opacity-50' : ''}`}
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
                <Command.GroupItems class="mt-2 space-y-1">
                  {#each commands.filter((item) => item.section === 'Mesh') as item}
                    <Command.Item
                      value={item.title}
                      keywords={item.keywords}
                      disabled={item.disabled}
                      onSelect={() => item.run()}
                      class={`model-picker-row ${item.disabled ? 'opacity-50' : ''}`}
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
                <Command.GroupItems class="mt-2 space-y-1">
                  {#each commands.filter((item) => item.section === 'Navigate') as item}
                    <Command.Item
                      value={item.title}
                      keywords={item.keywords}
                      onSelect={() => item.run()}
                      class="model-picker-row"
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
          </Command.Root>
        {:else if commandPaletteStore.mode === 'schedule'}
          <div class="space-y-4">
            <div>
              <div class="flex items-center gap-2 text-sm font-medium">
                <CalendarClock size={16} />
                Schedule a prompt
              </div>
              <div class="muted mt-1 text-xs">Default is a new background session. Switch to existing only when you want to attach follow-up work.</div>
            </div>

            <label class="space-y-2">
              <span class="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Agent</span>
              <AppSelect class="w-full" bind:value={scheduleAgentId} options={scheduleCapableAgents.map((agent) => ({ value: agent.id, label: agent.name }))} ariaLabel="Agent" />
            </label>

            <div class="grid gap-2">
              <span class="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Prompt</span>
              <textarea class="input-shell min-h-[120px] w-full" bind:value={schedulePrompt} placeholder="Describe the recurring task you want the agent to run."></textarea>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <button class={`action-btn justify-start ${scheduleMode === 'new' ? 'action-btn-primary' : ''}`} type="button" onclick={() => (scheduleMode = 'new')}>
                <Plus size={15} />
                New session
              </button>
              <button class={`action-btn justify-start ${scheduleMode === 'existing' ? 'action-btn-primary' : ''}`} type="button" onclick={() => { scheduleMode = 'existing'; scheduleAdvanced = true; }}>
                <Link size={15} />
                Existing session
              </button>
            </div>

            {#if scheduleMode === 'new'}
              <input class="input-shell w-full" bind:value={scheduleWorkspace} placeholder="Workspace path" />
            {:else}
              <label class="space-y-2">
                <span class="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Session</span>
                <AppSelect class="w-full" bind:value={scheduleSessionId} options={[{ value: '', label: 'Select session...' }, ...sessionChoices.map((session) => ({ value: session.sessionId, label: sessionLabel(session) }))]} ariaLabel="Session" />
              </label>
            {/if}

            <div class="grid gap-3 md:grid-cols-4">
              <button class={`action-btn justify-start ${schedulePreset === 'hourly' ? 'action-btn-primary' : ''}`} type="button" onclick={() => { schedulePreset = 'hourly'; scheduleCron = '0 * * * *'; }}>
                Hourly
              </button>
              <button class={`action-btn justify-start ${schedulePreset === 'daily' ? 'action-btn-primary' : ''}`} type="button" onclick={() => { schedulePreset = 'daily'; scheduleCron = '0 9 * * *'; }}>
                Daily
              </button>
              <button class={`action-btn justify-start ${schedulePreset === 'weekdays' ? 'action-btn-primary' : ''}`} type="button" onclick={() => { schedulePreset = 'weekdays'; scheduleCron = '0 9 * * 1-5'; }}>
                Weekdays
              </button>
              <button class={`action-btn justify-start ${schedulePreset === 'custom' ? 'action-btn-primary' : ''}`} type="button" onclick={() => (schedulePreset = 'custom')}>
                Custom
              </button>
            </div>

            {#if schedulePreset === 'custom'}
              <input class="input-shell w-full" bind:value={scheduleCron} placeholder="Cron expression" />
            {/if}

            <details class="details-reset surface-muted px-4 py-3" bind:open={scheduleAdvanced}>
              <summary class="cursor-pointer text-sm font-medium">Advanced</summary>
              <div class="mt-3 grid gap-3 md:grid-cols-3">
                <input class="input-shell" bind:value={scheduleMaxRuns} placeholder="Max runs" />
                <input class="input-shell" bind:value={scheduleMaxSteps} placeholder="Max steps" />
                <input class="input-shell" bind:value={scheduleMaxCost} placeholder="Max cost USD" />
              </div>
            </details>

            {#if formError}
              <div class="alert-error">{formError}</div>
            {/if}

            <div class="flex justify-end gap-3">
              <button class="action-btn" type="button" onclick={() => commandPaletteStore.close()}>
                <X size={15} />
                Cancel
              </button>
              <button class="action-btn action-btn-primary" type="button" disabled={submitting} onclick={() => submitSchedule()}>
                <SendHorizontal size={15} />
                Create task
              </button>
            </div>
          </div>
        {:else if commandPaletteStore.mode === 'remote-create'}
          <div class="space-y-4">
            <div>
              <div class="flex items-center gap-2 text-sm font-medium">
                <Network size={16} />
                Create remote session
              </div>
              <div class="muted mt-1 text-xs">Start a remote session on a selected mesh node.</div>
            </div>

            <label class="space-y-2">
              <span class="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Agent</span>
              <AppSelect class="w-full" bind:value={scheduleAgentId} options={remoteCapableAgents.map((agent) => ({ value: agent.id, label: agent.name }))} ariaLabel="Agent" />
            </label>

            <input class="input-shell w-full" bind:value={remoteNodeId} placeholder="Node id" />
            <input class="input-shell w-full" bind:value={remoteWorkspace} placeholder="Working directory (optional)" />

            {#if formError}
              <div class="alert-error">{formError}</div>
            {/if}

            <div class="flex justify-end gap-3">
              <button class="action-btn" type="button" onclick={() => commandPaletteStore.close()}>Cancel</button>
              <button class="action-btn action-btn-primary" type="button" disabled={submitting} onclick={() => submitRemoteCreate()}>
                <MessageSquarePlus size={15} />
                Create remote session
              </button>
            </div>
          </div>
        {:else}
          <div class="space-y-4">
            <div>
              <div class="flex items-center gap-2 text-sm font-medium">
                <Bot size={16} />
                Attach remote session
              </div>
              <div class="muted mt-1 text-xs">Attach an existing remote session to continue work on a node.</div>
            </div>

            <label class="space-y-2">
              <span class="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Agent</span>
              <AppSelect class="w-full" bind:value={scheduleAgentId} options={remoteCapableAgents.map((agent) => ({ value: agent.id, label: agent.name }))} ariaLabel="Agent" />
            </label>

            <input class="input-shell w-full" bind:value={attachNodeId} placeholder="Node id" />
            <input class="input-shell w-full" bind:value={attachSessionId} placeholder="Session id" />

            {#if formError}
              <div class="alert-error">{formError}</div>
            {/if}

            <div class="flex justify-end gap-3">
              <button class="action-btn" type="button" onclick={() => commandPaletteStore.close()}>Cancel</button>
              <button class="action-btn action-btn-primary" type="button" disabled={submitting} onclick={() => submitRemoteAttach()}>
                <Link size={15} />
                Attach remote session
              </button>
            </div>
          </div>
        {/if}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
