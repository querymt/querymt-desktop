import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptAttachment } from '$lib/domain/types';
import LandingPage from '../+page.svelte';
import SessionsPage from '../sessions/+page.svelte';
import { groupSessionsByWorkspace } from '$lib/domain/sessions';
import type { DesktopSessionSummary } from '$lib/domain/types';

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
    },
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
    requestPromptFocus: vi.fn(),
    refreshAllSessions: vi.fn(),
    loadWorkspaceSessions: vi.fn(),
    loadMoreWorkspaceSessions: vi.fn(),
    canDeleteSession: vi.fn(() => true),
    deleteSession: vi.fn(),
    createSession: vi.fn(async () => 'session-1'),
    startSessionWithPrompt: vi.fn(async () => 'session-1'),
    getRecentModels: vi.fn(() => []),
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
  it('shows task-oriented launch copy and session preferences', () => {
    render(LandingPage);

    expect(screen.getAllByText('New session')).not.toHaveLength(0);
    expect(screen.getByText('Working in')).toBeInTheDocument();
    expect(screen.getByText('work')).toBeInTheDocument();
    expect(screen.queryByText('Desktop control center')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mode' })).toHaveTextContent('Build');
    expect(screen.getByLabelText('Session options')).toHaveTextContent('Auto');
  });

  it('uses only launch preferences when an existing session is still active in the store', async () => {
    agentsStore.activeAgentId = 'agent-1';
    agentsStore.activeSessionId = 'previous-session';
    render(LandingPage);

    expect(screen.getByRole('button', { name: 'Mode' })).toHaveTextContent('Build');
    await fireEvent.click(screen.getByRole('button', { name: /Claude Sonnet 4/i }));
    const modelRow = screen.getAllByRole('button', { name: /Claude Sonnet 4/i })
      .find((button) => button.classList.contains('app-picker-row'))!;
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
    agentsStore.workspaceSessionGroups = groupSessionsByWorkspace([remoteSession]);

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

  it('resets the target to local for a mixed workspace after selecting a remote host', async () => {
    const localSession: DesktopSessionSummary = {
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'local-1', title: 'Local task',
      cwd: '/shared', updatedAt: '2026-07-18T01:23:00Z', runtimeId: 'agent-1',
      runtimeName: 'QMTCODE', source: 'acp', location: 'local', status: 'idle'
    };
    agentsStore.workspaceSessionGroups = groupSessionsByWorkspace([
      localSession,
      { ...localSession, sessionId: 'remote-1', location: 'remote', remoteNodeId: 'peer-1', remoteNodeLabel: 'Laptop' }
    ]);
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
    agentsStore.workspaceSessionGroups = groupSessionsByWorkspace([
      remoteSession,
      { ...remoteSession, sessionId: 'remote-2', agentId: 'agent-2', remoteNodeId: 'peer-2', remoteNodeLabel: 'Server' }
    ]);

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

    expect(screen.getByRole('button', { name: /Claude Sonnet 4/i })).toHaveTextContent('Claude Sonnet 4 · anthropic');
    expect(screen.getByRole('button', { name: /Claude Sonnet 4/i })).not.toHaveTextContent('QMTCODE');
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
