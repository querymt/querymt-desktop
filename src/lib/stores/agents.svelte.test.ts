import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptResponse, SessionConfigOption, SessionNotification } from '@agentclientprotocol/sdk';
import { AgentsStore } from './agents.svelte';

const mockClient = vi.hoisted(() => {
  let sessionUpdateHandler: ((notification: SessionNotification) => void) | null = null;
  let connectionLossHandler: ((reason: string) => void) | null = null;

  return {
    connect: vi.fn(async () => ({
      protocolVersion: 1,
      agentCapabilities: {},
      authMethods: []
    })),
    createSession: vi.fn(async () => ({
      sessionId: 'session-1',
      configOptions: []
    })),
    listSessions: vi.fn(async () => []),
    sendPrompt: vi.fn(async (): Promise<PromptResponse> => ({ stopReason: 'end_turn' })),
    cancelSession: vi.fn(async () => undefined),
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
    },
    onExtensionNotification: vi.fn(() => () => undefined),
    onPermissionRequest: vi.fn(() => () => undefined),
    onElicitationRequest: vi.fn(() => () => undefined),
    setSessionConfigOption: vi.fn(async () => [])
  };
});

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
  mockClient.resetSessionUpdateHandler();
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

  it('connects WebSocket agents without invoking the local sidecar lifecycle', async () => {
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

    await store.startConfiguredAgent('remote-agent');

    expect(mockClient.connect).toHaveBeenCalled();
    expect(mockClient.listSessions).toHaveBeenCalled();
  });

  it('marks WebSocket loss immediately and reconnects with backoff', async () => {
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
    mockClient.emitConnectionLoss('WebSocket closed (code 1006).');

    expect(store.connectionStates['remote-agent']).toBe('reconnecting');
    expect(store.agentErrors['remote-agent']).toBe('WebSocket closed (code 1006).');
    await vi.advanceTimersByTimeAsync(250);
    expect(mockClient.connect.mock.calls.length).toBeGreaterThan(connectCallsBeforeLoss);
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
      return [{ sessionId: 'session-1', title: 'Local session', cwd: '/tmp/work', updatedAt: '2026-06-16T12:00:00Z' }];
    });

    await store.refreshAllSessions();

    expect(store.sessionsByAgent['agent-1']).toEqual([
      expect.objectContaining({ sessionId: 'session-1', title: 'Local session' })
    ]);
    expect(store.agentErrors['agent-2']).toBe('mesh failed');
  });

  it('marks a background session for attention when it finishes after running', async () => {
    const store = createStore();
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
      ]);

    await store.refreshSessionsForAgent('agent-1');
    await store.refreshSessionsForAgent('agent-1');

    expect(store.attentionSessionKeys).toEqual(['agent-1:background-1']);
  });

  it('does not mark the selected session for attention when its active run finishes', async () => {
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    (mockClient.listSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
      ]);

    await store.refreshSessionsForAgent('agent-1');
    await store.refreshSessionsForAgent('agent-1');

    expect(store.attentionSessionKeys).toEqual([]);
  });

  it('clears attention when a session is acknowledged', () => {
    const store = createStore();
    store.attentionSessionKeys = ['agent-1:session-1', 'agent-1:session-2'];

    store.acknowledgeSession('agent-1', 'session-1');

    expect(store.attentionSessionKeys).toEqual(['agent-1:session-2']);
  });
});
