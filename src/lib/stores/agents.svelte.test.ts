import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitializeResponse, PromptResponse, SessionConfigOption, SessionNotification } from '@agentclientprotocol/sdk';
import { getModelSelectionKey } from '$lib/querymt/config-options';
import { AgentsStore } from './agents.svelte';

const mockListManagedProfiles = vi.hoisted(() => vi.fn(async () => []));

const mockClient = vi.hoisted(() => {
  let sessionUpdateHandler: ((notification: SessionNotification) => void) | null = null;
  let connectionLossHandler: ((reason: string) => void) | null = null;
  let permissionUnsubscribe = vi.fn();
  let elicitationUnsubscribe = vi.fn();

  return {
    connect: vi.fn(async (): Promise<InitializeResponse> => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: []
    })),
    createSession: vi.fn(async (): Promise<{ sessionId: string; configOptions: SessionConfigOption[] }> => ({
      sessionId: 'session-1',
      configOptions: []
    })),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    deleteSession: vi.fn(async () => undefined),
    loadSession: vi.fn(async (_sessionId?: string, _cwd?: string): Promise<Record<string, unknown> & { configOptions: SessionConfigOption[] }> => ({
      configOptions: []
    })),
    sendPrompt: vi.fn(async (): Promise<PromptResponse> => ({ stopReason: 'end_turn' })),
    cancelSession: vi.fn(async () => undefined),
    supportsQuerymtMethod: vi.fn(() => true),
    getUndoStack: vi.fn(async (): Promise<{ undo_stack: Array<{ message_id: string }> }> => ({ undo_stack: [] })),
    undoSession: vi.fn(async (_sessionId: string, messageId: string) => ({
      success: true,
      message_id: messageId,
      reverted_files: ['src/app.ts'],
      undo_stack: [{ message_id: messageId }]
    })),
    redoSession: vi.fn(async () => ({ success: true, restored: true, undo_stack: [] })),
    forkSession: vi.fn(async () => ({ sessionId: 'fork-session' })),
    getInitializeResponse: vi.fn(() => ({
      protocolVersion: 1,
      agentCapabilities: {},
      authMethods: []
    })),
    getControlCapabilities: vi.fn(() => null),
    getControlHealth: vi.fn(() => ({ state: 'unknown', summary: 'unknown', missingMethods: [], missingFeatures: [] })),
    listModels: vi.fn(async () => []),
    getModelInfo: vi.fn(async () => ({})),
    onConnectionLost: vi.fn((handler: (reason: string) => void) => {
      connectionLossHandler = handler;
      return () => {
        connectionLossHandler = null;
      };
    }),
    emitConnectionLoss: (reason: string) => connectionLossHandler?.(reason),
    disconnect: vi.fn(async () => undefined),
    onSessionUpdate: vi.fn((handler: (notification: SessionNotification) => void) => {
      sessionUpdateHandler = handler;
    }),
    emitSessionUpdate: (notification: SessionNotification) => sessionUpdateHandler?.(notification),
    resetSessionUpdateHandler: () => {
      sessionUpdateHandler = null;
      permissionUnsubscribe = vi.fn();
      elicitationUnsubscribe = vi.fn();
    },
    permissionUnsubscribe: () => permissionUnsubscribe,
    elicitationUnsubscribe: () => elicitationUnsubscribe,
    onExtensionNotification: vi.fn(() => () => undefined),
    onPermissionRequest: vi.fn(() => permissionUnsubscribe),
    onElicitationRequest: vi.fn(() => elicitationUnsubscribe),
    setSessionConfigOption: vi.fn(async (): Promise<SessionConfigOption[]> => [])
  };
});

vi.mock('$lib/querymt/profile-templates', () => ({
  listManagedProfiles: mockListManagedProfiles
}));

vi.mock('$lib/querymt/acp-client', () => ({
  DesktopAcpClient: vi.fn(function () {
    return mockClient;
  })
}));

vi.mock('$lib/querymt/sidecar', () => ({
  drainAgentSessionUpdates: vi.fn(async () => []),
  getAgentLogs: vi.fn(async () => []),
  getAgentStatus: vi.fn(async () => ({ state: 'running' })),
  restartAgent: vi.fn(async () => ({ state: 'running' })),
  startAgent: vi.fn(async () => ({ state: 'running' })),
  stopAgent: vi.fn(async () => ({ state: 'stopped' })),
  validateWorkspaceDirectory: vi.fn(async () => true)
}));

function createStore() {
  const store = new AgentsStore();
  store.configs = [
    {
      id: 'agent-1',
      name: 'QMTCODE',
      transport: 'stdio',
      commandLine: '/usr/local/bin/qmtcode --acp',
      enabled: true,
      autoStart: true
    }
  ];
  store.statuses = {
    'agent-1': {
      agentId: 'agent-1',
      state: 'running',
      commandLine: '/usr/local/bin/qmtcode --acp',
      pid: 1234,
      version: '1.0.0',
      message: 'Running',
      lastError: null
    }
  };
  store.composerCwd = '/tmp/work';
  store.composerPrompt = 'Fix the failing tests';
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListManagedProfiles.mockResolvedValue([]);
  mockClient.resetSessionUpdateHandler();
});

describe('AgentsStore connections', () => {
  it('completes workspace discovery during initialization when profile loading fails', async () => {
    const store = createStore();
    mockListManagedProfiles.mockRejectedValueOnce(new Error('profile service unavailable'));
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        sessions: [{ sessionId: 'session-a', title: 'A', cwd: '/tmp/a', updatedAt: '2026-07-18T12:00:00Z' }],
        nextCursor: 'opaque-global-page-2'
      })
      .mockResolvedValueOnce({
        sessions: [{ sessionId: 'session-b', title: 'B', cwd: '/tmp/b', updatedAt: '2026-07-17T12:00:00Z' }]
      });

    await store.initialize();

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, {});
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, { cursor: 'opaque-global-page-2' });
    expect(store.workspaceSessionGroups.map((group) => group.cwd)).toEqual(['/tmp/a', '/tmp/b']);
    expect(store.loading).toBe(false);
  });

  it('does not reconnect or replace inbox handlers when already initialized', async () => {
    const store = createStore();

    await store.connectAgent('agent-1');
    await store.connectAgent('agent-1');

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.onPermissionRequest).toHaveBeenCalledTimes(1);
    expect(mockClient.onElicitationRequest).toHaveBeenCalledTimes(1);
    expect(mockClient.permissionUnsubscribe()).not.toHaveBeenCalled();
    expect(mockClient.elicitationUnsubscribe()).not.toHaveBeenCalled();
  });

  it('loads a session without unbinding inbox handlers', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [
        {
          agentId: 'agent-1',
          agentName: 'QMTCODE',
          sessionId: 'session-1',
          title: 'Question session',
          cwd: '/tmp/work',
          updatedAt: '2026-07-18T17:00:00Z',
          runtimeId: 'agent-1',
          runtimeName: 'QMTCODE',
          source: 'acp',
          status: 'idle'
        }
      ]
    };

    await store.connectAgent('agent-1');
    await store.loadSession('agent-1', 'session-1');

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.loadSession).toHaveBeenCalledWith('session-1', '/tmp/work');
    expect(mockClient.permissionUnsubscribe()).not.toHaveBeenCalled();
    expect(mockClient.elicitationUnsubscribe()).not.toHaveBeenCalled();
  });

  it('forks at the selected message, refreshes sessions, and inserts a fallback summary', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Original', cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    await store.loadSession('agent-1', 'session-1');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [] });

    await expect(store.forkActiveSessionAt('assistant-2')).resolves.toBe('fork-session');

    expect(mockClient.forkSession).toHaveBeenCalledWith('session-1', '/tmp/work', 'assistant-2');
    expect(store.sessionsByAgent['agent-1']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'fork-session',
        title: 'Fork of Original',
        cwd: '/tmp/work',
        parentSessionId: 'session-1',
        forkOrigin: 'user',
        hasChildren: false,
        forkCount: 0
      }),
      expect.objectContaining({ sessionId: 'session-1', hasChildren: true, forkCount: 1 })
    ]));
    expect(store.activeSessionId).toBe('session-1');
  });

  it('blocks fork requests while the agent is active', async () => {
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.runState = 'thinking';

    await expect(store.forkActiveSessionAt('assistant-1')).resolves.toBeNull();
    expect(mockClient.forkSession).not.toHaveBeenCalled();
  });

  it('hydrates the server-authoritative undo stack with session history', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'A', cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    mockClient.getUndoStack.mockResolvedValueOnce({ undo_stack: [{ message_id: 'm2' }] });

    await store.loadSession('agent-1', 'session-1');

    expect(mockClient.getUndoStack).toHaveBeenCalledWith('session-1');
    expect(store.activeSession.undo.stack).toEqual(['m2']);
  });

  it('undoes a targeted turn, restores its prompt, and reloads the session', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'A', cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    await store.loadSession('agent-1', 'session-1');
    store.activeSession.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'Change the app', messageId: 'm1' }
    ];
    store.composerPrompt = '';

    await expect(store.undoActiveSessionTo('m1')).resolves.toBe(true);

    expect(mockClient.undoSession).toHaveBeenCalledWith('session-1', 'm1');
    expect(store.composerPrompt).toBe('Change the app');
    expect(mockClient.loadSession).toHaveBeenCalledTimes(2);
  });

  it('redos the latest stack frame and reloads the session', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'A', cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    await store.loadSession('agent-1', 'session-1');
    store.activeSession.undo.stack = ['m1'];

    await expect(store.redoActiveSession()).resolves.toBe(true);

    expect(mockClient.redoSession).toHaveBeenCalledWith('session-1');
    expect(mockClient.loadSession).toHaveBeenCalledTimes(2);
  });

  it('restores each loaded session model from its snapshot without changing the agent session', async () => {
    const store = createStore();
    const anthropic = {
      id: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      label: 'Claude Sonnet 4'
    };
    const openai = {
      id: 'openai/gpt-5',
      provider: 'openai',
      model: 'gpt-5',
      label: 'GPT-5'
    };
    store.modelsByAgent = { 'agent-1': [anthropic, openai] };
    store.sessionsByAgent = {
      'agent-1': [
        {
          agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-a', title: 'A', cwd: '/tmp/work',
          updatedAt: '2026-07-18T17:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
        },
        {
          agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-b', title: 'B', cwd: '/tmp/work',
          updatedAt: '2026-07-18T16:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
        }
      ]
    };
    mockClient.loadSession.mockImplementation(async (sessionId?: string) => ({
      configOptions: [],
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [{
              kind: {
                type: 'provider_changed',
                data: sessionId === 'session-a'
                  ? { provider: 'anthropic', model: 'claude-sonnet-4' }
                  : { provider: 'openai', model: 'gpt-5' }
              }
            }]
          }
        }
      }
    }));

    await store.loadSession('agent-1', 'session-a');
    expect(store.composerModelId).toBe(anthropic.id);
    await store.loadSession('agent-1', 'session-b');
    expect(store.composerModelId).toBe(openai.id);
    await store.loadSession('agent-1', 'session-a');
    expect(store.composerModelId).toBe(anthropic.id);
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it('restores the mesh copy when the snapshot and ACP model id refer to the same remote model', async () => {
    const store = createStore();
    const localModel = {
      id: 'anthropic/claude-sonnet-4', provider: 'anthropic', model: 'claude-sonnet-4', label: 'Claude Sonnet 4'
    };
    const remoteModel = { ...localModel, node_id: 'node-1', node_label: 'Build server' };
    store.modelsByAgent = { 'agent-1': [localModel, remoteModel] };
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Remote', cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    mockClient.loadSession.mockResolvedValueOnce({
      configOptions: [{
        id: 'model', name: 'Model', type: 'select', currentValue: localModel.id,
        options: [{ value: localModel.id, name: localModel.label }]
      }],
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: { events: [{ kind: { type: 'provider_changed', data: {
            provider: remoteModel.provider, model: remoteModel.model, provider_node_id: remoteModel.node_id
          } } }] }
        }
      }
    });

    await store.loadSession('agent-1', 'session-1');

    expect(store.composerModelId).toBe(getModelSelectionKey(remoteModel));
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it('sends the exact selected mesh entry while keeping the ACP model value canonical', async () => {
    const store = createStore();
    const localModel = {
      id: 'anthropic/claude-sonnet-4', provider: 'anthropic', model: 'claude-sonnet-4', label: 'Claude Sonnet 4'
    };
    const remoteModel = { ...localModel, node_id: 'node-1', node_label: 'Build server' };
    store.modelsByAgent = { 'agent-1': [localModel, remoteModel] };
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';

    await store.setComposerModel(getModelSelectionKey(remoteModel));

    expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      configId: 'model',
      value: remoteModel.id,
      _meta: { querymt: { modelEntry: remoteModel } }
    }));
    expect(store.composerModelId).toBe(getModelSelectionKey(remoteModel));
    expect(store.getRecentModels('agent-1')).toEqual([remoteModel]);
  });
});

describe('AgentsStore agent availability', () => {
  it('only includes enabled agents that are running without a failed connection', () => {
    const store = createStore();
    const baseStatus = store.statuses['agent-1'];
    store.configs = [
      ...store.configs,
      {
        id: 'agent-stopped',
        name: 'Stopped Agent',
        transport: 'stdio',
        commandLine: '/usr/local/bin/stopped-agent --acp',
        enabled: true,
        autoStart: false
      },
      {
        id: 'agent-disabled',
        name: 'Disabled Agent',
        transport: 'stdio',
        commandLine: '/usr/local/bin/disabled-agent --acp',
        enabled: false,
        autoStart: false
      },
      {
        id: 'agent-disconnected',
        name: 'Disconnected Agent',
        transport: 'websocket',
        commandLine: '',
        websocketUrl: '127.0.0.1:3030',
        enabled: true,
        autoStart: true
      }
    ];
    store.statuses = {
      ...store.statuses,
      'agent-stopped': { ...baseStatus, agentId: 'agent-stopped', state: 'stopped' },
      'agent-disabled': { ...baseStatus, agentId: 'agent-disabled' },
      'agent-disconnected': { ...baseStatus, agentId: 'agent-disconnected' }
    };
    store.connectionStates = { 'agent-disconnected': 'failed' };

    expect(store.connectedAgents.map((config) => config.id)).toEqual(['agent-1']);
  });
});

describe('AgentsStore prompt session start', () => {
  it('opens a new active session with the user prompt rendered while the agent reply is pending', async () => {
    let resolvePrompt!: () => void;
    mockClient.sendPrompt.mockImplementationOnce(
      () =>
        new Promise<PromptResponse>((resolve) => {
          resolvePrompt = () => resolve({ stopReason: 'end_turn' });
        })
    );
    const store = createStore();

    const sessionId = await store.startSessionWithPrompt('agent-1');

    expect(store.error).toBe(null);
    expect(sessionId).toBe('session-1');
    expect(store.activeSessionId).toBe('session-1');
    expect(store.composerPrompt).toBe('');
    expect(store.activeSession.runState).toBe('thinking');
    expect(store.activeSession.activityLabel).toBe('Waiting for the agent to respond…');
    expect(store.activeSession.transcript).toEqual([
      expect.objectContaining({ kind: 'user_message_chunk', text: 'Fix the failing tests' })
    ]);

    await vi.waitFor(() => {
      expect(mockClient.sendPrompt).toHaveBeenCalledWith('session-1', 'Fix the failing tests', []);
    });
    resolvePrompt();
  });

  it('applies supported launch mode and reasoning before sending the first prompt', async () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: 'mode',
        name: 'Mode',
        type: 'select',
        currentValue: 'build',
        options: [
          { value: 'build', name: 'Build' },
          { value: 'plan', name: 'Plan' },
          { value: 'review', name: 'Review' }
        ]
      },
      {
        id: 'reasoning_effort',
        name: 'Reasoning Effort',
        type: 'select',
        currentValue: 'auto',
        options: [
          { value: 'auto', name: 'Auto' },
          { value: 'high', name: 'High' }
        ]
      }
    ];
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-1', configOptions });
    const order: string[] = [];
    const configuredOptions = (mode: string, reasoning: string): SessionConfigOption[] => [
      { ...configOptions[0], currentValue: mode } as SessionConfigOption,
      { ...configOptions[1], currentValue: reasoning } as SessionConfigOption
    ];
    mockClient.setSessionConfigOption.mockImplementationOnce(async (): Promise<SessionConfigOption[]> => {
      order.push('mode');
      return configuredOptions('plan', 'auto');
    }).mockImplementationOnce(async (): Promise<SessionConfigOption[]> => {
      order.push('reasoning');
      return configuredOptions('plan', 'high');
    });
    mockClient.sendPrompt.mockImplementationOnce(async () => {
      order.push('prompt');
      return { stopReason: 'end_turn' };
    });
    const store = createStore();
    store.setComposerMode('plan');
    store.setComposerReasoning('high');

    const sessionId = await store.startSessionWithPrompt('agent-1');
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalled());

    expect(sessionId).toBe('session-1');
    expect(mockClient.setSessionConfigOption).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sessionId: 'session-1', configId: 'mode', value: 'plan' })
    );
    expect(mockClient.setSessionConfigOption).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionId: 'session-1', configId: 'reasoning_effort', value: 'high' })
    );
    expect(order).toEqual(['mode', 'reasoning', 'prompt']);
    expect(store.composerModeId).toBe('plan');
    expect(store.composerReasoningId).toBe('high');
  });

  it('keeps agent defaults when a launch preference is unsupported', async () => {
    const configOptions: SessionConfigOption[] = [
      {
        id: 'mode',
        name: 'Mode',
        type: 'select',
        currentValue: 'build',
        options: [{ value: 'build', name: 'Build' }]
      },
      {
        id: 'reasoning_effort',
        name: 'Reasoning Effort',
        type: 'select',
        currentValue: 'auto',
        options: [{ value: 'auto', name: 'Auto' }]
      }
    ];
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-1', configOptions });
    const store = createStore();
    store.setComposerMode('review');
    store.setComposerReasoning('max');

    const sessionId = await store.createSession('agent-1');

    expect(sessionId).toBe('session-1');
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
    expect(store.composerModeId).toBe('build');
    expect(store.composerReasoningId).toBe('auto');
  });

  it('creates a blank session without attempting to send an empty prompt', async () => {
    const store = createStore();
    store.composerPrompt = '   ';

    const sessionId = await store.startSessionWithPrompt('agent-1');

    expect(sessionId).toBe('session-1');
    expect(store.activeSessionId).toBe('session-1');
    expect(store.activeSession.runState).toBe('idle');
    expect(store.error).toBe(null);
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
  });

  it('keeps the optimistic prompt position when its authoritative chunk arrives after a tool', async () => {
    let resolvePrompt!: () => void;
    mockClient.sendPrompt.mockImplementationOnce(
      () =>
        new Promise<PromptResponse>((resolve) => {
          resolvePrompt = () => resolve({ stopReason: 'end_turn' });
        })
    );
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.transcript = [
      { id: 'old-user', kind: 'user_message_chunk', text: 'Old prompt', messageId: 'old-user', eventIndex: 3 },
      { id: 'old-answer', kind: 'agent_message_chunk', text: 'Old answer', messageId: 'old-answer', eventIndex: 18 }
    ];
    store.activeSession.events = [{ id: 'debug-1', kind: 'session_info_update', text: 'Loaded', messageId: null }];

    void store.sendPromptToActiveSession();
    await vi.waitFor(() => {
      expect(mockClient.sendPrompt).toHaveBeenCalledWith('session-1', 'Fix the failing tests', []);
    });

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'question-1',
        title: 'Question',
        status: 'in_progress',
        content: []
      }
    });
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Fix the failing tests' },
        messageId: 'real-user'
      }
    });

    expect(store.activeSession.transcript.find((item) => item.messageId === 'real-user')).toMatchObject({ eventIndex: 19 });
    expect(store.activeSession.toolCalls[0]).toMatchObject({ id: 'question-1', eventIndex: 20 });
    expect(store.activeSession.transcript.filter((item) => item.text === 'Fix the failing tests')).toHaveLength(1);

    resolvePrompt();
  });

  it('marks a streaming prompt completed when the prompt response returns a stop reason', async () => {
    let resolvePrompt!: () => void;
    mockClient.sendPrompt.mockImplementationOnce(
      () =>
        new Promise<PromptResponse>((resolve) => {
          resolvePrompt = () => resolve({ stopReason: 'end_turn' });
        })
    );
    const store = createStore();

    void store.startSessionWithPrompt('agent-1');

    await vi.waitFor(() => {
      expect(mockClient.sendPrompt).toHaveBeenCalledWith('session-1', 'Fix the failing tests', []);
    });
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Done.' }
      }
    });
    expect(store.activeSession.runState).toBe('streaming');
    expect(store.activeSession.activityLabel).toBe('Agent is replying…');

    resolvePrompt();

    await vi.waitFor(() => {
      expect(store.activeSession.runState).toBe('completed');
    });
    expect(store.activeSession.activityLabel).toBe('Turn completed.');
    expect(store.activeSession.lastStopReason).toBe('end_turn');
  });

  it('marks an active prompt cancelled when the prompt response is cancelled', async () => {
    mockClient.sendPrompt.mockResolvedValueOnce({ stopReason: 'cancelled' });
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.runState = 'tool-running';
    store.activeSession.activeToolCallId = 'tool-1';

    await store.sendPromptToActiveSession();

    expect(store.activeSession.runState).toBe('completed');
    expect(store.activeSession.activityLabel).toBe('Turn cancelled.');
    expect(store.activeSession.activeToolCallId).toBe(null);
    expect(store.activeSession.lastStopReason).toBe('cancelled');
  });

  it('requests cancellation for a running active session', async () => {
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.runState = 'tool-running';
    store.activeSession.activityLabel = 'Running tool: search';

    await store.cancelActiveSession();

    expect(store.activeSession.activityLabel).toBe('Cancelling turn…');
    expect(store.activeSession.lastError).toBe(null);
    expect(mockClient.cancelSession).toHaveBeenCalledWith('session-1');
  });

  it('ignores cancellation when the active session is idle', async () => {
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.runState = 'completed';

    await store.cancelActiveSession();

    expect(mockClient.cancelSession).not.toHaveBeenCalled();
  });

  it('clears composer errors explicitly', () => {
    const store = createStore();
    store.error = 'Prompt failed';

    store.clearError();

    expect(store.error).toBe(null);
  });

  it('clears stale errors when the composer prompt changes', () => {
    const store = createStore();
    store.error = 'Prompt failed';

    store.setComposerPrompt('Try again');

    expect(store.composerPrompt).toBe('Try again');
    expect(store.error).toBe(null);
  });

  it('updates the active session config option and tracks pending state', async () => {
    const store = createStore();
    const configOptions: SessionConfigOption[] = [
      {
        id: 'mode',
        name: 'Session Mode',
        type: 'select',
        currentValue: 'code',
        options: [
          { value: 'code', name: 'Code' },
          { value: 'ask', name: 'Ask' }
        ]
      },
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'claude-3-5',
        options: [{ value: 'claude-3-5', name: 'Claude 3.5' }]
      }
    ];
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    (mockClient.setSessionConfigOption as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () =>
        new Promise<SessionConfigOption[]>((resolve) => {
          expect(store.sessionConfigPending.mode).toBe(true);
          resolve(configOptions);
        })
    );

    await store.setActiveSessionConfigOption('mode', 'ask');

    expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', configId: 'mode', value: 'ask' })
    );
    expect(store.activeSession.configOptions).toEqual(configOptions);
    expect(store.composerModelId).toBe('claude-3-5');
    expect(store.sessionConfigPending.mode).toBe(false);
  });

  it('connects WebSocket agents and completes workspace discovery', async () => {
    const store = createStore();
    store.configs = [
      {
        id: 'remote-agent',
        name: 'Remote QueryMT',
        transport: 'websocket',
        commandLine: '',
        websocketUrl: '127.0.0.1:3030',
        enabled: true,
        autoStart: true
      }
    ];
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sessions: [], nextCursor: 'remote-page-2' })
      .mockResolvedValueOnce({ sessions: [] });

    await store.startConfiguredAgent('remote-agent');

    expect(mockClient.connect).toHaveBeenCalled();
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, {});
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, { cursor: 'remote-page-2' });
  });

  it('marks WebSocket loss immediately and completes discovery after reconnecting', async () => {
    vi.useFakeTimers();
    const store = createStore();
    store.configs = [
      {
        id: 'remote-agent',
        name: 'Remote QueryMT',
        transport: 'websocket',
        commandLine: '',
        websocketUrl: '127.0.0.1:3030',
        enabled: true,
        autoStart: true
      }
    ];

    await store.connectAgent('remote-agent');
    const connectCallsBeforeLoss = mockClient.connect.mock.calls.length;
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sessions: [], nextCursor: 'reconnect-page-2' })
      .mockResolvedValueOnce({ sessions: [] });
    mockClient.emitConnectionLoss('WebSocket closed (code 1006).');

    expect(store.connectionStates['remote-agent']).toBe('reconnecting');
    expect(store.agentErrors['remote-agent']).toBe('WebSocket closed (code 1006).');
    await vi.advanceTimersByTimeAsync(250);
    expect(mockClient.connect.mock.calls.length).toBeGreaterThan(connectCallsBeforeLoss);
    expect(mockClient.listSessions).toHaveBeenCalledWith({ cursor: 'reconnect-page-2' });
    expect(store.connectionStates['remote-agent']).toBe('initialized');
    vi.useRealTimers();
  });

  it('continues refreshing other agents when one session refresh fails', async () => {
    const store = createStore();
    store.configs = [
      ...store.configs,
      {
        id: 'agent-2',
        name: 'Mesh Agent',
        transport: 'stdio',
        commandLine: '/usr/local/bin/qmtcode --acp --mesh',
        enabled: true,
        autoStart: true
      }
    ];
    store.statuses = {
      ...store.statuses,
      'agent-2': {
        agentId: 'agent-2',
        state: 'running',
        commandLine: '/usr/local/bin/qmtcode --acp --mesh',
        pid: 4321,
        version: '1.0.0',
        message: 'Running',
        lastError: null
      }
    };
    let listSessionsCalls = 0;
    (mockClient.listSessions as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      listSessionsCalls += 1;
      if (listSessionsCalls === 2) {
        throw new Error('mesh failed');
      }
      return { sessions: [{ sessionId: 'session-1', title: 'Local session', cwd: '/tmp/work', updatedAt: '2026-06-16T12:00:00Z' }] };
    });

    await store.refreshAllSessions();

    expect(store.sessionsByAgent['agent-1']).toEqual([
      expect.objectContaining({ sessionId: 'session-1', title: 'Local session' })
    ]);
    expect(store.agentErrors['agent-2']).toBe('mesh failed');
  });

  it('deletes a supported session and clears its related state', async () => {
    const store = createStore();
    mockClient.connect.mockResolvedValueOnce({
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { delete: {} } },
      authMethods: []
    });
    store.sessionsByAgent = {
      'agent-1': [
        {
          agentId: 'agent-1',
          agentName: 'QMTCODE',
          sessionId: 'session-1',
          title: 'Delete me',
          cwd: '/tmp/work',
          updatedAt: '2026-07-18T17:00:00Z',
          runtimeId: 'agent-1',
          runtimeName: 'QMTCODE',
          source: 'acp',
          status: 'idle'
        }
      ]
    };
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.attentionSessionKeys = ['agent-1:session-1'];

    await store.connectAgent('agent-1');
    expect(store.canDeleteSession('agent-1')).toBe(true);
    await store.deleteSession('agent-1', 'session-1');

    expect(mockClient.deleteSession).toHaveBeenCalledWith('session-1');
    expect(store.sessionsByAgent['agent-1']).toEqual([]);
    expect(store.attentionSessionKeys).toEqual([]);
    expect(store.activeAgentId).toBe(null);
    expect(store.activeSessionId).toBe(null);
    expect(store.activeSession.sessionId).toBe(null);
  });

  it('rejects deletion when the agent does not advertise session/delete', async () => {
    const store = createStore();

    await store.connectAgent('agent-1');

    expect(store.canDeleteSession('agent-1')).toBe(false);
    await expect(store.deleteSession('agent-1', 'session-1')).rejects.toThrow('QMTCODE does not support deleting sessions.');
    expect(mockClient.deleteSession).not.toHaveBeenCalled();
  });

  it('marks a background session for attention when it finishes after running', async () => {
    const store = createStore();
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sessions: [
        {
          sessionId: 'background-1',
          title: 'Background task',
          cwd: '/tmp/work',
          updatedAt: '2026-06-17T12:00:00Z',
          _meta: {
            messageCount: 2,
            userMessageCount: 1,
            hasErrors: false,
            runtimeStatus: 'running'
          }
        }
      ] })
      .mockResolvedValueOnce({ sessions: [
        {
          sessionId: 'background-1',
          title: 'Background task',
          cwd: '/tmp/work',
          updatedAt: '2026-06-17T12:01:00Z',
          _meta: {
            messageCount: 3,
            userMessageCount: 1,
            hasErrors: false,
            runtimeStatus: 'idle'
          }
        }
      ] });

    await store.refreshSessionsForAgent('agent-1');
    await store.refreshSessionsForAgent('agent-1');

    expect(store.attentionSessionKeys).toEqual(['agent-1:background-1']);
  });

  it('does not mark the selected session for attention when its active run finishes', async () => {
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sessions: [
        {
          sessionId: 'session-1',
          title: 'Selected task',
          cwd: '/tmp/work',
          updatedAt: '2026-06-17T12:00:00Z',
          _meta: {
            messageCount: 2,
            userMessageCount: 1,
            hasErrors: false,
            runtimeStatus: 'running'
          }
        }
      ] })
      .mockResolvedValueOnce({ sessions: [
        {
          sessionId: 'session-1',
          title: 'Selected task',
          cwd: '/tmp/work',
          updatedAt: '2026-06-17T12:01:00Z',
          _meta: {
            messageCount: 3,
            userMessageCount: 1,
            hasErrors: false,
            runtimeStatus: 'idle'
          }
        }
      ] });

    await store.refreshSessionsForAgent('agent-1');
    await store.refreshSessionsForAgent('agent-1');

    expect(store.attentionSessionKeys).toEqual([]);
  });

  it('discovers workspaces across every global page using opaque cursors', async () => {
    const store = createStore();
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        sessions: [{ sessionId: 'session-a', title: 'A', cwd: '/tmp/a', updatedAt: '2026-07-18T12:00:00Z' }],
        nextCursor: 'opaque-global-page-2'
      })
      .mockResolvedValueOnce({
        sessions: [{ sessionId: 'session-b', title: 'B', cwd: '/tmp/b', updatedAt: '2026-07-17T12:00:00Z' }]
      });

    await store.refreshSessionsForAgent('agent-1', true);

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, {});
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, { cursor: 'opaque-global-page-2' });
    expect(store.workspaceSessionGroups.map((group) => group.cwd)).toEqual(['/tmp/a', '/tmp/b']);
    expect(store.workspaceSessionGroups.every((group) => !group.initialized)).toBe(true);
  });

  it('coalesces concurrent full workspace discovery for one agent', async () => {
    const store = createStore();
    let resolveFirstPage!: (value: { sessions: never[] }) => void;
    (mockClient.listSessions as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirstPage = resolve))
    );

    const firstDiscovery = store.refreshSessionsForAgent('agent-1', true);
    const secondDiscovery = store.refreshSessionsForAgent('agent-1', true);
    await vi.waitFor(() => expect(resolveFirstPage).toBeTypeOf('function'));
    resolveFirstPage({ sessions: [] });
    await Promise.all([firstDiscovery, secondDiscovery]);

    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
  });

  it('loads workspace pages with cwd-scoped opaque cursors and reveals ten at a time', async () => {
    const store = createStore();
    store.workspaceSessionSources = {
      'agent-1': {
        '/tmp/work': {
          agentId: 'agent-1',
          agentName: 'QMTCODE',
          cwd: '/tmp/work',
          sessions: [],
          latestActivity: '2026-07-18T12:00:00Z',
          nextCursor: null,
          initialized: false,
          loading: false,
          error: null
        }
      }
    };
    const page = (start: number) =>
      Array.from({ length: 10 }, (_, index) => ({
        sessionId: `session-${start + index}`,
        title: `Session ${start + index}`,
        cwd: '/tmp/work',
        updatedAt: new Date(Date.UTC(2026, 6, 18, 12, 0, 0) - (start + index) * 1000).toISOString()
      }));
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sessions: page(0), nextCursor: 'opaque-workspace-page-2' })
      .mockResolvedValueOnce({ sessions: page(10) });

    await store.loadWorkspaceSessions('/tmp/work');

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, { cwd: '/tmp/work', cursor: undefined });
    expect(store.workspaceSessionGroups[0].sessions).toHaveLength(10);
    expect(store.workspaceSessionGroups[0].hasMore).toBe(true);

    await store.loadMoreWorkspaceSessions('/tmp/work');

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, {
      cwd: '/tmp/work',
      cursor: 'opaque-workspace-page-2'
    });
    expect(store.workspaceSessionGroups[0].sessions).toHaveLength(20);
    expect(store.workspaceSessionGroups[0].hasMore).toBe(false);
  });

  it('continues cross-agent paging until the merged workspace has ten unique sessions', async () => {
    const store = createStore();
    store.configs = [
      ...store.configs,
      {
        id: 'agent-2',
        name: 'Mesh Agent',
        transport: 'stdio',
        commandLine: '/usr/local/bin/qmtcode --acp --mesh',
        enabled: true,
        autoStart: true
      }
    ];
    store.workspaceSessionSources = {
      'agent-1': {
        '/tmp/work': {
          agentId: 'agent-1',
          agentName: 'QMTCODE',
          cwd: '/tmp/work',
          sessions: [],
          latestActivity: null,
          nextCursor: null,
          initialized: false,
          loading: false,
          error: null
        }
      },
      'agent-2': {
        '/tmp/work': {
          agentId: 'agent-2',
          agentName: 'Mesh Agent',
          cwd: '/tmp/work',
          sessions: [],
          latestActivity: null,
          nextCursor: null,
          initialized: false,
          loading: false,
          error: null
        }
      }
    };
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        sessions: [{ sessionId: 'agent-1-0', title: 'One', cwd: '/tmp/work', updatedAt: '2026-07-18T12:00:00Z' }],
        nextCursor: 'agent-1-next'
      })
      .mockResolvedValueOnce({
        sessions: [{ sessionId: 'agent-2-0', title: 'Two', cwd: '/tmp/work', updatedAt: '2026-07-18T11:59:00Z' }]
      })
      .mockResolvedValueOnce({
        sessions: Array.from({ length: 9 }, (_, index) => ({
          sessionId: `agent-1-${index + 1}`,
          title: `More ${index}`,
          cwd: '/tmp/work',
          updatedAt: new Date(Date.UTC(2026, 6, 18, 11, 58, 0) - index * 1000).toISOString()
        }))
      });

    await store.loadWorkspaceSessions('/tmp/work');

    expect(mockClient.listSessions).toHaveBeenCalledTimes(3);
    expect(mockClient.listSessions).toHaveBeenLastCalledWith({ cwd: '/tmp/work', cursor: 'agent-1-next' });
    expect(store.workspaceSessionGroups[0].sessions).toHaveLength(10);
  });

  it('caps merged cross-agent workspace results at ten', () => {
    const store = createStore();
    const source = (agentId: string, agentName: string, offset: number) => ({
      agentId,
      agentName,
      cwd: '/tmp/work',
      sessions: Array.from({ length: 10 }, (_, index) => ({
        agentId,
        agentName,
        sessionId: `${agentId}-${index}`,
        title: `${agentName} ${index}`,
        cwd: '/tmp/work',
        updatedAt: new Date(Date.UTC(2026, 6, 18, 12, 0, 0) - (offset + index) * 1000).toISOString(),
        runtimeId: agentId,
        runtimeName: agentName,
        source: 'acp' as const,
        status: 'idle' as const
      })),
      latestActivity: '2026-07-18T12:00:00Z',
      nextCursor: null,
      initialized: true,
      loading: false,
      error: null
    });
    store.workspaceSessionSources = {
      'agent-1': { '/tmp/work': source('agent-1', 'QMTCODE', 0) },
      'agent-2': { '/tmp/work': source('agent-2', 'Mesh Agent', 5) }
    };

    expect(store.workspaceSessionGroups).toHaveLength(1);
    expect(store.workspaceSessionGroups[0].sessions).toHaveLength(10);
    expect(store.workspaceSessionGroups[0].hasMore).toBe(true);
  });

  it('clears attention when a session is acknowledged', () => {
    const store = createStore();
    store.attentionSessionKeys = ['agent-1:session-1', 'agent-1:session-2'];

    store.acknowledgeSession('agent-1', 'session-1');

    expect(store.attentionSessionKeys).toEqual(['agent-1:session-2']);
  });
});
