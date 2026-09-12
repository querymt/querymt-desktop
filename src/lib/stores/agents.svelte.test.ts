import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestError, type InitializeResponse, type PromptResponse, type SessionConfigOption, type SessionNotification, type SetSessionConfigOptionRequest } from '@agentclientprotocol/sdk';
import type { ModelEntry, PromptAttachment, PromptSendOptions } from '$lib/domain/types';
import { getModelSelectionKey } from '$lib/querymt/config-options';
import {
  DelegateAssignmentSource,
  DelegateReasoningEffort,
  type AuthProviderEntry,
  type DelegateAssignmentsInfo,
  type SetDelegateModelRequest,
  type SetDelegateModelResponse
} from '$lib/querymt/generated/types';
import { tick } from 'svelte';
import { DesktopAcpClient } from '$lib/querymt/acp-client';
import { startAgent } from '$lib/querymt/sidecar';
import { AgentsStore } from './agents.svelte';
import { DEFAULT_SESSION_LIST_SCOPE } from '$lib/domain/sessions';

function listSessionsRequest(input: { cwd?: string; cursor?: string } = {}) {
  return {
    _meta: { session_scope: DEFAULT_SESSION_LIST_SCOPE },
    ...input
  };
}

const mockListManagedProfiles = vi.hoisted(() => vi.fn(async () => []));
const mockListen = vi.hoisted(() => vi.fn());
const mockDrainAgentSessionUpdates = vi.hoisted(() => vi.fn(async () => [] as SessionNotification[]));

const mockClient = vi.hoisted(() => {
  let sessionUpdateHandler: ((notification: SessionNotification) => void) | null = null;
  let connectionLossHandler: ((reason: string) => void) | null = null;
  let extensionNotificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;
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
    loadSession: vi.fn(async (_sessionId?: string, _cwd?: string): Promise<{
      response: { configOptions: SessionConfigOption[]; _meta?: Record<string, unknown> };
      replay: SessionNotification[];
    }> => ({
      response: { configOptions: [] },
      replay: []
    })),
    sendPrompt: vi.fn(async (
      _sessionId: string,
      _prompt: string,
      _attachments: PromptAttachment[] = [],
      _options: PromptSendOptions = {}
    ): Promise<PromptResponse> => ({ stopReason: 'end_turn' })),
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
    supportsImagePrompts: vi.fn(() => true),
    supportsEmbeddedContext: vi.fn(() => true),
    getInitializeResponse: vi.fn(() => ({
      protocolVersion: 1,
      agentCapabilities: {},
      authMethods: []
    })),
    getControlCapabilities: vi.fn(() => null),
    getControlHealth: vi.fn(() => ({ state: 'unknown', summary: 'unknown', missingMethods: [], missingFeatures: [] })),
    listModels: vi.fn(async (): Promise<ModelEntry[]> => []),
    refreshAndListModels: vi.fn(async (): Promise<ModelEntry[]> => []),
    getModelInfo: vi.fn(async () => ({})),
    getDelegateModels: vi.fn(async (request: { session_id: string }): Promise<DelegateAssignmentsInfo> => ({
      version: 1,
      reasoning_effort_supported: true,
      session_id: request.session_id,
      profile_id: 'quorum',
      revision: 0,
      durable: true,
      editable: true,
      assignments: [],
      orphaned_overrides: []
    })),
    setDelegateModel: vi.fn(async (request: SetDelegateModelRequest): Promise<SetDelegateModelResponse> => ({
      version: 1,
      reasoning_effort_supported: true,
      session_id: request.session_id,
      agent_id: request.agent_id,
      model: request.model_id ? { model_id: request.model_id, node_id: request.node_id ?? undefined } : null,
      reasoning_effort: request.reasoning_effort ?? null,
      revision: (request.expected_revision ?? 0) + 1,
      durable: true
    })),
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
      extensionNotificationHandler = null;
      permissionUnsubscribe = vi.fn();
      elicitationUnsubscribe = vi.fn();
    },
    permissionUnsubscribe: () => permissionUnsubscribe,
    elicitationUnsubscribe: () => elicitationUnsubscribe,
    onExtensionNotification: vi.fn((handler: (notification: { method: string; params: unknown }) => void) => {
      extensionNotificationHandler = handler;
      return () => {
        extensionNotificationHandler = null;
      };
    }),
    emitExtensionNotification: (notification: { method: string; params: unknown }) => extensionNotificationHandler?.(notification),
    onPermissionRequest: vi.fn(() => permissionUnsubscribe),
    onElicitationRequest: vi.fn(() => elicitationUnsubscribe),
    setSessionConfigOption: vi.fn(async (_request: SetSessionConfigOptionRequest): Promise<SessionConfigOption[]> => []),
    listRemoteSessions: vi.fn(async (request: { node_id: string }) => ({ node_id: request.node_id, sessions: [], total_count: 0 })),
    attachRemoteSession: vi.fn(async () => ({
      session_id: 'remote-session-1',
      node_id: 'node-1',
      attached: true,
      config_options: [],
      snapshot: {
        audit: {
          events: [{ seq: 1, timestamp: 1, kind: { type: 'prompt_received', data: { message_id: 'm1', content: 'Review deployment' } } }]
        }
      }
    }))
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen
}));

vi.mock('$lib/querymt/profile-templates', () => ({
  listManagedProfiles: mockListManagedProfiles
}));

vi.mock('$lib/querymt/acp-client', () => ({
  DesktopAcpClient: vi.fn(function () {
    return mockClient;
  })
}));

vi.mock('$lib/querymt/sidecar', () => ({
  drainAgentSessionUpdates: mockDrainAgentSessionUpdates,
  getAgentLogs: vi.fn(async () => []),
  getAgentStatus: vi.fn(async () => ({ state: 'running' })),
  restartAgent: vi.fn(async () => ({ state: 'running' })),
  startAgent: vi.fn(async () => ({ state: 'running' })),
  stopAgent: vi.fn(async () => ({ state: 'stopped' })),
  validateWorkspaceDirectory: vi.fn(async () => true)
}));

function createDistinctMockClient() {
  let connectionLossHandler: ((reason: string) => void) | null = null;

  return {
    connect: vi.fn(async (): Promise<InitializeResponse> => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: []
    })),
    disconnect: vi.fn(async () => undefined),
    listSessions: vi.fn(async (): Promise<{ sessions: Array<{ sessionId: string; title: string; cwd: string; updatedAt: string }> }> => ({
      sessions: []
    })),
    listModels: vi.fn(async (): Promise<ModelEntry[]> => []),
    listAuthProviders: vi.fn(async (): Promise<AuthProviderEntry[]> => []),
    supportsQuerymtFeature: vi.fn((_feature: string) => false),
    getControlCapabilities: vi.fn(() => null),
    getControlHealth: vi.fn(() => ({ state: 'unknown', summary: 'unknown', missingMethods: [], missingFeatures: [] })),
    onConnectionLost: vi.fn((handler: (reason: string) => void) => {
      connectionLossHandler = handler;
      return () => {
        connectionLossHandler = null;
      };
    }),
    emitConnectionLoss: (reason: string) => connectionLossHandler?.(reason),
    onSessionUpdate: vi.fn(() => () => undefined),
    onExtensionNotification: vi.fn(() => () => undefined),
    onPermissionRequest: vi.fn(() => vi.fn()),
    onElicitationRequest: vi.fn(() => vi.fn())
  };
}

const createdStores: AgentsStore[] = [];

function createStore() {
  const store = new AgentsStore();
  createdStores.push(store);
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
  vi.mocked(DesktopAcpClient).mockImplementation(function () {
    return mockClient;
  });
  mockListen.mockResolvedValue(() => undefined);
  mockListManagedProfiles.mockResolvedValue([]);
  mockClient.resetSessionUpdateHandler();
  mockClient.connect.mockReset().mockImplementation(async (): Promise<InitializeResponse> => ({
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
    authMethods: []
  }));
  mockClient.listModels.mockResolvedValue([]);
  mockClient.refreshAndListModels.mockResolvedValue([]);
  mockClient.getModelInfo.mockResolvedValue({});
  mockClient.getDelegateModels.mockReset().mockImplementation(async (request: { session_id: string }) => ({
    version: 1,
    reasoning_effort_supported: true,
    session_id: request.session_id,
    profile_id: 'quorum',
    revision: 0,
    durable: true,
    editable: true,
    assignments: [],
    orphaned_overrides: []
  }));
  mockClient.setDelegateModel.mockReset().mockImplementation(async (request: SetDelegateModelRequest): Promise<SetDelegateModelResponse> => ({
    version: 1,
    reasoning_effort_supported: true,
    session_id: request.session_id,
    agent_id: request.agent_id,
    model: request.model_id ? { model_id: request.model_id, node_id: request.node_id ?? undefined } : null,
    reasoning_effort: request.reasoning_effort ?? null,
    revision: (request.expected_revision ?? 0) + 1,
    durable: true
  }));
  mockDrainAgentSessionUpdates.mockResolvedValue([]);
  mockClient.setSessionConfigOption.mockReset().mockResolvedValue([]);
  mockClient.loadSession.mockReset().mockResolvedValue({ response: { configOptions: [] }, replay: [] });
  mockClient.createSession.mockReset().mockResolvedValue({ sessionId: 'session-1', configOptions: [] });
});

afterEach(() => {
  while (createdStores.length > 0) {
    createdStores.pop()?.dispose();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AgentsStore connections', () => {
  it('subscribes to live agent logs and retains the latest 200 entries', async () => {
    type LogEvent = { payload: { agentId: string; entry: { timestamp: string; stream: 'system'; message: string } } };
    let handleLog: ((event: LogEvent) => void) | undefined;
    mockListen.mockImplementation(async (_eventName: string, handler: (event: LogEvent) => void) => {
      handleLog = handler;
      return () => undefined;
    });
    const store = createStore();
    store.configs = [];

    await store.initialize();

    expect(mockListen).toHaveBeenCalledWith('querymt://agent/log', expect.any(Function));
    const emitLog = handleLog as (event: LogEvent) => void;
    for (let index = 0; index < 205; index += 1) {
      emitLog({ payload: { agentId: 'agent-1', entry: { timestamp: String(index), stream: 'system', message: `line ${index}` } } });
    }
    expect(store.logsByAgent['agent-1']).toHaveLength(200);
    expect(store.logsByAgent['agent-1'][0].message).toBe('line 5');
    expect(store.logsByAgent['agent-1'][199].message).toBe('line 204');
  });

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

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, listSessionsRequest());
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, listSessionsRequest({ cursor: 'opaque-global-page-2' }));
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

  it('loads a known child session without switching the catalog off root', async () => {
    const store = createStore();
    store.composerCwd = '/tmp/work';
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1',
        agentName: 'QMTCODE',
        sessionId: 'session-root',
        title: 'Root',
        cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z',
        runtimeId: 'agent-1',
        runtimeName: 'QMTCODE',
        source: 'acp',
        status: 'idle'
      }]
    };
    mockClient.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: 'session-root', title: 'Root', cwd: '/tmp/work', updatedAt: '2026-07-18T17:00:00Z' }]
    });
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: [] },
      replay: [{
        sessionId: 'session-child',
        update: {
          sessionUpdate: 'session_info_update',
          title: 'Task: Final PASS review',
          updatedAt: '2026-07-18T18:00:00Z'
        }
      }]
    });

    await store.connectAgent('agent-1');
    await store.loadSession('agent-1', 'session-child');

    expect(mockClient.listSessions).toHaveBeenCalledWith(listSessionsRequest());
    expect(mockClient.loadSession).toHaveBeenCalledWith('session-child', '/tmp/work');
    expect(store.error).toBeNull();
    expect(store.activeSessionId).toBe('session-child');
    expect(store.sessionsByAgent['agent-1']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'session-child',
        title: 'Task: Final PASS review',
        updatedAt: '2026-07-18T18:00:00Z'
      })
    ]));
    expect(store.workspaceSessionGroups.flatMap((group) => group.sessions.map((session) => session.sessionId)))
      .not.toContain('session-child');
  });

  it('keeps first-load child transcript from late updates when replay is metadata-only', async () => {
    const store = createStore();
    store.composerCwd = '/tmp/work';
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1',
        agentName: 'QMTCODE',
        sessionId: 'session-root',
        title: 'Root',
        cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z',
        runtimeId: 'agent-1',
        runtimeName: 'QMTCODE',
        source: 'acp',
        status: 'idle'
      }]
    };
    mockClient.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: 'session-root', title: 'Root', cwd: '/tmp/work', updatedAt: '2026-07-18T17:00:00Z' }]
    });
    mockClient.loadSession.mockImplementationOnce(async (sessionId?: string) => {
      mockClient.emitSessionUpdate({
        sessionId: sessionId ?? 'session-child',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'child-1',
          content: { type: 'text', text: 'Child answer' }
        }
      });
      return {
        response: { configOptions: [] },
        replay: [{
          sessionId: sessionId ?? 'session-child',
          update: {
            sessionUpdate: 'session_info_update',
            title: 'Task: Final PASS review',
            updatedAt: '2026-07-18T18:00:00Z'
          }
        }]
      };
    });

    await store.connectAgent('agent-1');
    await store.loadSession('agent-1', 'session-child');

    expect(mockClient.listSessions).toHaveBeenCalledWith(listSessionsRequest());
    expect(store.error).toBeNull();
    expect(store.activeSessionId).toBe('session-child');
    expect(store.activeSession.transcript).toEqual([
      expect.objectContaining({ messageId: 'child-1', text: 'Child answer' })
    ]);
    expect(store.sessionsByAgent['agent-1']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'session-child',
        title: 'Task: Final PASS review'
      })
    ]));
  });

  it('includes after-response replay captured during the post-RPC flush', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1',
        agentName: 'QMTCODE',
        sessionId: 'session-1',
        title: 'A',
        cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z',
        runtimeId: 'agent-1',
        runtimeName: 'QMTCODE',
        source: 'acp',
        status: 'idle'
      }]
    };
    const replay: SessionNotification[] = [{
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'session_info_update',
        title: 'Question session',
        updatedAt: '2026-07-18T17:00:00Z'
      }
    }];
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: [] },
      replay,
      finishReplay: () => {
        replay.push({
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'agent-1',
            content: { type: 'text', text: 'Answer after RPC' }
          }
        });
        return replay;
      }
    });

    await store.loadSession('agent-1', 'session-1');

    expect(store.activeSession.transcript).toEqual([
      expect.objectContaining({ messageId: 'agent-1', text: 'Answer after RPC' })
    ]);
  });

  it('hydrates and activates an attached remote session without reloading it immediately', async () => {
    const store = createStore();
    store.remoteSessionsByAgent = {
      'agent-1': {
        'node-1': {
          node_id: 'node-1',
          total_count: 1,
          sessions: [{
            id: 'remote-session-1',
            node_id: 'node-1',
            title: 'Review deployment',
            cwd: '/srv/app',
            updated_at: '2026-07-29T22:30:00Z'
          }]
        }
      }
    };

    await expect(store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1')).resolves.toBe('remote-session-1');

    expect(mockClient.attachRemoteSession).toHaveBeenCalledWith({ node_id: 'node-1', session_id: 'remote-session-1' });
    expect(store.activeAgentId).toBe('agent-1');
    expect(store.activeSessionId).toBe('remote-session-1');
    expect(store.activeSession.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'user_message_chunk', text: 'Review deployment' })
    ]));
    expect(store.sessionsByAgent['agent-1']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: 'remote-session-1',
        title: 'Review deployment',
        cwd: '/srv/app',
        location: 'remote',
        remoteNodeId: 'node-1'
      })
    ]));
    expect(store.workspaceSessionGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ cwd: '/srv/app', location: 'remote' })
    ]));

    await store.loadSession('agent-1', 'remote-session-1');
    expect(mockClient.loadSession).not.toHaveBeenCalled();
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
    expect(store.workspaceSessionGroups[0].sessions.map((session) => session.sessionId)).toEqual(
      expect.arrayContaining(['fork-session', 'session-1'])
    );
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

  it('batch-reduces captured ACP replay without invoking live handlers', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'A', cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: [] },
      replay: [
        {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'user_message_chunk',
            messageId: 'user-1',
            content: { type: 'text', text: 'Question' }
          }
        },
        {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'agent-1',
            content: { type: 'text', text: 'Answer' }
          }
        }
      ]
    });

    await store.loadSession('agent-1', 'session-1');

    expect(store.activeSession.transcript).toEqual([
      expect.objectContaining({ messageId: 'user-1', text: 'Question' }),
      expect.objectContaining({ messageId: 'agent-1', text: 'Answer' })
    ]);
    expect(store.lastSessionLoadMetrics).toEqual(expect.objectContaining({
      replayCapturedNotifications: 2,
      replayReactiveNotifications: 0,
      historyAssignments: 1,
      drainedNotifications: 0
    }));
  });

  it('applies recovery updates after selecting the replay base session', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'A', cwd: '/tmp/work',
        updatedAt: '2026-07-18T17:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: [] },
      replay: [{
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'user_message_chunk',
          messageId: 'user-1',
          content: { type: 'text', text: 'Question' }
        }
      }]
    });
    mockDrainAgentSessionUpdates.mockResolvedValueOnce([{
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'agent-1',
        content: { type: 'text', text: 'Recovered answer' }
      }
    }]);

    await store.loadSession('agent-1', 'session-1');

    expect(store.activeSession.transcript).toEqual([
      expect.objectContaining({ messageId: 'user-1', text: 'Question' }),
      expect.objectContaining({ messageId: 'agent-1', text: 'Recovered answer' })
    ]);
    expect(store.lastSessionLoadMetrics).toEqual(expect.objectContaining({
      drainedNotifications: 1,
      appliedNotifications: 1
    }));
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
    store.setLaunchModel('launch-only');
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
      response: {
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
      },
      replay: []
    }));

    await store.loadSession('agent-1', 'session-a');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(anthropic.id);
    await store.loadSession('agent-1', 'session-b');
    expect(store.getSessionModelId('agent-1', 'session-b')).toBe(openai.id);
    await store.loadSession('agent-1', 'session-a');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(anthropic.id);
    expect(store.launchModelId).toBe('launch-only');
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
      response: {
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
      },
      replay: []
    });

    await store.loadSession('agent-1', 'session-1');

    expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(remoteModel));
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

    await store.setSessionModel('agent-1', 'session-1', getModelSelectionKey(remoteModel));

    expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      configId: 'model',
      value: remoteModel.id,
      _meta: { querymt: { modelEntry: remoteModel } }
    }));
    expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(remoteModel));
    expect(store.getRecentModels('agent-1')).toEqual([remoteModel]);
  });
});

describe('AgentsStore session model isolation', () => {
  const sol: ModelEntry = { id: 'codex/gpt-5.6-sol', provider: 'codex', model: 'gpt-5.6-sol', label: 'Sol' };
  const grok: ModelEntry = { id: 'xai/grok-4.6', provider: 'xai', model: 'grok-4.6', label: 'Grok' };
  const glm: ModelEntry = { id: 'zai/glm-5.3-flash', provider: 'zai', model: 'glm-5.3-flash', label: 'GLM' };
  const modelOptions = (modelId: string): SessionConfigOption[] => [{
    id: 'model', name: 'Model', type: 'select', currentValue: modelId,
    options: [sol, grok, glm].map((model) => ({ value: model.id, name: model.label ?? model.model }))
  }];
  const modeOptions = (mode: string): SessionConfigOption[] => [{
    id: 'mode', name: 'Mode', type: 'select', currentValue: mode,
    options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]
  }];

  function setup() {
    const store = createStore();
    store.modelsByAgent = { 'agent-1': [sol, grok, glm] };
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-a';
    store.activeSession.sessionId = 'session-a';
    store.sessionsByAgent = {
      'agent-1': ['session-a', 'session-b'].map((sessionId) => ({
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId, title: sessionId, cwd: '/tmp/work',
        updatedAt: '2026-09-07T20:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }))
    };
    return store;
  }

  it('choosing Grok on Today leaves session A on Sol and applies Grok only to new session B', async () => {
    const store = setup();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: modelOptions(sol.id) }, replay: [] });
    await store.loadSession('agent-1', 'session-a');

    store.setLaunchModel(grok.id);

    expect(store.activeSessionId).toBe('session-a');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-b', configOptions: modelOptions(sol.id) });
    await store.createSession('agent-1');

    expect(mockClient.setSessionConfigOption).toHaveBeenCalledTimes(1);
    expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-b', value: grok.id }));
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(store.getSessionModelId('agent-1', 'session-b')).toBe(grok.id);
    store.setLaunchModel(glm.id);
    expect(mockClient.setSessionConfigOption).toHaveBeenCalledTimes(1);
    expect(store.getSessionModelId('agent-1', 'session-b')).toBe(grok.id);
  });

  it('snapshots launch settings before creation and configures mode before model and prompt', async () => {
    const store = setup();
    store.setLaunchModel(grok.id);
    store.setComposerProfile('coding');
    store.setComposerMode('plan');
    let finishCreation!: (response: { sessionId: string; configOptions: SessionConfigOption[] }) => void;
    mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => { finishCreation = resolve; }));
    const order: string[] = [];
    mockClient.setSessionConfigOption.mockImplementation(async (request) => {
      order.push(request.configId);
      return modeOptions('plan');
    });
    mockClient.sendPrompt.mockImplementationOnce(async () => {
      order.push('prompt');
      return { stopReason: 'end_turn' };
    });
    const creation = store.startSessionWithPrompt('agent-1');
    store.setLaunchModel(glm.id);
    store.setComposerProfile('other');
    store.setComposerMode('build');
    await vi.waitFor(() => expect(finishCreation).toBeDefined());
    finishCreation({ sessionId: 'session-b', configOptions: modeOptions('build') });
    await creation;
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalled());

    expect(mockClient.createSession).toHaveBeenCalledWith('/tmp/work', 'coding');
    expect(mockClient.setSessionConfigOption).toHaveBeenNthCalledWith(1, expect.objectContaining({ sessionId: 'session-b', configId: 'mode', value: 'plan' }));
    expect(mockClient.setSessionConfigOption).toHaveBeenNthCalledWith(2, expect.objectContaining({ sessionId: 'session-b', configId: 'model', value: grok.id }));
    expect(order).toEqual(['mode', 'model', 'prompt']);
    expect(store.launchModelId).toBe(glm.id);
    expect(store.getSessionModelId('agent-1', 'session-b')).toBe(grok.id);
  });

  it('does not send the first prompt when the model write fails', async () => {
    const store = setup();
    store.setLaunchModel(grok.id);
    mockClient.setSessionConfigOption.mockRejectedValueOnce(new Error('Model rejected'));

    expect(await store.startSessionWithPrompt('agent-1')).toBeNull();
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(store.error).toBe('Model rejected');
  });

  it('does not silently use the default model when the launch selection is unavailable', async () => {
    const store = setup();
    store.setLaunchModel('missing/model');

    expect(await store.startSessionWithPrompt('agent-1')).toBeNull();
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
    expect(store.error).toContain('Selected model is unavailable');
  });

  it('keeps confirmed selection on failure and obeys the server response rather than the requested model', async () => {
    const store = setup();
    await store.setSessionModel('agent-1', 'session-a', sol.id);
    store.setLaunchModel(glm.id);
    mockClient.setSessionConfigOption.mockRejectedValueOnce(new Error('Denied'));
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(store.error).toBe('Denied');
    expect(store.sessionConfigPending.model).toBe(false);

    mockClient.setSessionConfigOption.mockResolvedValueOnce(modelOptions(glm.id));
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
    expect(store.launchModelId).toBe(glm.id);
    expect(store.error).toBeNull();
  });

  it.each(['session-b', 'other-agent'])('scopes pending and late model responses when switching to %s', async (target) => {
    const store = setup();
    store.configs.push({ ...store.configs[0], id: 'other-agent' });
    store.modelsByAgent['other-agent'] = [sol, grok, glm];
    let finishA!: (options: SessionConfigOption[]) => void;
    let finishB!: (options: SessionConfigOption[]) => void;
    mockClient.setSessionConfigOption.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }));
    const changeA = store.setSessionModel('agent-1', 'session-a', grok.id);
    await vi.waitFor(() => expect(finishA).toBeDefined());
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe('');
    expect(store.sessionConfigPending.model).toBe(true);

    const agentB = target === 'other-agent' ? target : 'agent-1';
    const sessionB = target === 'other-agent' ? 'session-a' : target;
    store.activeAgentId = agentB;
    store.activeSessionId = sessionB;
    store.activeSession.sessionId = sessionB;
    store.activeSession.configOptions = modelOptions(sol.id);
    expect(store.sessionConfigPending.model).toBeUndefined();
    mockClient.setSessionConfigOption.mockImplementationOnce(() => new Promise((resolve) => { finishB = resolve; }));
    const changeB = store.setSessionModel(agentB, sessionB, glm.id);
    await vi.waitFor(() => expect(finishB).toBeDefined());
    finishA(modelOptions(grok.id));
    await changeA;

    expect(store.activeSession.configOptions).toEqual(modelOptions(sol.id));
    expect(store.getSessionModelId(agentB, sessionB)).toBe('');
    expect(store.sessionConfigPending.model).toBe(true);
    finishB(modelOptions(glm.id));
    await changeB;
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(grok.id);
    expect(store.getSessionModelId(agentB, sessionB)).toBe(glm.id);
    expect(store.sessionConfigPending.model).toBe(false);
  });

  it('serializes rapid model changes within the same session', async () => {
    const store = setup();
    let finish!: (options: SessionConfigOption[]) => void;
    mockClient.setSessionConfigOption.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = store.setSessionModel('agent-1', 'session-a', grok.id);
    const second = store.setSessionModel('agent-1', 'session-a', glm.id);
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(mockClient.setSessionConfigOption).toHaveBeenCalledTimes(1);
    finish(modelOptions(grok.id));
    await Promise.all([first, second]);
    expect(mockClient.setSessionConfigOption).toHaveBeenNthCalledWith(2, expect.objectContaining({ value: glm.id }));
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
    expect(store.sessionConfigPending.model).toBe(false);
  });

  it('prefers configured model over conflicting snapshot even when it is absent from the catalog', async () => {
    const store = setup();
    mockClient.loadSession.mockResolvedValueOnce({
      response: {
        configOptions: modelOptions('unavailable/model'),
        _meta: { 'querymt/sessionLoadSnapshot.v1': { audit: { events: [{ kind: { type: 'provider_changed', data: { provider: grok.provider, model: grok.model } } }] } } }
      }, replay: []
    });
    await store.loadSession('agent-1', 'session-a');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe('unavailable/model');
    mockClient.refreshAndListModels.mockResolvedValueOnce([glm]);
    await store.refreshModelsForAgent('agent-1');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe('unavailable/model');

    await store.loadSession('agent-1', 'session-a');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe('');
  });

  it('preserves an unavailable mesh identity instead of substituting a local copy', async () => {
    const store = setup();
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: modelOptions(grok.id), _meta: {
        'querymt/sessionLoadSnapshot.v1': { audit: { events: [{ kind: { type: 'provider_changed', data: {
          provider: grok.provider, model: grok.model, provider_node_id: 'offline-node'
        } } }] } }
      } }, replay: []
    });
    await store.loadSession('agent-1', 'session-a');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(getModelSelectionKey({ ...grok, node_id: 'offline-node' }));
  });

  it('uses unknown after a mode change without model metadata and accepts subsequent config updates', async () => {
    const store = setup();
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));
    await store.setActiveSessionConfigOption('mode', 'plan');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe('');
    store.setLaunchModel(glm.id);
    mockClient.emitSessionUpdate({ sessionId: 'session-a', update: {
      sessionUpdate: 'config_option_update', configOptions: modelOptions(sol.id)
    } });
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(store.launchModelId).toBe(glm.id);
  });
});

describe('AgentsStore model info cache', () => {
  const localModel = {
    id: 'anthropic/claude-sonnet-4',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    label: 'Claude Sonnet 4'
  };
  const remoteModel = { ...localModel, node_id: 'node-1', node_label: 'Build server' };
  const modelInfo = {
    id: 'claude-sonnet-4',
    capabilities: { modalities: { input: ['text', 'image'], output: ['text'] } }
  };

  it('batches unique model identities once and reuses them for mesh copies', async () => {
    const store = createStore();
    mockClient.listModels.mockResolvedValue([localModel, remoteModel]);
    mockClient.getModelInfo.mockResolvedValue({ 'anthropic/claude-sonnet-4': modelInfo });

    await store.loadInitialModelsForAgent('agent-1');
    await store.loadInitialModelsForAgent('agent-1');

    expect(mockClient.getModelInfo).toHaveBeenCalledOnce();
    expect(mockClient.getModelInfo).toHaveBeenCalledWith([
      { provider: 'anthropic', model: 'claude-sonnet-4' }
    ]);
    expect(store.modelInfoByAgent['agent-1'][getModelSelectionKey(localModel)]).toEqual(modelInfo);
    expect(store.modelInfoByAgent['agent-1'][getModelSelectionKey(remoteModel)]).toEqual(modelInfo);
  });

  it('shares cached model info across agents for the app lifetime', async () => {
    const store = createStore();
    store.configs.push({
      id: 'agent-2',
      name: 'QMTPLAN',
      transport: 'stdio',
      commandLine: '/usr/local/bin/qmtplan --acp',
      enabled: true,
      autoStart: false
    });
    mockClient.listModels.mockResolvedValue([localModel]);
    mockClient.getModelInfo.mockResolvedValue({ 'anthropic/claude-sonnet-4': modelInfo });

    await store.loadInitialModelsForAgent('agent-1');
    await store.loadInitialModelsForAgent('agent-2');

    expect(mockClient.getModelInfo).toHaveBeenCalledOnce();
    expect(store.modelInfoByAgent['agent-2'][localModel.id]).toEqual(modelInfo);
  });

  it('shares in-flight model info requests across concurrent agent loads', async () => {
    const store = createStore();
    store.configs.push({
      id: 'agent-2',
      name: 'QMTPLAN',
      transport: 'stdio',
      commandLine: '/usr/local/bin/qmtplan --acp',
      enabled: true,
      autoStart: false
    });
    mockClient.listModels.mockResolvedValue([localModel]);
    let resolveInfo!: (value: Record<string, typeof modelInfo>) => void;
    mockClient.getModelInfo.mockReturnValue(new Promise((resolve) => (resolveInfo = resolve)));

    const firstLoad = store.loadInitialModelsForAgent('agent-1');
    await tick();
    const secondLoad = store.loadInitialModelsForAgent('agent-2');
    await tick();
    expect(mockClient.getModelInfo).toHaveBeenCalledOnce();

    resolveInfo({ 'anthropic/claude-sonnet-4': modelInfo });
    await Promise.all([firstLoad, secondLoad]);

    expect(store.modelInfoByAgent['agent-1'][localModel.id]).toEqual(modelInfo);
    expect(store.modelInfoByAgent['agent-2'][localModel.id]).toEqual(modelInfo);
  });

  it('caches unknown model info until an explicit model refresh', async () => {
    const store = createStore();
    mockClient.listModels.mockResolvedValue([localModel]);
    mockClient.refreshAndListModels.mockResolvedValue([localModel]);
    mockClient.getModelInfo.mockResolvedValueOnce({ 'anthropic/claude-sonnet-4': null });

    await store.loadInitialModelsForAgent('agent-1');
    await store.loadInitialModelsForAgent('agent-1');
    expect(mockClient.getModelInfo).toHaveBeenCalledOnce();
    expect(store.modelInfoByAgent['agent-1'][localModel.id]).toBeNull();

    mockClient.getModelInfo.mockResolvedValueOnce({ 'anthropic/claude-sonnet-4': modelInfo });
    await store.refreshModelsForAgent('agent-1');

    expect(mockClient.getModelInfo).toHaveBeenCalledTimes(2);
    expect(store.modelInfoByAgent['agent-1'][localModel.id]).toEqual(modelInfo);
  });
});

describe('AgentsStore delegate model assignments', () => {
  const assignmentState: DelegateAssignmentsInfo = {
    version: 1,
    reasoning_effort_supported: true,
    session_id: 'session-1',
    profile_id: 'quorum',
    revision: 2,
    durable: true,
    editable: true,
    assignments: [{
      agent_id: 'coder',
      name: 'Coder',
      description: 'Writes code',
      model: null,
      source: DelegateAssignmentSource.ProfileDefault,
      configured_default_model_id: 'codex/gpt-5.6-sol',
      reasoning_effort: null
    }],
    orphaned_overrides: []
  };

  function selectSession(store: AgentsStore) {
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
  }

  it('exposes routing only when the current session has delegate roles', async () => {
    const store = createStore();
    selectSession(store);
    await store.connectAgent('agent-1');

    expect(store.canConfigureDelegateModels('agent-1')).toBe(false);

    store.delegateAssignmentsBySession = { 'agent-1:session-1': { ...assignmentState, assignments: [] } };
    expect(store.canConfigureDelegateModels('agent-1')).toBe(false);

    store.delegateAssignmentsBySession = { 'agent-1:session-1': assignmentState };
    expect(store.canConfigureDelegateModels('agent-1')).toBe(true);

    store.delegateAssignmentsBySession = {
      'agent-1:session-1': {
        ...assignmentState,
        assignments: [],
        orphaned_overrides: [{ agent_id: 'removed-role', model: { model_id: 'legacy/model' }, reasoning_effort: null }]
      }
    };
    expect(store.canConfigureDelegateModels('agent-1')).toBe(true);
  });

  it('keeps routing available after the initial assignment read fails', async () => {
    const store = createStore();
    selectSession(store);
    mockClient.getDelegateModels.mockRejectedValueOnce(new Error('Failed to load delegate models.'));
    await store.connectAgent('agent-1');

    expect(store.activeDelegateAssignments).toBeNull();
    expect(store.activeDelegateAssignmentsError).toBe('Failed to load delegate models.');
    expect(store.canConfigureDelegateModels('agent-1')).toBe(true);

    mockClient.getDelegateModels.mockResolvedValueOnce(assignmentState);
    await store.refreshDelegateAssignments('agent-1', 'session-1');

    expect(store.activeDelegateAssignmentsError).toBeNull();
    expect(store.canConfigureDelegateModels('agent-1')).toBe(true);
  });

  it('loads authoritative assignments with session history and writes with the current revision', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Delegates', cwd: '/tmp/work',
        updatedAt: '2026-09-08T09:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    mockClient.getDelegateModels
      .mockResolvedValueOnce(assignmentState)
      .mockResolvedValueOnce({
        ...assignmentState,
        revision: 3,
        assignments: [{
          ...assignmentState.assignments[0],
          model: { model_id: 'xai/grok-4.6', node_id: 'node-1' },
          source: DelegateAssignmentSource.Override
        }]
      });

    await store.loadSession('agent-1', 'session-1');
    await vi.waitFor(() => expect(store.activeDelegateAssignments).toEqual(assignmentState));

    await expect(store.setActiveDelegateModel('coder', { model_id: 'xai/grok-4.6', node_id: 'node-1' })).resolves.toBe(true);
    expect(mockClient.setDelegateModel).toHaveBeenCalledWith({
      session_id: 'session-1',
      agent_id: 'coder',
      model_id: 'xai/grok-4.6',
      node_id: 'node-1',
      expected_revision: 2
    });
    expect(store.activeDelegateAssignments?.revision).toBe(3);
    expect(store.activeDelegateAssignmentPending.coder).toBeUndefined();
  });

  it('does not delay session rendering while assignment readback is pending', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Delegates', cwd: '/tmp/work',
        updatedAt: '2026-09-08T09:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    let resolveAssignments!: (state: DelegateAssignmentsInfo) => void;
    mockClient.getDelegateModels.mockImplementationOnce(
      () => new Promise<DelegateAssignmentsInfo>((resolve) => { resolveAssignments = resolve; })
    );

    await store.loadSession('agent-1', 'session-1');

    expect(mockClient.getDelegateModels).toHaveBeenCalledWith({ session_id: 'session-1' });
    expect(store.activeDelegateAssignmentsLoading).toBe(true);
    resolveAssignments(assignmentState);
    await vi.waitFor(() => expect(store.activeDelegateAssignments).toEqual(assignmentState));
  });

  it('writes explicit reasoning and can restore parent-session inheritance', async () => {
    const store = createStore();
    selectSession(store);
    store.delegateAssignmentsBySession = { 'agent-1:session-1': assignmentState };
    mockClient.setDelegateModel.mockResolvedValueOnce({
      version: 1,
      reasoning_effort_supported: true,
      session_id: 'session-1',
      agent_id: 'coder',
      model: null,
      reasoning_effort: DelegateReasoningEffort.High,
      revision: 3,
      durable: true
    });
    mockClient.getDelegateModels.mockResolvedValueOnce({
      ...assignmentState,
      revision: 3,
      assignments: [{
        ...assignmentState.assignments[0],
        reasoning_effort: DelegateReasoningEffort.High
      }]
    });

    await expect(store.setActiveDelegateModel('coder', null, DelegateReasoningEffort.High)).resolves.toBe(true);

    expect(mockClient.setDelegateModel).toHaveBeenCalledWith({
      session_id: 'session-1',
      agent_id: 'coder',
      model_id: null,
      node_id: null,
      reasoning_effort: DelegateReasoningEffort.High,
      expected_revision: 2
    });
    expect(store.activeDelegateAssignments?.assignments[0].reasoning_effort).toBe(DelegateReasoningEffort.High);

    mockClient.setDelegateModel.mockResolvedValueOnce({
      version: 1,
      reasoning_effort_supported: true,
      session_id: 'session-1',
      agent_id: 'coder',
      model: null,
      reasoning_effort: null,
      revision: 4,
      durable: true
    });
    mockClient.getDelegateModels.mockResolvedValueOnce({ ...assignmentState, revision: 4 });
    await expect(store.setActiveDelegateModel('coder', null, null)).resolves.toBe(true);
    expect(mockClient.setDelegateModel).toHaveBeenLastCalledWith({
      session_id: 'session-1',
      agent_id: 'coder',
      model_id: null,
      node_id: null,
      reasoning_effort: null,
      expected_revision: 3
    });
  });

  it('rejects reasoning writes but preserves model-only cleanup for an older backend', async () => {
    const store = createStore();
    selectSession(store);
    const oldBackendState: DelegateAssignmentsInfo = {
      ...assignmentState,
      reasoning_effort_supported: undefined,
      assignments: [],
      orphaned_overrides: [{ agent_id: 'removed-role', model: { model_id: 'legacy/model' } }]
    };
    store.delegateAssignmentsBySession = { 'agent-1:session-1': oldBackendState };

    await expect(store.setActiveDelegateModel('removed-role', null, null)).resolves.toBe(false);
    expect(mockClient.setDelegateModel).not.toHaveBeenCalled();

    mockClient.setDelegateModel.mockResolvedValueOnce({
      version: 1,
      session_id: 'session-1',
      agent_id: 'removed-role',
      model: null,
      revision: 3,
      durable: true
    });
    mockClient.getDelegateModels.mockResolvedValueOnce({
      ...oldBackendState,
      revision: 3,
      orphaned_overrides: []
    });

    await expect(store.setActiveDelegateModel('removed-role', null)).resolves.toBe(true);
    expect(mockClient.setDelegateModel).toHaveBeenCalledWith({
      session_id: 'session-1',
      agent_id: 'removed-role',
      model_id: null,
      node_id: null,
      expected_revision: 2
    });
  });

  it('omits revision checking for run-only storage by sending a null expected revision', async () => {
    const store = createStore();
    selectSession(store);
    const runOnlyState: DelegateAssignmentsInfo = { ...assignmentState, revision: null, durable: false };
    store.delegateAssignmentsBySession = { 'agent-1:session-1': runOnlyState };
    mockClient.setDelegateModel.mockResolvedValueOnce({
      version: 1,
      reasoning_effort_supported: true,
      session_id: 'session-1',
      agent_id: 'coder',
      model: { model_id: 'xai/grok-4.6' },
      reasoning_effort: null,
      revision: null,
      durable: false
    });
    mockClient.getDelegateModels.mockResolvedValueOnce({
      ...runOnlyState,
      assignments: [{
        ...runOnlyState.assignments[0],
        model: { model_id: 'xai/grok-4.6' },
        source: DelegateAssignmentSource.Override
      }]
    });

    await expect(store.setActiveDelegateModel('coder', { model_id: 'xai/grok-4.6' })).resolves.toBe(true);

    expect(mockClient.setDelegateModel).toHaveBeenCalledWith({
      session_id: 'session-1',
      agent_id: 'coder',
      model_id: 'xai/grok-4.6',
      node_id: null,
      expected_revision: null
    });
    expect(store.activeDelegateAssignments?.revision).toBeNull();
    expect(store.activeDelegateAssignments?.durable).toBe(false);
  });

  it('preserves local reasoning when a model-only confirmation omits it and readback fails', async () => {
    const store = createStore();
    selectSession(store);
    store.delegateAssignmentsBySession = {
      'agent-1:session-1': {
        ...assignmentState,
        assignments: [{
          ...assignmentState.assignments[0],
          model: { model_id: 'codex/gpt-5.6-sol' },
          source: DelegateAssignmentSource.Override,
          reasoning_effort: DelegateReasoningEffort.High
        }]
      }
    };
    mockClient.setDelegateModel.mockResolvedValueOnce({
      version: 1,
      session_id: 'session-1',
      agent_id: 'coder',
      model: { model_id: 'xai/grok-4.6' },
      revision: 3,
      durable: true
    });
    mockClient.getDelegateModels.mockRejectedValueOnce(new Error('Failed to load delegate models.'));

    await expect(store.setActiveDelegateModel('coder', { model_id: 'xai/grok-4.6' })).resolves.toBe(true);

    expect(store.activeDelegateAssignments?.assignments[0]).toMatchObject({
      model: { model_id: 'xai/grok-4.6' },
      source: DelegateAssignmentSource.Override,
      reasoning_effort: DelegateReasoningEffort.High
    });
    expect(store.activeDelegateAssignmentsError).toBe('Failed to load delegate models.');
  });

  it('preserves orphaned reasoning when a model-only confirmation omits it and readback fails', async () => {
    const store = createStore();
    selectSession(store);
    store.delegateAssignmentsBySession = {
      'agent-1:session-1': {
        ...assignmentState,
        assignments: [],
        orphaned_overrides: [{
          agent_id: 'removed-role',
          model: { model_id: 'legacy/model' },
          reasoning_effort: DelegateReasoningEffort.High
        }]
      }
    };
    mockClient.setDelegateModel.mockResolvedValueOnce({
      version: 1,
      session_id: 'session-1',
      agent_id: 'removed-role',
      model: { model_id: 'xai/grok-4.6' },
      revision: 3,
      durable: true
    });
    mockClient.getDelegateModels.mockRejectedValueOnce(new Error('Failed to load delegate models.'));

    await expect(store.setActiveDelegateModel('removed-role', { model_id: 'xai/grok-4.6' })).resolves.toBe(true);

    expect(store.activeDelegateAssignments?.orphaned_overrides[0]).toMatchObject({
      agent_id: 'removed-role',
      model: { model_id: 'xai/grok-4.6' },
      reasoning_effort: DelegateReasoningEffort.High
    });
    expect(store.activeDelegateAssignmentsError).toBe('Failed to load delegate models.');
  });

  it('serializes rapid writes and keeps role pending until its final write completes', async () => {
    const store = createStore();
    selectSession(store);
    store.delegateAssignmentsBySession = { 'agent-1:session-1': assignmentState };
    let resolveFirst!: (response: SetDelegateModelResponse) => void;
    let resolveSecond!: (response: SetDelegateModelResponse) => void;
    mockClient.setDelegateModel
      .mockImplementationOnce(() => new Promise<SetDelegateModelResponse>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<SetDelegateModelResponse>((resolve) => { resolveSecond = resolve; }));
    mockClient.getDelegateModels
      .mockResolvedValueOnce({
        ...assignmentState,
        revision: 3,
        assignments: [{
          ...assignmentState.assignments[0],
          model: { model_id: 'xai/grok-4.6' },
          source: DelegateAssignmentSource.Override
        }]
      })
      .mockResolvedValueOnce({
        ...assignmentState,
        revision: 4,
        assignments: [{
          ...assignmentState.assignments[0],
          model: { model_id: 'codex/gpt-5.6-sol' },
          source: DelegateAssignmentSource.Override
        }]
      });

    const first = store.setActiveDelegateModel('coder', { model_id: 'xai/grok-4.6' });
    const second = store.setActiveDelegateModel('coder', { model_id: 'codex/gpt-5.6-sol' });
    await vi.waitFor(() => expect(mockClient.setDelegateModel).toHaveBeenCalledTimes(1));
    expect(store.activeDelegateAssignmentPending.coder).toBe(true);

    resolveFirst({
      version: 1,
      reasoning_effort_supported: true,
      session_id: 'session-1',
      agent_id: 'coder',
      model: { model_id: 'xai/grok-4.6' },
      reasoning_effort: null,
      revision: 3,
      durable: true
    });
    await expect(first).resolves.toBe(true);
    await vi.waitFor(() => expect(mockClient.setDelegateModel).toHaveBeenCalledTimes(2));
    expect(mockClient.setDelegateModel).toHaveBeenLastCalledWith({
      session_id: 'session-1',
      agent_id: 'coder',
      model_id: 'codex/gpt-5.6-sol',
      node_id: null,
      expected_revision: 3
    });
    expect(store.activeDelegateAssignmentPending.coder).toBe(true);

    resolveSecond({
      version: 1,
      reasoning_effort_supported: true,
      session_id: 'session-1',
      agent_id: 'coder',
      model: { model_id: 'codex/gpt-5.6-sol' },
      reasoning_effort: null,
      revision: 4,
      durable: true
    });
    await expect(second).resolves.toBe(true);
    expect(store.activeDelegateAssignmentPending.coder).toBeUndefined();
    expect(store.activeDelegateAssignments?.revision).toBe(4);
  });

  it('refreshes after a conflict and requires user review instead of retrying the write', async () => {
    const store = createStore();
    selectSession(store);
    store.delegateAssignmentsBySession = { 'agent-1:session-1': assignmentState };
    mockClient.setDelegateModel.mockRejectedValueOnce(
      new RequestError(-32602, 'Invalid params', {
        code: 'delegate_assignment_conflict',
        expected_revision: 2,
        actual_revision: 3,
        message: 'Delegate assignments changed; refresh before retrying'
      })
    );
    mockClient.getDelegateModels.mockResolvedValueOnce({ ...assignmentState, revision: 3 });

    await expect(store.setActiveDelegateModel('coder', { model_id: 'xai/grok-4.6' })).resolves.toBe(false);

    expect(mockClient.setDelegateModel).toHaveBeenCalledTimes(1);
    expect(mockClient.getDelegateModels).toHaveBeenCalledWith({ session_id: 'session-1' });
    expect(store.activeDelegateAssignmentConflict).toBe(true);
    expect(store.activeDelegateAssignments?.revision).toBe(3);
  });

  it('refreshes the selected session when an assignment invalidation arrives', async () => {
    const store = createStore();
    selectSession(store);
    await store.connectAgent('agent-1');
    mockClient.getDelegateModels.mockResolvedValueOnce(assignmentState);

    mockClient.emitExtensionNotification({
      method: 'querymt/session/delegateModelsChanged',
      params: { version: 1, session_id: 'session-1', revision: 2 }
    });

    await vi.waitFor(() => expect(mockClient.getDelegateModels).toHaveBeenCalledWith({ session_id: 'session-1' }));
    expect(store.activeDelegateAssignments).toEqual(assignmentState);
  });

  it('attaches child session ids from live delegation updates', async () => {
    const store = createStore();
    selectSession(store);
    store.activeSession.toolCalls = [{
      id: 'delegate-1',
      title: 'Run delegate',
      status: 'in_progress',
      kind: 'delegate',
      arguments: '{"target_agent_id":"linus","objective":"Review the current bearer-auth diff"}'
    }];
    await store.connectAgent('agent-1');

    mockClient.emitExtensionNotification({
      method: 'querymt/session/delegationUpdate',
      params: {
        version: 1,
        sessionId: 'session-1',
        toolCallId: 'delegate-1',
        childSessionId: 'child-session-1',
        state: 'forked',
        targetAgentId: 'linus',
        objective: 'Review the current bearer-auth diff'
      }
    });

    expect(store.activeSession.toolCalls[0]?.childSessionId).toBe('child-session-1');
  });

  it('exposes unavailable and orphaned assignments without altering them on read', async () => {
    const store = createStore();
    selectSession(store);
    const state = {
      ...assignmentState,
      assignments: [{
        ...assignmentState.assignments[0],
        model: { model_id: 'missing/model', node_id: 'offline-node' },
        source: DelegateAssignmentSource.Override
      }],
      orphaned_overrides: [{
        agent_id: 'removed-role',
        model: { model_id: 'legacy/model' },
        reasoning_effort: null
      }]
    };
    mockClient.getDelegateModels.mockResolvedValueOnce(state);

    await store.refreshDelegateAssignments();

    expect(store.activeDelegateAssignments).toEqual(state);
    expect(mockClient.setDelegateModel).not.toHaveBeenCalled();
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
      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        'session-1',
        'Fix the failing tests',
        [],
        expect.objectContaining({ imageMode: 'image', clientPromptId: expect.any(String) })
      );
    });
    resolvePrompt();
  });

  it('sends attachment-only prompts and keeps structured optimistic blocks', async () => {
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = '';
    store.promptAttachments = [
      { id: 'image-1', name: 'photo.png', mimeType: 'image/png', size: 3, data: 'aW1n' },
      { id: 'file-1', name: 'notes.txt', mimeType: 'text/plain', size: 4, data: 'dGV4dA==' }
    ];

    await store.sendPromptToActiveSession();

    expect(mockClient.sendPrompt).toHaveBeenCalledWith(
      'session-1',
      '',
      expect.arrayContaining([expect.objectContaining({ id: 'image-1' }), expect.objectContaining({ id: 'file-1' })]),
      expect.objectContaining({ imageMode: 'image', clientPromptId: expect.any(String) })
    );
    expect(store.activeSession.transcript[0].blocks?.map((block) => block.type)).toEqual(['image', 'resource']);
    expect(store.promptAttachments).toEqual([]);
  });

  it('preserves the draft when native image capability preflight fails', async () => {
    mockClient.supportsImagePrompts.mockReturnValueOnce(false);
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Review';
    store.promptAttachments = [{ id: 'image-1', name: 'photo.png', mimeType: 'image/png', size: 3, data: 'aW1n' }];

    await store.sendPromptToActiveSession();

    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(store.composerPrompt).toBe('Review');
    expect(store.promptAttachments).toHaveLength(1);
    expect(store.activeSession.transcript).toEqual([]);
    expect(store.error).toContain('does not support native image prompts');
  });

  it('preserves the draft when embedded resource capability preflight fails', async () => {
    mockClient.supportsEmbeddedContext.mockReturnValueOnce(false);
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Review';
    store.promptAttachments = [{ id: 'file-1', name: 'notes.pdf', mimeType: 'application/pdf', size: 4, data: 'cGRm' }];

    await store.sendPromptToActiveSession();

    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(store.composerPrompt).toBe('Review');
    expect(store.promptAttachments).toHaveLength(1);
    expect(store.activeSession.transcript).toEqual([]);
    expect(store.error).toContain('does not support embedded resources');
  });

  it('stores structured provider failures against the failed turn', async () => {
    mockClient.sendPrompt.mockRejectedValueOnce(
      new RequestError(-32010, 'Provider request failed', {
        category: 'provider',
        kind: 'quota_exceeded',
        message: 'The usage limit has been reached',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        retryable: false
      })
    );
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';

    await store.sendPromptToActiveSession();

    expect(store.promptFailure).toEqual(
      expect.objectContaining({
        kind: 'quota_exceeded',
        title: 'Usage limit reached',
        message: 'The usage limit has been reached',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        retryable: false,
        sessionId: 'session-1',
        turnEventIndex: 0,
        prompt: 'Fix the failing tests',
        attachments: []
      })
    );
    expect(store.error).toBe(null);
    expect(store.activeSession.runState).toBe('failed');
    expect(store.activeSession.activityLabel).toBe('Usage limit reached');
  });

  it('retries transient prompt failures with the original prompt', async () => {
    mockClient.sendPrompt
      .mockRejectedValueOnce(
        new RequestError(-32010, 'Provider request failed', {
          category: 'provider',
          kind: 'rate_limited',
          message: 'Try again shortly',
          provider: 'codex',
          model: 'gpt-5.6-sol',
          retryable: true
        })
      )
      .mockResolvedValueOnce({ stopReason: 'end_turn' });
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';

    await store.sendPromptToActiveSession();
    await store.retryPromptFailure();

    expect(mockClient.sendPrompt).toHaveBeenNthCalledWith(
      2,
      'session-1',
      'Fix the failing tests',
      [],
      expect.objectContaining({ imageMode: 'image', clientPromptId: expect.any(String) })
    );
    expect(store.promptFailure).toBe(null);
    expect(store.promptRetryPending).toBe(false);
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
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'mode' })
    );
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'reasoning_effort' })
    );
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
      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        'session-1',
        'Fix the failing tests',
        [],
        expect.objectContaining({ imageMode: 'image', clientPromptId: expect.any(String) })
      );
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
    const clientPromptId = mockClient.sendPrompt.mock.calls[0]?.[3]?.clientPromptId as string;
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Fix the failing tests' },
        messageId: 'real-user',
        _meta: { querymt: { client_prompt_id: clientPromptId } }
      }
    } as SessionNotification);

    expect(store.activeSession.transcript.find((item) => item.messageId === 'real-user')).toMatchObject({ eventIndex: 19 });
    expect(store.activeSession.toolCalls[0]).toMatchObject({ id: 'question-1', eventIndex: 20 });
    expect(store.activeSession.transcript.filter((item) => item.text === 'Fix the failing tests')).toHaveLength(1);

    resolvePrompt();
  });

  it('replaces optimistic slash text and rebuilds ordered authoritative blocks by client prompt ID', async () => {
    let resolvePrompt!: () => void;
    mockClient.sendPrompt.mockImplementationOnce(
      () => new Promise<PromptResponse>((resolve) => {
        resolvePrompt = () => resolve({ stopReason: 'end_turn' });
      })
    );
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.composerPrompt = '/review';
    store.promptAttachments = [
      { id: 'image-1', name: 'photo.png', mimeType: 'image/png', size: 3, data: 'aW1n' },
      { id: 'file-1', name: 'notes.pdf', mimeType: 'application/pdf', size: 4, data: 'cGRm' }
    ];

    void store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalled());
    const clientPromptId = mockClient.sendPrompt.mock.calls[0]?.[3]?.clientPromptId as string;
    expect(store.activeSession.transcript[0].blocks?.map((block) => block.type)).toEqual(['text', 'image', 'resource']);

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Review the current changes' },
        messageId: 'canonical-user-1',
        _meta: { querymt: { client_prompt_id: clientPromptId } }
      }
    } as SessionNotification);
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: {
          type: 'image',
          data: 'aW1n',
          mimeType: 'image/png',
          _meta: { querymt: { client_prompt_id: clientPromptId, filename: 'photo.png' } }
        },
        messageId: 'canonical-user-1'
      }
    } as SessionNotification);
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      metadata: { querymt: { clientPromptId } },
      update: {
        sessionUpdate: 'user_message_chunk',
        content: {
          type: 'resource',
          resource: { uri: 'attachment:///file-1/notes.pdf', blob: 'cGRm', mimeType: 'application/pdf' },
          _meta: { querymt: { filename: 'notes.pdf' } }
        },
        messageId: 'canonical-user-1'
      }
    } as SessionNotification);

    expect(store.activeSession.transcript).toHaveLength(3);
    expect(store.activeSession.transcript.map((item) => item.messageId)).toEqual([
      'canonical-user-1',
      'canonical-user-1',
      'canonical-user-1'
    ]);
    expect(store.activeSession.transcript.map((item) => item.eventIndex)).toEqual([0, 0, 0]);
    expect(store.activeSession.transcript.flatMap((item) => item.blocks ?? []).map((block) => block.type)).toEqual([
      'text',
      'image',
      'resource'
    ]);
    expect(store.activeSession.transcript[0].text).toBe('Review the current changes');
    expect(store.activeSession.transcript.some((item) => item.text === '/review')).toBe(false);
    expect(store.activeSession.transcript.flatMap((item) => item.blocks ?? []).filter((block) => block.type === 'image')).toHaveLength(1);
    resolvePrompt();
  });

  it('uses correlation IDs to keep identical in-flight prompts associated with their reserved positions', async () => {
    const promptResolvers: Array<() => void> = [];
    mockClient.sendPrompt.mockImplementation(
      () => new Promise<PromptResponse>((resolve) => {
        promptResolvers.push(() => resolve({ stopReason: 'end_turn' }));
      })
    );
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.composerPrompt = 'same prompt';

    void store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledTimes(1));
    const firstClientId = mockClient.sendPrompt.mock.calls[0]?.[3]?.clientPromptId as string;
    store.composerPrompt = 'same prompt';
    void store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledTimes(2));
    const secondClientId = mockClient.sendPrompt.mock.calls[1]?.[3]?.clientPromptId as string;

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'same prompt' },
        messageId: 'canonical-second',
        _meta: { querymt: { client_prompt_id: secondClientId } }
      }
    } as SessionNotification);
    expect(store.activeSession.transcript.find((item) => item.messageId === 'canonical-second')).toMatchObject({ eventIndex: 1 });
    expect(store.activeSession.transcript.find((item) => item.clientPromptId === firstClientId)?.id).toContain('-optimistic-user-');

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'same prompt' },
        messageId: 'canonical-first',
        _meta: { querymt: { client_prompt_id: firstClientId } }
      }
    } as SessionNotification);

    expect(store.activeSession.transcript.filter((item) => item.id.includes('-optimistic-user-'))).toHaveLength(0);
    expect(store.activeSession.transcript.find((item) => item.messageId === 'canonical-first')).toMatchObject({ eventIndex: 0 });
    expect(store.activeSession.transcript.find((item) => item.messageId === 'canonical-second')).toMatchObject({ eventIndex: 1 });
    promptResolvers.forEach((resolve) => resolve());
  });

  it('does not content-match identical optimistic prompts when correlation metadata is absent', async () => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.transcript = [
      { id: 'session-1-optimistic-user-1', kind: 'user_message_chunk', text: 'same', blocks: [{ type: 'text', text: 'same' }], messageId: 'session-1-optimistic-user-1', clientPromptId: 'client-1', eventIndex: 0 },
      { id: 'session-1-optimistic-user-2', kind: 'user_message_chunk', text: 'same', blocks: [{ type: 'text', text: 'same' }], messageId: 'session-1-optimistic-user-2', clientPromptId: 'client-2', eventIndex: 1 }
    ];

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'same' },
        messageId: 'uncorrelated-server-message'
      }
    });

    expect(store.activeSession.transcript.filter((item) => item.id.includes('-optimistic-user-'))).toHaveLength(2);
    expect(store.activeSession.transcript.find((item) => item.messageId === 'uncorrelated-server-message')).toMatchObject({ eventIndex: 2 });
  });

  it('reconciles an image-only prompt when the agent echoes the attachment id without data', async () => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.transcript = [
      {
        id: 'session-1-optimistic-user-1',
        kind: 'user_message_chunk',
        text: '',
        blocks: [{ type: 'image', data: 'aW1n', mimeType: 'image/png', id: 'att-1', name: 'photo.png' }],
        messageId: 'session-1-optimistic-user-1',
        clientPromptId: 'client-1',
        eventIndex: 0
      }
    ];

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: {
          type: 'image',
          data: '',
          mimeType: 'image/png',
          _meta: { querymt: { attachment_id: 'att-1', filename: 'photo.png' } }
        },
        messageId: 'authoritative-1'
      }
    });

    expect(store.activeSession.transcript.filter((item) => item.id.includes('-optimistic-user-'))).toHaveLength(0);
    expect(store.activeSession.transcript.find((item) => item.messageId === 'authoritative-1')).toMatchObject({ eventIndex: 0 });
  });

  it('reconciles an image-only prompt when the agent echoes the resource uri without data', async () => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.transcript = [
      {
        id: 'session-1-optimistic-user-1',
        kind: 'user_message_chunk',
        text: '',
        blocks: [{ type: 'image', data: 'Y2hhcnQ=', mimeType: 'image/png', id: 'att-2', name: 'chart.png' }],
        messageId: 'session-1-optimistic-user-1',
        clientPromptId: 'client-1',
        eventIndex: 0
      }
    ];

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: {
          type: 'resource',
          resource: {
            uri: `attachment:///${encodeURIComponent('att-2')}/${encodeURIComponent('chart.png')}`,
            mimeType: 'image/png'
          }
        },
        messageId: 'authoritative-2'
      }
    });

    expect(store.activeSession.transcript.filter((item) => item.id.includes('-optimistic-user-'))).toHaveLength(0);
    expect(store.activeSession.transcript.find((item) => item.messageId === 'authoritative-2')).toMatchObject({ eventIndex: 0 });
  });

  it('reconciles an image-only prompt when the agent echoes a bare resource link', async () => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.transcript = [
      {
        id: 'session-1-optimistic-user-1',
        kind: 'user_message_chunk',
        text: '',
        blocks: [{ type: 'image', data: 'Y2hhcnQ=', mimeType: 'image/png', id: 'att-3', name: 'chart.png' }],
        messageId: 'session-1-optimistic-user-1',
        clientPromptId: 'client-1',
        eventIndex: 0
      }
    ];

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: {
          type: 'resource_link',
          uri: `attachment:///${encodeURIComponent('att-3')}/${encodeURIComponent('chart.png')}`,
          name: 'chart.png',
          mimeType: 'image/png'
        },
        messageId: 'authoritative-3'
      }
    });

    expect(store.activeSession.transcript.filter((item) => item.id.includes('-optimistic-user-'))).toHaveLength(0);
    expect(store.activeSession.transcript.find((item) => item.messageId === 'authoritative-3')).toMatchObject({ eventIndex: 0 });
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
      expect(mockClient.sendPrompt).toHaveBeenCalledWith(
        'session-1',
        'Fix the failing tests',
        [],
        expect.objectContaining({ imageMode: 'image', clientPromptId: expect.any(String) })
      );
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

  it('applies the first stream chunk immediately and coalesces later chunks on the next animation frame', async () => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';

    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Hel' },
        messageId: 'thought-1'
      }
    });
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'lo' },
        messageId: 'thought-1'
      }
    });
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: ' world' },
        messageId: 'thought-1'
      }
    });

    expect(store.activeSession.transcript).toHaveLength(1);
    expect(store.activeSession.transcript[0].text).toBe('Hel');
    expect(frames).toHaveLength(1);

    frames[0](0);

    expect(store.activeSession.transcript).toHaveLength(1);
    expect(store.activeSession.transcript[0]).toMatchObject({ text: 'Hello world', messageId: 'thought-1' });
    expect(store.activeSession.events).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('flushes queued stream chunks before applying a tool call in the same turn', async () => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';

    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames.length = 0;
    });

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Hel' },
        messageId: 'thought-1'
      }
    });
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'lo' },
        messageId: 'thought-1'
      }
    });
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read file',
        status: 'in_progress',
        content: []
      }
    });

    expect(store.activeSession.transcript[0]).toMatchObject({ text: 'Hello' });
    expect(store.activeSession.toolCalls[0]).toMatchObject({ id: 'tool-1', title: 'Read file' });
    expect(store.activeSession.events.map((event) => event.kind)).toEqual(['agent_thought_chunk', 'tool_call']);
    vi.unstubAllGlobals();
  });

  it('cancels pending session refresh timers on dispose', async () => {
    vi.useFakeTimers();
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Hel' },
        messageId: 'thought-1'
      }
    });

    const listSessionsCalls = mockClient.listSessions.mock.calls.length;
    store.dispose();
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockClient.listSessions).toHaveBeenCalledTimes(listSessionsCalls);
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
    expect(store.getSessionModelId('agent-1', 'session-1')).toBe('claude-3-5');
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
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, listSessionsRequest());
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, listSessionsRequest({ cursor: 'remote-page-2' }));
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
    expect(mockClient.listSessions).toHaveBeenCalledWith(listSessionsRequest({ cursor: 'reconnect-page-2' }));
    expect(store.connectionStates['remote-agent']).toBe('initialized');
    vi.useRealTimers();
  });

  it('reuses a single in-flight connect for overlapping callers', async () => {
    let releaseConnect: () => void = () => {};
    mockClient.connect.mockImplementationOnce(
      () =>
        new Promise<InitializeResponse>((resolve) => {
          releaseConnect = () =>
            resolve({
              protocolVersion: 1,
              agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
              authMethods: []
            });
        })
    );
    const store = createStore();

    const first = store.connectAgent('agent-1');
    const second = store.connectAgent('agent-1');
    releaseConnect();
    await Promise.all([first, second]);

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.disconnect).not.toHaveBeenCalled();
    expect(store.connectionStates['agent-1']).toBe('initialized');
  });

  it('joins a live handshake instead of force-disconnecting it', async () => {
    let releaseConnect: () => void = () => {};
    mockClient.connect.mockImplementationOnce(
      () =>
        new Promise<InitializeResponse>((resolve) => {
          releaseConnect = () =>
            resolve({
              protocolVersion: 1,
              agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
              authMethods: []
            });
        })
    );
    const store = createStore();

    const first = store.connectAgent('agent-1');
    const forced = store.connectAgent('agent-1', true);
    releaseConnect();
    await Promise.all([first, forced]);

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.disconnect).not.toHaveBeenCalled();
    expect(store.connectionStates['agent-1']).toBe('initialized');
  });

  it('waits for connect before listing on a fresh reload when initialize starts first', async () => {
    let releaseConnect: () => void = () => {};
    let connectStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      connectStarted = resolve;
    });
    mockClient.connect.mockImplementationOnce(async () => {
      connectStarted();
      await new Promise<void>((resolve) => {
        releaseConnect = resolve;
      });
      return {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
        authMethods: []
      };
    });
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    mockClient.listSessions.mockResolvedValue({ sessions: [] });
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
    expect(store.sessionsByAgent['remote-agent'] ?? []).toEqual([]);

    const initializePromise = store.initialize();
    await started;
    const loadPromise = store.loadSession('remote-agent', 'session-1');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    releaseConnect();
    await Promise.all([initializePromise, loadPromise]);

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.disconnect).not.toHaveBeenCalled();
    expect(mockClient.listSessions).toHaveBeenCalled();
    expect(mockClient.loadSession).toHaveBeenCalledWith('session-1', '/tmp/work');
    expect(store.loading).toBe(false);
    expect(store.connectionStates['remote-agent']).toBe('initialized');
    expect(store.error).toBeNull();
  });

  it('waits for connect before listing on a fresh reload when loadSession starts first', async () => {
    let releaseConnect: () => void = () => {};
    let connectStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      connectStarted = resolve;
    });
    mockClient.connect.mockImplementationOnce(async () => {
      connectStarted();
      await new Promise<void>((resolve) => {
        releaseConnect = resolve;
      });
      return {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
        authMethods: []
      };
    });
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    mockClient.listSessions.mockResolvedValue({ sessions: [] });
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
    expect(store.sessionsByAgent['remote-agent'] ?? []).toEqual([]);

    const loadPromise = store.loadSession('remote-agent', 'session-1');
    await started;
    const initializePromise = store.initialize();
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    releaseConnect();
    await Promise.all([loadPromise, initializePromise]);

    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.disconnect).not.toHaveBeenCalled();
    expect(mockClient.listSessions).toHaveBeenCalled();
    expect(mockClient.loadSession).toHaveBeenCalledWith('session-1', '/tmp/work');
    expect(store.loading).toBe(false);
    expect(store.connectionStates['remote-agent']).toBe('initialized');
    expect(store.error).toBeNull();
  });

  it('wakes in-flight connect waiters after connection loss and starts a new handshake', async () => {
    const initializeResponse: InitializeResponse = {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: []
    };
    const pendingResolvers: Array<(value: InitializeResponse) => void> = [];
    let holdConnect = true;
    mockClient.connect.mockImplementation(
      () => {
        if (!holdConnect) {
          return Promise.resolve(initializeResponse);
        }
        return new Promise<InitializeResponse>((resolve) => {
          pendingResolvers.push(resolve);
        });
      }
    );
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    mockClient.listSessions.mockResolvedValue({ sessions: [] });
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

    const initializePromise = store.initialize();
    await vi.waitFor(() => expect(pendingResolvers).toHaveLength(1));
    const waiter = store.connectAgent('remote-agent');
    expect(mockClient.connect).toHaveBeenCalledTimes(1);

    mockClient.emitConnectionLoss('WebSocket closed (code 1006).');

    await vi.waitFor(() => expect(pendingResolvers).toHaveLength(2));
    expect(mockClient.disconnect).toHaveBeenCalled();
    holdConnect = false;
    pendingResolvers[1]?.(initializeResponse);

    await Promise.all([initializePromise, waiter]);
    expect(store.loading).toBe(false);
    expect(store.connectionStates['remote-agent']).toBe('initialized');
    expect(store.error).toBeNull();
  });

  it('uses the replacement client after the original handshake is aborted', async () => {
    const initializeResponse: InitializeResponse = {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: []
    };
    const clientA = createDistinctMockClient();
    const clientB = createDistinctMockClient();
    const pendingClients = [clientA, clientB];
    vi.mocked(DesktopAcpClient).mockImplementation(function () {
      const next = pendingClients.shift();
      if (!next) throw new Error('unexpected extra DesktopAcpClient construction');
      return next as never;
    });

    clientA.connect.mockImplementation(() => new Promise<InitializeResponse>(() => undefined));
    clientA.supportsQuerymtFeature.mockReturnValue(false);
    clientA.listAuthProviders.mockResolvedValue([
      {
        provider: 'stale',
        display_name: 'Stale',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: false
      }
    ]);
    clientA.listSessions.mockResolvedValue({
      sessions: [{ sessionId: 'session-a', title: 'From A', cwd: '/tmp/work', updatedAt: '2026-07-18T12:00:00Z' }]
    });

    clientB.connect.mockResolvedValue(initializeResponse);
    clientB.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'auth' ? true : false);
    clientB.listAuthProviders.mockResolvedValue([
      {
        provider: 'openai',
        display_name: 'OpenAI',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: true
      }
    ]);
    clientB.listSessions.mockResolvedValue({
      sessions: [{ sessionId: 'session-b', title: 'From B', cwd: '/tmp/work', updatedAt: '2026-07-18T12:00:00Z' }]
    });

    const store = createStore();
    store.configs = [
      {
        id: 'remote-agent',
        name: 'Remote QueryMT',
        transport: 'websocket',
        commandLine: '',
        websocketUrl: '127.0.0.1:3030',
        enabled: true,
        autoStart: false
      }
    ];
    store.workspaceSessionSources = {
      'remote-agent': {
        '/tmp/work': {
          agentId: 'remote-agent',
          agentName: 'Remote QueryMT',
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

    const authPromise = store.refreshAuthProviders('remote-agent');
    const loadPromise = store.loadWorkspaceSessions('/tmp/work');
    await vi.waitFor(() => expect(clientA.connect).toHaveBeenCalledTimes(1));

    clientA.emitConnectionLoss('WebSocket closed (code 1006).');
    await vi.waitFor(() => expect(clientB.connect).toHaveBeenCalledTimes(1));
    await Promise.all([authPromise, loadPromise]);

    expect(clientA.listAuthProviders).not.toHaveBeenCalled();
    expect(clientA.listSessions).not.toHaveBeenCalled();
    expect(clientB.listAuthProviders).toHaveBeenCalledTimes(1);
    expect(clientB.listSessions).toHaveBeenCalledTimes(1);
    expect(store.authProvidersByAgent['remote-agent']).toEqual([
      expect.objectContaining({ provider: 'openai' })
    ]);
    expect(store.workspaceSessionSources['remote-agent']['/tmp/work'].sessions).toEqual([
      expect.objectContaining({ sessionId: 'session-b' })
    ]);
    expect(store.connectionStates['remote-agent']).toBe('initialized');
  });

  it('does not reconnect after an explicit disconnect while a handshake is in flight', async () => {
    const initializeResponse: InitializeResponse = {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: []
    };
    const clientA = createDistinctMockClient();
    const clientB = createDistinctMockClient();
    const pendingClients = [clientA, clientB];
    vi.mocked(DesktopAcpClient).mockImplementation(function () {
      const next = pendingClients.shift();
      if (!next) throw new Error('unexpected extra DesktopAcpClient construction');
      return next as never;
    });

    clientA.connect.mockImplementation(() => new Promise<InitializeResponse>(() => undefined));
    clientA.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'auth');
    clientA.listAuthProviders.mockResolvedValue([
      {
        provider: 'stale',
        display_name: 'Stale',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: false
      }
    ]);
    clientA.listSessions.mockResolvedValue({
      sessions: [{ sessionId: 'session-a', title: 'From A', cwd: '/tmp/work', updatedAt: '2026-07-18T12:00:00Z' }]
    });

    clientB.connect.mockResolvedValue(initializeResponse);
    clientB.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'auth');
    clientB.listAuthProviders.mockResolvedValue([
      {
        provider: 'openai',
        display_name: 'OpenAI',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: true
      }
    ]);
    clientB.listSessions.mockResolvedValue({
      sessions: [{ sessionId: 'session-b', title: 'From B', cwd: '/tmp/work', updatedAt: '2026-07-18T12:00:00Z' }]
    });

    const store = createStore();
    store.configs = [
      {
        id: 'remote-agent',
        name: 'Remote QueryMT',
        transport: 'websocket',
        commandLine: '',
        websocketUrl: '127.0.0.1:3030',
        enabled: true,
        autoStart: false
      }
    ];

    const connectPromise = store.connectAgent('remote-agent');
    const authPromise = store.refreshAuthProviders('remote-agent');
    await vi.waitFor(() => expect(clientA.connect).toHaveBeenCalledTimes(1));

    await store.stopConfiguredAgent('remote-agent');
    await Promise.all([connectPromise, authPromise]);

    expect(vi.mocked(DesktopAcpClient)).toHaveBeenCalledTimes(1);
    expect(clientB.connect).not.toHaveBeenCalled();
    expect(clientA.listAuthProviders).not.toHaveBeenCalled();
    expect(clientA.listSessions).not.toHaveBeenCalled();
    expect(clientB.listAuthProviders).not.toHaveBeenCalled();
    expect(clientB.listSessions).not.toHaveBeenCalled();
    expect(store.connectionStates['remote-agent']).toBe('idle');
    expect(store.statuses['remote-agent']?.state).toBe('stopped');
    expect(store.authProvidersByAgent['remote-agent']).toBeUndefined();

    await store.startConfiguredAgent('remote-agent');

    expect(vi.mocked(DesktopAcpClient)).toHaveBeenCalledTimes(2);
    expect(clientB.connect).toHaveBeenCalledTimes(1);
    expect(clientA.listAuthProviders).not.toHaveBeenCalled();
    expect(clientB.listAuthProviders).toHaveBeenCalledTimes(1);
    expect(store.connectionStates['remote-agent']).toBe('initialized');
    expect(store.authProvidersByAgent['remote-agent']).toEqual([
      expect.objectContaining({ provider: 'openai' })
    ]);
  });

  it('still replaces the client when restarting during an in-flight handshake', async () => {
    const initializeResponse: InitializeResponse = {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: []
    };
    const clientA = createDistinctMockClient();
    const clientB = createDistinctMockClient();
    const pendingClients = [clientA, clientB];
    vi.mocked(DesktopAcpClient).mockImplementation(function () {
      const next = pendingClients.shift();
      if (!next) throw new Error('unexpected extra DesktopAcpClient construction');
      return next as never;
    });

    clientA.connect.mockImplementation(() => new Promise<InitializeResponse>(() => undefined));
    clientA.supportsQuerymtFeature.mockReturnValue(false);
    clientA.listAuthProviders.mockResolvedValue([
      {
        provider: 'stale',
        display_name: 'Stale',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: false
      }
    ]);

    clientB.connect.mockResolvedValue(initializeResponse);
    clientB.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'auth');
    clientB.listAuthProviders.mockResolvedValue([
      {
        provider: 'openai',
        display_name: 'OpenAI',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: true
      }
    ]);
    clientB.listSessions.mockResolvedValue({ sessions: [] });

    const store = createStore();
    store.configs = [
      {
        id: 'remote-agent',
        name: 'Remote QueryMT',
        transport: 'websocket',
        commandLine: '',
        websocketUrl: '127.0.0.1:3030',
        enabled: true,
        autoStart: false
      }
    ];

    const connectPromise = store.connectAgent('remote-agent');
    const authPromise = store.refreshAuthProviders('remote-agent');
    await vi.waitFor(() => expect(clientA.connect).toHaveBeenCalledTimes(1));

    await store.restartConfiguredAgent('remote-agent');
    await Promise.all([connectPromise, authPromise]);

    expect(vi.mocked(DesktopAcpClient)).toHaveBeenCalledTimes(2);
    expect(clientA.listAuthProviders).not.toHaveBeenCalled();
    expect(clientB.connect).toHaveBeenCalledTimes(1);
    expect(clientB.listAuthProviders).toHaveBeenCalled();
    expect(store.connectionStates['remote-agent']).toBe('initialized');
    expect(store.authProvidersByAgent['remote-agent']).toEqual([
      expect.objectContaining({ provider: 'openai' })
    ]);
  });

  it('abandons in-flight websocket startup when transport is replaced with stdio', async () => {
    const initializeResponse: InitializeResponse = {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: []
    };
    const clientA = createDistinctMockClient();
    const clientB = createDistinctMockClient();
    const pendingClients = [clientA, clientB];
    vi.mocked(DesktopAcpClient).mockImplementation(function () {
      const next = pendingClients.shift();
      if (!next) throw new Error('unexpected extra DesktopAcpClient construction');
      return next as never;
    });

    clientA.connect.mockImplementation(() => new Promise<InitializeResponse>(() => undefined));
    clientA.listSessions.mockResolvedValue({
      sessions: [{ sessionId: 'session-a', title: 'From A', cwd: '/tmp/work', updatedAt: '2026-07-18T12:00:00Z' }]
    });
    clientB.connect.mockResolvedValue(initializeResponse);
    clientB.listSessions.mockResolvedValue({ sessions: [] });

    const store = createStore();
    store.configs = [
      {
        id: 'remote-agent',
        name: 'Remote QueryMT',
        transport: 'websocket',
        commandLine: '',
        websocketUrl: '127.0.0.1:3030',
        enabled: true,
        autoStart: false
      }
    ];

    const startPromise = store.startConfiguredAgent('remote-agent');
    const connectPromise = store.connectAgent('remote-agent');
    await vi.waitFor(() => expect(clientA.connect).toHaveBeenCalledTimes(1));

    store.updateConfig('remote-agent', {
      transport: 'stdio',
      commandLine: '/usr/local/bin/qmtcode --acp',
      websocketUrl: undefined
    });
    await Promise.all([startPromise, connectPromise]);

    expect(vi.mocked(DesktopAcpClient)).toHaveBeenCalledTimes(1);
    expect(clientB.connect).not.toHaveBeenCalled();
    expect(clientA.listSessions).not.toHaveBeenCalled();
    expect(clientB.listSessions).not.toHaveBeenCalled();
    expect(vi.mocked(startAgent)).not.toHaveBeenCalled();
    expect(store.configs.find((config) => config.id === 'remote-agent')).toMatchObject({
      transport: 'stdio',
      commandLine: '/usr/local/bin/qmtcode --acp'
    });
    expect(store.connectionStates['remote-agent']).not.toBe('initialized');
    expect(store.statuses['remote-agent']?.message).not.toBe('Connected over WebSocket.');

    await store.startConfiguredAgent('remote-agent');

    expect(vi.mocked(startAgent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startAgent)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'remote-agent',
        transport: 'stdio',
        commandLine: '/usr/local/bin/qmtcode --acp'
      })
    );
    expect(vi.mocked(DesktopAcpClient)).toHaveBeenCalledTimes(2);
    expect(clientB.connect).toHaveBeenCalledTimes(1);
    expect(store.connectionStates['remote-agent']).toBe('initialized');
  });

  it('abandons in-flight websocket startup when the websocket URL is replaced', async () => {
    const initializeResponse: InitializeResponse = {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: []
    };
    const clientA = createDistinctMockClient();
    const clientB = createDistinctMockClient();
    const pendingClients = [clientA, clientB];
    vi.mocked(DesktopAcpClient).mockImplementation(function () {
      const next = pendingClients.shift();
      if (!next) throw new Error('unexpected extra DesktopAcpClient construction');
      return next as never;
    });

    clientA.connect.mockImplementation(() => new Promise<InitializeResponse>(() => undefined));
    clientB.connect.mockResolvedValue(initializeResponse);
    clientB.listSessions.mockResolvedValue({ sessions: [] });

    const store = createStore();
    store.configs = [
      {
        id: 'remote-agent',
        name: 'Remote QueryMT',
        transport: 'websocket',
        commandLine: '',
        websocketUrl: '127.0.0.1:3030',
        enabled: true,
        autoStart: false
      }
    ];

    const startPromise = store.startConfiguredAgent('remote-agent');
    await vi.waitFor(() => expect(clientA.connect).toHaveBeenCalledTimes(1));

    store.updateConfig('remote-agent', { websocketUrl: '127.0.0.1:4040' });
    await startPromise;

    expect(vi.mocked(DesktopAcpClient)).toHaveBeenCalledTimes(1);
    expect(clientB.connect).not.toHaveBeenCalled();
    expect(store.configs.find((config) => config.id === 'remote-agent')?.websocketUrl).toBe('127.0.0.1:4040');

    await store.startConfiguredAgent('remote-agent');

    expect(vi.mocked(DesktopAcpClient)).toHaveBeenCalledTimes(2);
    expect(clientB.connect).toHaveBeenCalledTimes(1);
    expect(store.connectionStates['remote-agent']).toBe('initialized');
  });

  it('still force-reconnects a websocket agent after the previous handshake has settled', async () => {
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
    await store.connectAgent('remote-agent', true);

    expect(mockClient.connect).toHaveBeenCalledTimes(2);
    expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
    expect(store.connectionStates['remote-agent']).toBe('initialized');
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

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, listSessionsRequest());
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, listSessionsRequest({ cursor: 'opaque-global-page-2' }));
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

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, listSessionsRequest({ cwd: '/tmp/work' }));
    expect(store.workspaceSessionGroups[0].sessions).toHaveLength(10);
    expect(store.workspaceSessionGroups[0].hasMore).toBe(true);

    await store.loadMoreWorkspaceSessions('/tmp/work');

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, listSessionsRequest({
      cwd: '/tmp/work',
      cursor: 'opaque-workspace-page-2'
    }));
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
    expect(mockClient.listSessions).toHaveBeenLastCalledWith(listSessionsRequest({ cwd: '/tmp/work', cursor: 'agent-1-next' }));
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

  it('inserts a newly created session into the workspace catalog before list refresh', async () => {
    const store = createStore();
    store.workspaceSessionSources = {
      'agent-1': {
        '/tmp/work': {
          agentId: 'agent-1',
          agentName: 'QMTCODE',
          cwd: '/tmp/work',
          sessions: [{
            agentId: 'agent-1',
            agentName: 'QMTCODE',
            sessionId: 'session-old',
            title: 'Old',
            cwd: '/tmp/work',
            updatedAt: '2026-07-18T12:00:00Z',
            runtimeId: 'agent-1',
            runtimeName: 'QMTCODE',
            source: 'acp',
            status: 'idle'
          }],
          latestActivity: '2026-07-18T12:00:00Z',
          nextCursor: '10',
          initialized: true,
          loading: false,
          error: null
        }
      }
    };
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-new', configOptions: [] });
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [] });

    await store.createBackgroundSession('agent-1', '/tmp/work');

    expect(store.sessionsByAgent['agent-1']).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'session-new', cwd: '/tmp/work' })
    ]));
    expect(store.workspaceSessionGroups[0].sessions.map((session) => session.sessionId)).toEqual(
      expect.arrayContaining(['session-new', 'session-old'])
    );
  });

  it('merges a newly listed local session into an already initialized workspace group', async () => {
    const store = createStore();
    store.workspaceSessionSources = {
      'agent-1': {
        '/tmp/work': {
          agentId: 'agent-1',
          agentName: 'QMTCODE',
          cwd: '/tmp/work',
          sessions: [{
            agentId: 'agent-1',
            agentName: 'QMTCODE',
            sessionId: 'session-old',
            title: 'Old',
            cwd: '/tmp/work',
            updatedAt: '2026-07-18T12:00:00Z',
            runtimeId: 'agent-1',
            runtimeName: 'QMTCODE',
            source: 'acp',
            status: 'idle'
          }],
          latestActivity: '2026-07-18T12:00:00Z',
          nextCursor: '10',
          initialized: true,
          loading: false,
          error: null
        }
      }
    };
    mockClient.listSessions.mockResolvedValueOnce({
      sessions: [{
        sessionId: 'session-new',
        title: 'New',
        cwd: '/tmp/work',
        updatedAt: '2026-07-18T12:05:00Z'
      }]
    });

    await store.refreshSessionsForAgent('agent-1');

    expect(store.workspaceSessionGroups[0].sessions.map((session) => session.sessionId)).toEqual([
      'session-new',
      'session-old'
    ]);
    expect(store.workspaceSessionGroups[0].initialized).toBe(true);
    expect(store.workspaceSessionSources['agent-1']['/tmp/work'].nextCursor).toBe('10');
  });

  it('waits for in-flight discovery before applying an incremental session refresh', async () => {
    const store = createStore();
    let resolveDiscovery!: (value: { sessions: Array<{ sessionId: string; title: string; cwd: string; updatedAt: string }> }) => void;
    mockClient.listSessions
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveDiscovery = resolve;
      }))
      .mockResolvedValueOnce({
        sessions: [{ sessionId: 'session-new', title: 'New', cwd: '/tmp/work', updatedAt: '2026-07-18T12:05:00Z' }]
      });

    const discovery = store.refreshSessionsForAgent('agent-1', true);
    const incremental = store.refreshSessionsForAgent('agent-1');
    await vi.waitFor(() => expect(resolveDiscovery).toBeTypeOf('function'));
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);

    resolveDiscovery({
      sessions: [{ sessionId: 'session-old', title: 'Old', cwd: '/tmp/work', updatedAt: '2026-07-18T12:00:00Z' }]
    });
    await Promise.all([discovery, incremental]);

    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, listSessionsRequest());
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, listSessionsRequest());
    expect(store.sessionsByAgent['agent-1'].map((session) => session.sessionId)).toEqual([
      'session-new',
      'session-old'
    ]);
  });

  it('clears attention when a session is acknowledged', () => {
    const store = createStore();
    store.attentionSessionKeys = ['agent-1:session-1', 'agent-1:session-2'];

    store.acknowledgeSession('agent-1', 'session-1');

    expect(store.attentionSessionKeys).toEqual(['agent-1:session-2']);
  });
});
