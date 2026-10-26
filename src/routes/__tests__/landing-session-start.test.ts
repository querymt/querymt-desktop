import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelEntry, PromptAttachment } from '$lib/domain/types';
import { fromStore, writable } from 'svelte/store';
import { getModelSelectionKey } from '$lib/querymt/config-options';
import SessionComposer from '$lib/components/primitives/SessionComposer.svelte';
import LandingPage from '../+page.svelte';
import SessionsPage from '../sessions/+page.svelte';
import { groupSessionsByWorkspace } from '$lib/domain/sessions';
import type { DesktopSessionSummary, SessionBrowserState } from '$lib/domain/types';

function createAgentsStore() {
  return {
    configs: [
      {
        id: 'agent-1',
        name: 'QMTCODE',
        commandLine: '/usr/local/bin/qmtcode --acp',
        enabled: true,
        autoStart: true
      }
    ],
    statuses: {
      'agent-1': {
        agentId: 'agent-1',
        state: 'running',
        commandLine: '/usr/local/bin/qmtcode --acp',
        pid: 1234,
        version: '1.0.0',
        message: 'Running',
        lastError: null
      }
    },
    connectedAgents: [
      {
        id: 'agent-1',
        name: 'QMTCODE',
        commandLine: '/usr/local/bin/qmtcode --acp',
        enabled: true,
        autoStart: true
      }
    ],
    meshNodesByAgent: {} as Record<string, { nodes: Array<{ id: string; label: string; active_sessions: number }> }>,
    meshStatusByAgent: {} as Record<string, { peer_id?: string; hostname?: string }>,
    activeSessionId: null as string | null,
    activeAgentId: null as string | null,
    activeSession: { runState: 'idle' },
    composerCwd: '/tmp/work',
    composerPrompt: '',
    launchModelIds: { 'agent-1': 'anthropic/claude-sonnet-4' } as Record<string, string>,
    composerProfileId: 'default',
    composerModeId: 'build',
    composerReasoningId: 'auto',
    composerTargetId: 'local',
    composerAgentId: null as string | null,
    workspaceSessionGroups: [] as ReturnType<typeof groupSessionsByWorkspace>,
    sessionBrowser: { query: '', resolution: 'any', archive: 'any', runtime: 'all', location: 'all', openGroups: [], groupsInitialized: false, visibleLimits: {}, scrollTop: 0 } as SessionBrowserState,
    sessionCatalog: [] as DesktopSessionSummary[],
    sessionCatalogLoading: false,
    sessionCatalogLoadedCount: 0,
    sessionCatalogError: null as string | null,
    sessionCatalogExcludedAgents: [],
    sessionCatalogSupportedAgentCount: 1,
    sessionCatalogHasSessions: null as boolean | null,
    sessionLifecycleRevision: 0,
    sessionLifecyclePending: {},
    sessionLifecycleErrors: {},
    connectionStates: { 'agent-1': 'initialized' } as Record<string, string>,
    pinnedSessions: [] as DesktopSessionSummary[],
    sessionPinPending: {}, sessionPinErrors: {},
    canPinSession: vi.fn(() => false),
    setSessionPinned: vi.fn(),
    ensurePinnedSessions: vi.fn(async () => {}),
    canSetSessionLifecycle: vi.fn(() => true),
    setSessionLifecycle: vi.fn(),
    refreshSessionCatalog: vi.fn(),
    ensureSessionCatalog: vi.fn(),
    promptAttachments: [] as PromptAttachment[],
    promptFocusToken: 0,
    loading: false,
    error: null as string | null,
    modelsByAgent: {
      'agent-1': [
        {
          id: 'anthropic/claude-sonnet-4',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          label: 'Claude Sonnet 4'
        }
      ]
    } as Record<string, ModelEntry[]>,
    modelInfoByAgent: { 'agent-1': {} },
    modelLoadingByAgent: { 'agent-1': false },
    setComposerCwd: vi.fn((value: string) => {
      agentsStore.composerCwd = value;
    }),
    setComposerPrompt: vi.fn((value: string) => {
      agentsStore.composerPrompt = value;
    }),
    getLaunchModelId: vi.fn((agentId: string | null | undefined) =>
      agentId ? (agentsStore.launchModelIds[agentId] ?? '') : ''),
    setLaunchModel: vi.fn(async (agentId: string | null | undefined, value: string) => {
      if (agentId) agentsStore.launchModelIds[agentId] = value;
    }),
    refreshModelsForAgent: vi.fn(async () => undefined),
    refreshRemoteProfiles: vi.fn(async () => undefined),
    getLaunchProfileError: vi.fn((): string | null => null),
    clearLaunchProfileError: vi.fn(),
    clearError: vi.fn(),
    addPromptAttachments: vi.fn(),
    removePromptAttachment: vi.fn(),
    setComposerProfile: vi.fn(),
    setComposerMode: vi.fn((value: string) => {
      agentsStore.composerModeId = value;
    }),
    setComposerReasoning: vi.fn((value: string) => {
      agentsStore.composerReasoningId = value;
    }),
    setComposerTarget: vi.fn((value: string) => { agentsStore.composerTargetId = value; }),
    setComposerAgent: vi.fn((value: string | null) => { agentsStore.composerAgentId = value; }),
    composerWorkspaceMode: 'local',
    canCreateWorktree: vi.fn((_agentId: string | null) => false),
    setComposerWorkspaceMode: vi.fn(),
    requestPromptFocus: vi.fn(),
    refreshAllSessions: vi.fn(),
    loadWorkspaceSessions: vi.fn(),
    loadMoreWorkspaceSessions: vi.fn(),
    canDeleteSession: vi.fn(() => true),
    deleteSession: vi.fn(),
    createSession: vi.fn(async (): Promise<string | null> => 'session-1'),
    startSessionWithPrompt: vi.fn(async () => 'session-1'),
    getRecentModels: vi.fn((): ModelEntry[] => []),
    getRecentWorkspaces: vi.fn(() => []),
    getProfileOptions: vi.fn(() => []),
    getTargetOptions: vi.fn((agentId: string | null) => [
      { id: 'local', label: 'Local' },
      ...(agentsStore.meshNodesByAgent[agentId ?? '']?.nodes ?? []).map((node: { id: string; label: string }) => ({ id: node.id, label: node.label }))
    ])
  };
}

const goto = vi.hoisted(() => vi.fn(async () => undefined));
const agentsStore = vi.hoisted(() => createAgentsStore());

vi.mock('$lib/components/primitives/SessionComposer.svelte', { spy: true });
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/stores/agents.svelte', () => ({
  agentsStore,
  LAUNCH_MODE_OPTIONS: [
    { id: 'build', label: 'Build' },
    { id: 'plan', label: 'Plan' },
    { id: 'review', label: 'Review' }
  ],
  LAUNCH_REASONING_OPTIONS: [
    { id: 'auto', label: 'Auto' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'max', label: 'Max' }
  ]
}));
vi.mock('$lib/stores/chat-preferences.svelte', () => ({ chatPreferencesStore: { sendShortcut: 'enter' } }));
vi.mock('$lib/stores/inbox.svelte', () => ({ inboxStore: { pendingCount: 0 } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.assign(agentsStore, createAgentsStore());
});

describe('Landing page session start', () => {
  it('shows task-oriented launch copy and session preferences', async () => {
    render(LandingPage);

    expect(screen.getAllByText('New session')).not.toHaveLength(0);
    expect(screen.getByText('Working in')).toBeInTheDocument();
    expect(screen.getByText('work')).toBeInTheDocument();
    expect(screen.queryByText('Desktop control center')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mode' })).toHaveTextContent('Build');
    expect(screen.queryByLabelText('Session options')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Claude Sonnet 4/i }));
    expect(screen.getByRole('button', { name: 'Reasoning effort' })).toHaveTextContent('Auto');
    expect(screen.getByText('How deeply the agent should think')).toBeInTheDocument();
  });

  it.each([false, true])('updates picker locality when the launch target changes without selecting another model (recent=%s)', async (recent) => {
    const local = agentsStore.modelsByAgent['agent-1'][0];
    const flkr = { ...local, node_id: 'B', node_label: 'flkr' };
    const other = { ...local, node_id: 'C', node_label: 'eulr' };
    agentsStore.modelsByAgent['agent-1'] = [local, flkr, other];
    agentsStore.meshStatusByAgent['agent-1'] = { peer_id: 'A', hostname: 'lstr' };
    agentsStore.meshNodesByAgent['agent-1'] = { nodes: [{ id: 'B', label: 'flkr', active_sessions: 0 }] };
    agentsStore.launchModelIds['agent-1'] = getModelSelectionKey(flkr);
    agentsStore.getRecentModels.mockReturnValue(recent ? [local, flkr, other] : []);
    // The real store uses $state; make this mock's target reactive as well.
    const target = fromStore(writable('local'));
    const original = Object.getOwnPropertyDescriptor(agentsStore, 'composerTargetId')!;
    Object.defineProperty(agentsStore, 'composerTargetId', {
      configurable: true, get: () => target.current, set: (value) => { target.current = value; }
    });
    try {
      render(LandingPage);
      await fireEvent.click(screen.getByRole('button', { name: /^Claude Sonnet 4 from anthropic on flkr/ }));
      expect(screen.getByLabelText('Mesh node flkr')).toBeInTheDocument();
      expect(screen.queryByLabelText('Mesh node lstr')).not.toBeInTheDocument();
      await fireEvent.click(screen.getByRole('button', { name: 'Done' }));

      agentsStore.setComposerTarget('B');
      const trigger = await screen.findByRole('button', { name: /^Claude Sonnet 4 from anthropic;/ });
      expect(trigger.querySelector('.composer-model-pill-node')).toBeNull();
      await fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: 'Switch model' });
      expect(within(dialog).queryByLabelText('Mesh node flkr')).not.toBeInTheDocument();
      expect(within(dialog).getByLabelText('Mesh node lstr')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Mesh node eulr')).toBeInTheDocument();
      const selected = within(dialog).getAllByRole('button').find((button) => button.getAttribute('aria-pressed') === 'true')!;
      expect(within(selected).queryByLabelText(/Mesh node/)).not.toBeInTheDocument();
      if (!recent) expect(within(dialog).getByText('anthropic · lstr')).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('button', { name: 'Done' }));

      agentsStore.setComposerTarget('local');
      expect(await screen.findByRole('button', { name: /^Claude Sonnet 4 from anthropic on flkr/ })).toBeInTheDocument();
      expect(agentsStore.getLaunchModelId('agent-1')).toBe(getModelSelectionKey(flkr));
      expect(agentsStore.setLaunchModel).not.toHaveBeenCalled();
      expect(agentsStore.createSession).not.toHaveBeenCalled();
      expect(agentsStore.startSessionWithPrompt).not.toHaveBeenCalled();
    } finally {
      cleanup();
      Object.defineProperty(agentsStore, 'composerTargetId', original);
    }
  });

  it('uses only launch preferences when an existing session is still active in the store', async () => {
    agentsStore.activeAgentId = 'agent-1';
    agentsStore.activeSessionId = 'previous-session';
    render(LandingPage);

    expect(screen.getByRole('button', { name: 'Mode' })).toHaveTextContent('Build');
    await fireEvent.click(screen.getByRole('button', { name: /Claude Sonnet 4/i }));
    const modelRow = screen.getAllByRole('button', { name: /Claude Sonnet 4/i })
      .find((button) => button.classList.contains('delegate-model-choice'))!;
    await fireEvent.click(modelRow);

    expect(agentsStore.setLaunchModel).toHaveBeenCalledWith('agent-1', 'anthropic/claude-sonnet-4');
    expect(agentsStore.activeSessionId).toBe('previous-session');
  });

  it('opens the new session as soon as session creation resolves', async () => {
    agentsStore.startSessionWithPrompt.mockResolvedValue('session-1');
    agentsStore.composerPrompt = 'Draft prompt';

    render(LandingPage);

    const prompt = screen.getByPlaceholderText('Ask QueryMT to inspect, change, debug, explain, or plan something.');
    await fireEvent.input(prompt, { target: { value: 'Fix the failing tests' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(agentsStore.setComposerPrompt).toHaveBeenCalledWith('Fix the failing tests');
    expect(agentsStore.startSessionWithPrompt).toHaveBeenCalledWith('agent-1');
    await waitFor(() => {
      expect(goto).toHaveBeenCalledWith('/sessions/agent-1/session-1');
    });
  });

  it('dismisses the selected owner profile error as well as the general error', async () => {
    agentsStore.composerTargetId = 'peer-1';
    const profileError = fromStore(writable<string | null>('Owner profiles unavailable'));
    agentsStore.getLaunchProfileError.mockImplementation(() => profileError.current);
    agentsStore.clearLaunchProfileError.mockImplementation(() => { profileError.current = null; });
    render(LandingPage);
    expect(screen.getByText('Owner profiles unavailable')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));

    expect(agentsStore.clearLaunchProfileError).toHaveBeenCalledWith('agent-1');
    expect(agentsStore.clearError).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText('Owner profiles unavailable')).not.toBeInTheDocument());
  });

  it.each([null, 'new-session'])('uses only a successful blank-session callback result for navigation (%s)', async (created) => {
    agentsStore.activeAgentId = 'previous-agent';
    agentsStore.activeSessionId = 'previous-session';
    agentsStore.createSession.mockResolvedValueOnce(created);
    render(LandingPage);
    // Launch mode hides this secondary action; exercise the supplied callback directly.
    const onCreateSession = vi.mocked(SessionComposer).mock.calls.at(-1)![1].onCreateSession!;
    await onCreateSession();

    expect(agentsStore.createSession).toHaveBeenCalledWith('agent-1');
    if (created) expect(goto).toHaveBeenCalledExactlyOnceWith('/sessions/agent-1/new-session');
    else expect(goto).not.toHaveBeenCalled();
  });

  it('offers the Workspace choice for the launcher agent even when no composer agent is set', async () => {
    agentsStore.composerAgentId = null;
    agentsStore.canCreateWorktree.mockImplementation((agentId: string | null) => agentId === 'agent-1');
    render(LandingPage);
    const props = vi.mocked(SessionComposer).mock.calls.at(-1)![1];
    expect(props.workspaceModeOptions?.length).toBeGreaterThan(1);

    props.onWorkspaceModeChange!('worktree');
    expect(agentsStore.setComposerWorkspaceMode).toHaveBeenCalledWith('worktree', 'agent-1');
  });

  it('starts an attachment-only landing session without clearing wiring prematurely', async () => {
    agentsStore.promptAttachments = [{ id: 'img-1', name: 'photo.png', mimeType: 'image/png', size: 3, data: 'aW1n' }];
    render(LandingPage);

    expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(agentsStore.startSessionWithPrompt).toHaveBeenCalledWith('agent-1');
    expect(agentsStore.promptAttachments).toHaveLength(1);
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/sessions/agent-1/session-1'));
  });

  it('preselects the owning remote host and agent when creating from a remote workspace', async () => {
    agentsStore.connectedAgents.push({ ...agentsStore.connectedAgents[0], id: 'agent-2', name: 'Second agent' });
    agentsStore.configs.push({ ...agentsStore.configs[0], id: 'agent-2', name: 'Second agent' });
    agentsStore.meshNodesByAgent['agent-2'] = { nodes: [{ id: 'peer-2', label: 'Laptop', active_sessions: 1 }] };
    const remoteSession: DesktopSessionSummary = {
      agentId: 'agent-2', agentName: 'Second agent', sessionId: 'remote-1', title: 'Remote task',
      cwd: '/remote/work', updatedAt: '2026-07-18T01:23:00Z', runtimeId: 'agent-2',
      runtimeName: 'Second agent', source: 'acp', location: 'remote', remoteNodeId: 'peer-2',
      remoteNodeLabel: 'Laptop', status: 'idle'
    };
    agentsStore.sessionCatalog = [remoteSession];

    render(SessionsPage);
    await fireEvent.click(screen.getByRole('button', { name: 'New session in work' }));
    expect(agentsStore.setComposerCwd).toHaveBeenCalledWith('/remote/work');
    expect(agentsStore.setComposerAgent).toHaveBeenCalledWith('agent-2');
    expect(agentsStore.setComposerTarget).toHaveBeenCalledWith('peer-2');
    expect(goto).toHaveBeenCalledWith('/');

    cleanup();
    render(LandingPage);
    await fireEvent.click(screen.getByLabelText('Session options'));
    expect(screen.getByRole('button', { name: 'Session target' })).toHaveTextContent('Laptop');
    await fireEvent.click(screen.getByRole('button', { name: 'Start blank session' }));
    expect(agentsStore.startSessionWithPrompt).toHaveBeenCalledWith('agent-2');
  });

  it('closes the delete dialog after confirmation without waiting for a catalog refresh', async () => {
    agentsStore.sessionBrowser = { ...agentsStore.sessionBrowser, query: '', groupsInitialized: true, openGroups: ['/tmp/work'] };
    agentsStore.sessionCatalog = [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'task', title: 'Task to delete',
      cwd: '/tmp/work', updatedAt: '2026-07-18T01:23:00Z', runtimeId: 'agent-1',
      runtimeName: 'QMTCODE', source: 'acp', location: 'local', status: 'idle'
    }];
    agentsStore.sessionCatalogLoading = true;
    agentsStore.refreshSessionCatalog.mockImplementation(() => new Promise(() => {}));
    let confirm!: () => void;
    agentsStore.deleteSession.mockImplementationOnce(() => new Promise<void>((resolve) => { confirm = resolve; }));
    render(SessionsPage);
    await fireEvent.click(await screen.findByLabelText('Session actions for Task to delete'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete session Task to delete' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    confirm();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(agentsStore.deleteSession).toHaveBeenCalledWith('agent-1', 'task');
    expect(agentsStore.refreshSessionCatalog).not.toHaveBeenCalled();
  });

  it('resets the target to local for a mixed workspace after selecting a remote host', async () => {
    const localSession: DesktopSessionSummary = {
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'local-1', title: 'Local task',
      cwd: '/shared', updatedAt: '2026-07-18T01:23:00Z', runtimeId: 'agent-1',
      runtimeName: 'QMTCODE', source: 'acp', location: 'local', status: 'idle'
    };
    agentsStore.sessionCatalog = [
      localSession,
      { ...localSession, sessionId: 'remote-1', location: 'remote', remoteNodeId: 'peer-1', remoteNodeLabel: 'Laptop' }
    ];
    agentsStore.composerTargetId = 'peer-1';
    agentsStore.composerAgentId = 'agent-2';

    render(SessionsPage);
    await fireEvent.click(screen.getByLabelText('New session in shared'));
    await fireEvent.click(screen.getByRole('button', { name: 'Local' }));
    expect(agentsStore.setComposerCwd).toHaveBeenCalledWith('/shared');
    expect(agentsStore.setComposerTarget).toHaveBeenCalledWith('local');
    expect(agentsStore.setComposerAgent).toHaveBeenCalledWith('agent-1');

    await fireEvent.click(screen.getByLabelText('New session in shared'));
    await fireEvent.click(screen.getByRole('button', { name: 'Laptop' }));
    expect(agentsStore.setComposerTarget).toHaveBeenLastCalledWith('peer-1');
    expect(agentsStore.setComposerAgent).toHaveBeenLastCalledWith('agent-1');
  });

  it('asks for the host when a remote workspace spans multiple peers', async () => {
    const remoteSession: DesktopSessionSummary = {
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'remote-1', title: 'Remote task',
      cwd: '/shared', updatedAt: '2026-07-18T01:23:00Z', runtimeId: 'agent-1',
      runtimeName: 'QMTCODE', source: 'acp', location: 'remote', remoteNodeId: 'peer-1',
      remoteNodeLabel: 'Laptop', status: 'idle'
    };
    agentsStore.sessionCatalog = [
      remoteSession,
      { ...remoteSession, sessionId: 'remote-2', agentId: 'agent-2', remoteNodeId: 'peer-2', remoteNodeLabel: 'Server' }
    ];

    render(SessionsPage);
    await fireEvent.click(screen.getByLabelText('New session in shared'));
    expect(agentsStore.setComposerTarget).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Server' }));
    expect(agentsStore.setComposerTarget).toHaveBeenCalledWith('peer-2');
    expect(agentsStore.setComposerAgent).toHaveBeenCalledWith('agent-2');
  });

  it('hides the agent suffix when stopped or disabled agents are also configured', () => {
    agentsStore.configs.push(
      {
        id: 'agent-stopped',
        name: 'Stopped Agent',
        commandLine: '/usr/local/bin/stopped-agent --acp',
        enabled: true,
        autoStart: false
      },
      {
        id: 'agent-disabled',
        name: 'Disabled Agent',
        commandLine: '/usr/local/bin/disabled-agent --acp',
        enabled: false,
        autoStart: false
      }
    );

    render(LandingPage);

    const modelButton = screen.getByRole('button', { name: /Claude Sonnet 4 from anthropic/i });
    expect(modelButton).toHaveTextContent('Claude Sonnet 4');
    expect(modelButton).not.toHaveTextContent('anthropic');
    expect(modelButton).not.toHaveTextContent('QMTCODE');
  });

  it('shows the agent suffix when multiple agents are connected', () => {
    agentsStore.connectedAgents.push({
      id: 'agent-2',
      name: 'WS-QMT',
      commandLine: '/usr/local/bin/querymt --acp',
      enabled: true,
      autoStart: true
    });

    render(LandingPage);

    expect(screen.getByRole('button', { name: /Claude Sonnet 4/i })).toHaveTextContent('QMTCODE');
  });
});
