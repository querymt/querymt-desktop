import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionActionsMenu from '$lib/components/primitives/SessionActionsMenu.svelte';
import SessionActivityBar from '$lib/components/session/SessionActivityBar.svelte';
import SessionHeader from '$lib/components/session/SessionHeader.svelte';
import { RequestError, type InitializeResponse, type ListSessionsRequest, type PromptResponse, type SessionConfigOption, type SessionInfo, type SessionNotification, type SetSessionConfigOptionRequest } from '@agentclientprotocol/sdk';
import type { AgentConfig, DesktopSessionSummary, ModelEntry, PromptAttachment, PromptSendOptions } from '$lib/domain/types';
import { findModeConfigOption, findReasoningConfigOption, getModelSelectionKey } from '$lib/querymt/config-options';
import { QMT_METHOD_MESH_NODES, QMT_METHOD_MESH_STATUS } from '$lib/querymt/querymt-extensions';
import { RemoteNodeUpgradeRequiredError } from '$lib/domain/remote-errors';
import {
  DelegateAssignmentSource,
  DelegationUpdateState,
  DelegateReasoningEffort,
  type AuthProviderStatus,
  type DelegateAssignmentsInfo,
  type MeshInviteListInfo,
  type MeshNodesInfo,
  type MeshStatusInfo,
  type RemoteSessionAttachInfo,
  type SetDelegateModelRequest,
  SessionInputDelivery,
  SessionInputState,
  SessionRuntimePhase,
  type SessionInputStateNotification,
  type SessionRuntimeStatus,
  type SetDelegateModelResponse,
  type DiscardQueuedInputResult,
  type SubmitInputResult
} from '$lib/querymt/generated/types';
import { tick } from 'svelte';
import { DesktopAcpClient } from '$lib/querymt/acp-client';
import { BrowserClient } from '$lib/querymt/browser-client';
import { buildSessionConversation } from '$lib/domain/session-conversation';
import { restartAgent, startAgent } from '$native';
import { AgentsStore } from './agents.svelte';
import { chatPreferencesStore } from './chat-preferences.svelte';
import { inboxStore } from './inbox.svelte';
import { DEFAULT_SESSION_LIST_SCOPE, isRootSession, sessionMatchesLifecycle } from '$lib/domain/sessions';
import { SESSION_CATALOG_STORAGE_KEY, SESSION_CATALOG_FRESH_MS, sessionCatalogKey } from './session-catalog-cache';

const RECENT_SESSIONS_STORAGE_KEY = 'querymt-desktop.recent-sessions';

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
  // Registries instead of single slots: dispose paths unsubscribe their own
  // handler, and a late registration from a prior test's floating cleanup
  // must never swallow another test's emitted notification or loss event.
  const sessionUpdateHandlers: Array<(notification: SessionNotification) => void> = [];
  const connectionLossHandlers: Array<(reason: string) => void> = [];
  const extensionNotificationHandlers: Array<(notification: { method: string; params: unknown }) => void> = [];
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
    listSessions: vi.fn(async (_request?: ListSessionsRequest): Promise<{ sessions: SessionInfo[]; nextCursor?: string }> => ({ sessions: [] })),
    deleteSession: vi.fn(async () => undefined),
    getWorkspaceCapability: vi.fn((): Record<string, unknown> | null => null),
    createWorktreeSession: vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ sessionId: 'wt-1' })),
    handoffWorktreeSession: vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({ sessionId: 'handoff-1' })),
    listSessionChildren: vi.fn(async (_parentId?: string, _cursor?: string | null): Promise<{ sessions: SessionInfo[]; nextCursor?: string }> => ({ sessions: [] })),
    supportsSessionLifecycle: vi.fn(() => false),
    supportsSessionPins: vi.fn(() => false),
    setSessionPinned: vi.fn(async (session_id: string, pinned: boolean) => ({ session_id, pinned, pinned_at: pinned ? '2026-10-20T10:00:00Z' : null })),
    getSessionLifecycle: vi.fn(async (session_id: string) => ({ session_id, resolved: false, archived: false, resolved_at: null as string | null, archived_at: null as string | null })),
    setSessionLifecycle: vi.fn(async (session_id: string, patch: { resolved?: boolean; archived?: boolean }) => ({ session_id, resolved: patch.resolved ?? false, archived: patch.archived ?? false, resolved_at: patch.resolved ? '2026-10-18T12:00:00Z' : null, archived_at: patch.archived ? '2026-10-18T12:00:00Z' : null })),
    loadSession: vi.fn(async (_sessionId?: string, _cwd?: string): Promise<{
      response: { configOptions: SessionConfigOption[]; _meta?: Record<string, unknown> };
      replay: SessionNotification[];
      finishReplay?: () => SessionNotification[];
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
    steerSession: vi.fn(async (
      _sessionId: string,
      _prompt: string,
      _attachments: PromptAttachment[],
      clientInputId: string
    ): Promise<SubmitInputResult> => ({
      status: 'steered',
      data: { run_id: 'run-1', input_id: clientInputId, position: 1 }
    })),
    queueSession: vi.fn(async (
      _sessionId: string,
      _prompt: string,
      _attachments: PromptAttachment[],
      clientInputId: string
    ): Promise<SubmitInputResult> => ({
      status: 'queued',
      data: { input_id: clientInputId, position: 1 }
    })),
    discardQueuedInput: vi.fn(async (
      _sessionId: string,
      inputId: string
    ): Promise<DiscardQueuedInputResult> => ({
      status: 'discarded',
      data: { input_id: inputId }
    })),
    getSessionRuntimeStatus: vi.fn(async (): Promise<SessionRuntimeStatus> => ({
      phase: SessionRuntimePhase.Idle,
      active_run_id: undefined,
      steerable: false,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: undefined
    })),
    cancelSession: vi.fn(async () => undefined),
    supportsQuerymtFeature: vi.fn((_feature: string) => false),
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
    supportsElicitationRecovery: vi.fn(() => false),
    recoverPendingElicitations: vi.fn(async (): Promise<Array<{ sessionId: string; elicitationIds: string[] }>> => []),
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
      connectionLossHandlers.push(handler);
      return () => {
        const index = connectionLossHandlers.indexOf(handler);
        if (index >= 0) connectionLossHandlers.splice(index, 1);
      };
    }),
    emitConnectionLoss: (reason: string) => {
      for (const handler of [...connectionLossHandlers]) handler(reason);
    },
    disconnect: vi.fn(async () => undefined),
    onSessionUpdate: vi.fn((handler: (notification: SessionNotification) => void) => {
      sessionUpdateHandlers.push(handler);
      return () => {
        const index = sessionUpdateHandlers.indexOf(handler);
        if (index >= 0) sessionUpdateHandlers.splice(index, 1);
      };
    }),
    emitSessionUpdate: (notification: SessionNotification) => {
      for (const handler of [...sessionUpdateHandlers]) handler(notification);
    },
    resetSessionUpdateHandler: () => {
      sessionUpdateHandlers.length = 0;
      connectionLossHandlers.length = 0;
      extensionNotificationHandlers.length = 0;
      permissionUnsubscribe = vi.fn();
      elicitationUnsubscribe = vi.fn();
    },
    permissionUnsubscribe: () => permissionUnsubscribe,
    elicitationUnsubscribe: () => elicitationUnsubscribe,
    onExtensionNotification: vi.fn((handler: (notification: { method: string; params: unknown }) => void) => {
      extensionNotificationHandlers.push(handler);
      return () => {
        const index = extensionNotificationHandlers.indexOf(handler);
        if (index >= 0) extensionNotificationHandlers.splice(index, 1);
      };
    }),
    emitExtensionNotification: (notification: { method: string; params: unknown }) => {
      for (const handler of [...extensionNotificationHandlers]) handler(notification);
    },
    onPermissionRequest: vi.fn(() => permissionUnsubscribe),
    onElicitationRequest: vi.fn(() => elicitationUnsubscribe),
    setSessionConfigOption: vi.fn(async (_request: SetSessionConfigOptionRequest): Promise<SessionConfigOption[]> => []),
    listRemoteSessions: vi.fn(async (request: { node_id: string }) => ({ node_id: request.node_id, sessions: [], total_count: 0 })),
    listProfiles: vi.fn(async (nodeId?: string) => ({ node_id: nodeId, profiles: [{ id: 'cdr', name: 'Owner coder', description: null }, { id: 'default', name: 'Owner default profile', description: null }], active_profile_id: 'default' })),
    createRemoteSession: vi.fn(async (request: { node_id: string; cwd?: string; attach?: boolean; profile_id?: string }): Promise<RemoteSessionAttachInfo> => ({
      session_id: 'new-remote', node_id: request.node_id, attached: true, config_options: [], snapshot: { audit: { events: [] } }
    })),
    listMeshStatus: vi.fn(async (): Promise<MeshStatusInfo> => ({
      enabled: true,
      peer_id: '12D3KooWQmtLocalAgentPeer00000000000000',
      hostname: 'lstr',
      transport: 'quic',
      known_peer_count: 0,
      has_invite_store: true,
      has_mesh_state_store: true,
      scopes: []
    })),
    listMeshNodes: vi.fn(async (): Promise<MeshNodesInfo> => ({ nodes: [] })),
    listMeshInvites: vi.fn(async (): Promise<MeshInviteListInfo> => ({ invites: [] })),
    attachRemoteSession: vi.fn(async (): Promise<RemoteSessionAttachInfo> => ({
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

vi.mock('$native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$native')>();
  return {
    ...actual,
    drainAgentSessionUpdates: mockDrainAgentSessionUpdates,
    getAgentLogs: vi.fn(async () => []),
    getAgentStatus: vi.fn(async () => ({ state: 'running' })),
    listManagedProfiles: mockListManagedProfiles,
    listenAgentLogs: vi.fn(async (handler: (payload: unknown) => void) => mockListen('querymt://agent/log', ({ payload }: { payload: unknown }) => handler(payload))),
    restartAgent: vi.fn(async () => ({ state: 'running' })),
    startAgent: vi.fn(async () => ({ state: 'running' })),
    stopAgent: vi.fn(async () => ({ state: 'stopped' })),
    validateWorkspaceDirectory: vi.fn(async () => true)
  };
});

vi.mock('$lib/querymt/acp-client', () => ({
  clearElicitationResumeAuthoritiesForAgent: vi.fn(),
  DesktopAcpClient: vi.fn(function () {
    return mockClient;
  })
}));

function meshNodes(ids: string[]): MeshNodesInfo {
  return {
    nodes: ids.map((id) => ({
      id,
      label: `mesh-node-${id.slice(-5).toLowerCase()}`,
      capabilities: ['remote-sessions'],
      active_sessions: 0,
      transport: 'quic'
    }))
  };
}

function createDistinctMockClient() {
  let connectionLossHandler: ((reason: string) => void) | null = null;
  const extensionNotificationHandlers: Array<(notification: { method: string; params: unknown }) => void> = [];
  let elicitationHandler: ((request: unknown) => Promise<unknown>) | null = null;
  let permissionHandler: ((request: unknown) => Promise<unknown>) | null = null;

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
    listAuthProviders: vi.fn(async (): Promise<AuthProviderStatus[]> => []),
    listMeshStatus: vi.fn(async (): Promise<MeshStatusInfo> => ({
      enabled: false,
      known_peer_count: 0,
      has_invite_store: false,
      has_mesh_state_store: false,
      scopes: []
    })),
    listMeshNodes: vi.fn(async (): Promise<MeshNodesInfo> => ({ nodes: [] })),
    listMeshInvites: vi.fn(async (): Promise<MeshInviteListInfo> => ({ invites: [] })),
    getModelInfo: vi.fn(async () => ({})),
    supportsQuerymtFeature: vi.fn((_feature: string) => false),
    supportsElicitationRecovery: vi.fn(() => false),
    recoverPendingElicitations: vi.fn(async (): Promise<Array<{ sessionId: string; elicitationIds: string[] }>> => []),
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
    onExtensionNotification: vi.fn((handler: (notification: { method: string; params: unknown }) => void) => {
      extensionNotificationHandlers.push(handler);
      return () => {
        const index = extensionNotificationHandlers.indexOf(handler);
        if (index >= 0) extensionNotificationHandlers.splice(index, 1);
      };
    }),
    emitExtensionNotification: (notification: { method: string; params: unknown }) => {
      for (const handler of [...extensionNotificationHandlers]) handler(notification);
    },
    onPermissionRequest: vi.fn((handler: (request: unknown) => Promise<unknown>) => {
      permissionHandler = handler;
      return () => {
        permissionHandler = null;
      };
    }),
    onElicitationRequest: vi.fn((handler: (request: unknown) => Promise<unknown>) => {
      elicitationHandler = handler;
      return () => {
        elicitationHandler = null;
      };
    }),
    elicit: (request: unknown) => elicitationHandler!(request) as Promise<unknown>,
    permission: (request: unknown) => permissionHandler!(request) as Promise<unknown>
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
  localStorage.removeItem(RECENT_SESSIONS_STORAGE_KEY);
  localStorage.removeItem(SESSION_CATALOG_STORAGE_KEY);
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
  mockClient.listMeshStatus.mockResolvedValue({
    enabled: true,
    peer_id: '12D3KooWQmtLocalAgentPeer00000000000000',
    hostname: 'lstr',
    transport: 'quic',
    known_peer_count: 0,
    has_invite_store: true,
    has_mesh_state_store: true,
    scopes: []
  });
  mockClient.listMeshNodes.mockResolvedValue({ nodes: [] });
  mockClient.listMeshInvites.mockResolvedValue({ invites: [] });
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
  mockClient.supportsQuerymtFeature.mockReset().mockReturnValue(false);
  mockClient.supportsQuerymtMethod.mockReset().mockReturnValue(true);
  mockClient.supportsSessionLifecycle.mockReset().mockReturnValue(false);
  mockClient.supportsSessionPins.mockReset().mockReturnValue(false);
  mockClient.setSessionPinned.mockReset().mockImplementation(async (session_id, pinned) => ({ session_id, pinned, pinned_at: pinned ? '2026-10-20T10:00:00Z' : null }));
  mockClient.getSessionLifecycle.mockClear();
  mockClient.setSessionLifecycle.mockClear();
  mockClient.steerSession.mockReset().mockImplementation(async (
    _sessionId: string,
    _prompt: string,
    _attachments: PromptAttachment[],
    clientInputId: string
  ): Promise<SubmitInputResult> => ({
    status: 'steered',
    data: { run_id: 'run-1', input_id: clientInputId, position: 1 }
  }));
  mockClient.queueSession.mockReset().mockImplementation(async (
    _sessionId: string,
    _prompt: string,
    _attachments: PromptAttachment[],
    clientInputId: string
  ): Promise<SubmitInputResult> => ({
    status: 'queued',
    data: { input_id: clientInputId, position: 1 }
  }));
  mockClient.discardQueuedInput.mockReset().mockImplementation(async (
    _sessionId: string,
    inputId: string
  ): Promise<DiscardQueuedInputResult> => ({
    status: 'discarded',
    data: { input_id: inputId }
  }));
  mockClient.getSessionRuntimeStatus.mockReset().mockResolvedValue({
    phase: SessionRuntimePhase.Idle,
    active_run_id: undefined,
    steerable: false,
    pending_steering_count: 0,
    queued_input_count: 0,
    run_started_at_ms: undefined
  });
  mockClient.listSessions.mockReset().mockResolvedValue({ sessions: [] });
  mockClient.loadSession.mockReset().mockResolvedValue({ response: { configOptions: [] }, replay: [] });
  mockClient.createSession.mockReset().mockResolvedValue({ sessionId: 'session-1', configOptions: [] });
  mockClient.getWorkspaceCapability.mockReset().mockReturnValue(null);
  mockClient.createWorktreeSession.mockReset().mockResolvedValue({ sessionId: 'wt-1' });
  mockClient.handoffWorktreeSession.mockReset().mockResolvedValue({ sessionId: 'handoff-1' });
  mockClient.listSessionChildren.mockReset().mockResolvedValue({ sessions: [] });
});

afterEach(() => {
  while (createdStores.length > 0) {
    createdStores.pop()?.dispose();
  }
  chatPreferencesStore.setShowRemoteSessions(false);
  for (const nodeId of chatPreferencesStore.remoteSessionPeers) {
    chatPreferencesStore.setRemoteSessionPeer(nodeId, false);
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AgentsStore visibility-aware polling', () => {
  const activeRuntime: SessionRuntimeStatus = { phase: SessionRuntimePhase.Model, active_run_id: 'run-1', steerable: true, pending_steering_count: 0, queued_input_count: 0 };
  const listed: SessionInfo = { sessionId: 'session-1', title: 'Task', cwd: '/tmp/work', updatedAt: '2026-10-20T20:00:00Z' };
  function visibility(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  async function pollingStore() {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.startSessionPolling();
    return store;
  }
  function select(store: AgentsStore) {
    store.setRuntimePollingEnabled(true);
    store.activeAgentId = 'agent-1'; store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1'; store.activeSession.runState = 'thinking';
  }
  beforeEach(() => { vi.useFakeTimers(); visibility(false); });
  afterEach(() => { delete (document as { hidden?: boolean }).hidden; });

  it('reconciles idle cross-client summaries every 30s globally using only the first page', async () => {
    const store = await pollingStore();
    mockClient.listSessions.mockResolvedValue({ sessions: [listed], nextCursor: 'next-page' });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    expect(store.sessions[0].title).toBe('Task');
    mockClient.listSessions.mockResolvedValue({ sessions: [{ ...listed, title: 'Changed elsewhere' }], nextCursor: 'next-page' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    expect(store.sessions[0].title).toBe('Changed elsewhere');
    expect(mockClient.listSessions.mock.calls.every(([request]) => !request?.cursor)).toBe(true);
    expect(localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)).toBeNull();
  });

  it('pauses hidden timers and coalesces repeated visibility catch-up without blocking manual refresh', async () => {
    const store = await pollingStore();
    visibility(true); await vi.advanceTimersByTimeAsync(120_000);
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    visibility(false); visibility(false); visibility(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    visibility(true); release({ sessions: [listed] });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    await store.refreshSessionsForAgent('agent-1');
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    visibility(false); visibility(false); await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(3);
  });

  it('updates chunk summaries in memory without 800ms list or 100ms runtime floods', async () => {
    const store = createStore(); await store.connectAgent('agent-1');
    store.setRuntimePollingEnabled(true);
    store.activeAgentId = 'agent-1'; store.activeSessionId = 'session-1'; store.activeSession.sessionId = 'session-1';
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed] });
    await store.refreshSessionsForAgent('agent-1'); mockClient.listSessions.mockClear();
    mockClient.getSessionRuntimeStatus.mockResolvedValue(activeRuntime);
    for (let index = 0; index < 10; index++) {
      mockClient.emitSessionUpdate({ sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', messageId: `chunk-${index}`, content: { type: 'text', text: String(index) } } });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(store.sessions[0].status).toBe('thinking');
    expect(store.activeSession.transcript.length).toBeGreaterThan(0);
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(5);
  });

  it('polls runtime at 2s without overlap and stops on authoritative idle', async () => {
    const store = await pollingStore(); select(store);
    mockClient.getSessionRuntimeStatus.mockResolvedValue(activeRuntime);
    await store.refreshSessionRuntime();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
    let release!: (runtime: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(1);
    const shared = store.refreshSessionRuntime();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
    release({ ...activeRuntime, phase: SessionRuntimePhase.Idle }); await shared;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
  });

  it('pauses runtime hidden and resumes once without off-route polling or clearing selection', async () => {
    const store = await pollingStore(); select(store);
    mockClient.getSessionRuntimeStatus.mockResolvedValue(activeRuntime);
    await store.refreshSessionRuntime();
    visibility(true); await vi.advanceTimersByTimeAsync(10_000);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
    visibility(false); visibility(false); await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
    store.setRuntimePollingEnabled(false); await vi.advanceTimersByTimeAsync(10_000);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(store.activeSessionId).toBe('session-1');
    store.setRuntimePollingEnabled(true); await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(3);
  });

  it('waits for an in-flight runtime read then performs a fresh pre-action check', async () => {
    const store = await pollingStore(); select(store);
    mockClient.supportsQuerymtFeature.mockImplementation((feature) => feature === 'steering');
    let release!: (runtime: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce({ ...activeRuntime, active_run_id: 'new-run' });
    const background = store.refreshSessionRuntime(); await vi.advanceTimersByTimeAsync(0);
    const action = store.sendPromptToActiveSession(); await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(mockClient.steerSession).not.toHaveBeenCalled();
    release(activeRuntime); await background; await action;
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(mockClient.steerSession).toHaveBeenCalledWith('session-1', expect.any(String), expect.any(Array), expect.any(String), 'new-run', expect.anything());
  });

  it.each(['selection', 'disconnect', 'replace', 'dispose'] as const)('retires stale runtime and timers on %s', async (change) => {
    const store = await pollingStore(); select(store);
    let release!: (runtime: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = store.refreshSessionRuntime(); await vi.advanceTimersByTimeAsync(0);
    if (change === 'selection') store.activeSessionId = 'other';
    else if (change === 'dispose') store.dispose();
    else if (change === 'disconnect') await store.stopConfiguredAgent('agent-1');
    else await store.connectAgent('agent-1', true);
    release(activeRuntime); await old;
    expect(store.sessionRuntimeBySession['agent-1:session-1']?.active_run_id).not.toBe('run-1');
    mockClient.getSessionRuntimeStatus.mockClear(); await vi.advanceTimersByTimeAsync(10_000);
    expect(mockClient.getSessionRuntimeStatus).not.toHaveBeenCalled();
  });

  it('cleans global listeners and timers without reviving after dispose', async () => {
    const store = await pollingStore(); select(store);
    mockClient.getSessionRuntimeStatus.mockResolvedValue(activeRuntime); await store.refreshSessionRuntime();
    store.dispose(); visibility(true); visibility(false); visibility(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it('defers hidden pin notifications until one reconciliation on return', async () => {
    const store = await pollingStore(); mockClient.supportsSessionPins.mockReturnValue(true);
    visibility(true);
    mockClient.emitExtensionNotification({ method: 'querymt/session/pinsChanged', params: { session_id: 'session-1' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    visibility(false); visibility(false); await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.listSessions.mock.calls.filter(([request]) => (request?._meta?.querymt as { sessionFilters?: { pinned?: boolean } } | undefined)?.sessionFilters?.pinned)).toHaveLength(1);
  });

  it('does not list during hidden startup and catches up once when visible', async () => {
    visibility(true);
    const store = createStore();
    const init = store.initialize();
    await vi.advanceTimersByTimeAsync(5_000); await init;
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    visibility(false); visibility(false); await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    expect(mockClient.listSessions.mock.calls[0][0]?.cursor).toBeUndefined();
  });

  it('joins an explicit list already in flight instead of queueing visibility work', async () => {
    const store = await pollingStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const manual = store.refreshSessionsForAgent('agent-1'); await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 5; index++) { visibility(true); visibility(false); }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    release({ sessions: [listed] }); await manual; await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
  });

  it('retains hidden critical input updates and permits explicit authoritative runtime reads', async () => {
    const store = await pollingStore(); select(store); visibility(true);
    mockClient.emitExtensionNotification({ method: 'querymt/session/inputState', params: {
      version: 1, session_id: 'session-1', input_id: 'queued', delivery: SessionInputDelivery.Queue, state: SessionInputState.Started
    } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockClient.getSessionRuntimeStatus).not.toHaveBeenCalled();
    await store.refreshSessionRuntime();
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(mockClient.listSessions).not.toHaveBeenCalled();
  });

  it('preserves immediate reconnect discovery and restarts the slower visible fallback', async () => {
    const store = await pollingStore();
    store.configs = [{ ...store.configs[0], transport: 'websocket', websocketUrl: 'ws://127.0.0.1:3030' }];
    mockClient.emitConnectionLoss('Disconnected');
    await vi.advanceTimersByTimeAsync(250);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
  });

  it.each(['replace', 'dispose'] as const)('does not send or clear the composer after pre-action runtime loses ownership on %s', async (change) => {
    const store = await pollingStore(); select(store);
    mockClient.supportsQuerymtFeature.mockImplementation((feature) => feature === 'steering');
    let release!: (runtime: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const prompt = store.composerPrompt;
    const action = store.sendPromptToActiveSession(); await vi.advanceTimersByTimeAsync(0);
    if (change === 'dispose') store.dispose();
    else await store.connectAgent('agent-1', true);
    release(activeRuntime); await action;
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(mockClient.steerSession).not.toHaveBeenCalled();
    expect(mockClient.queueSession).not.toHaveBeenCalled();
    expect(store.composerPrompt).toBe(prompt);
    expect(store.activeSession.transcript).toHaveLength(0);
  });

  it('recovers an initialized live client after a transient list failure on visibility return', async () => {
    const store = await pollingStore();
    mockClient.listSessions.mockRejectedValueOnce(new Error('Temporary list timeout'));
    await store.refreshSessionsForAgent('agent-1');
    expect(store.connectionStates['agent-1']).toBe('failed');
    expect(store.connectedAgents).toHaveLength(0);
    visibility(true); visibility(false); visibility(false); await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    expect(store.connectionStates['agent-1']).toBe('initialized');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(3);
  });

  it('coalesces meaningful metadata reconciliation without postponing the 30s fallback', async () => {
    const store = await pollingStore();
    for (let index = 0; index < 10; index++) {
      mockClient.emitSessionUpdate({ sessionId: 'unknown-session', update: { sessionUpdate: 'session_info_update', title: 'New elsewhere' } });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
  });
});

describe('AgentsStore recent sessions', () => {
  it('remembers successful opens in MRU order and restores them without loading history', async () => {
    const store = createStore();
    await store.loadSession('agent-1', 'first');
    await store.loadSession('agent-1', 'second');
    await store.loadSession('agent-1', 'first');
    expect(store.recentSessionKeys).toEqual(['agent-1:first', 'agent-1:second']);
    const stored = JSON.parse(localStorage.getItem(RECENT_SESSIONS_STORAGE_KEY)!);
    expect(stored).toHaveLength(2);
    expect(Object.keys(stored[0]).sort()).toEqual(['agentId', 'sessionId', 'source']);
    mockClient.loadSession.mockClear();
    const restored = createStore();
    expect(restored.recentSessionKeys).toEqual(store.recentSessionKeys);
    expect(mockClient.loadSession).not.toHaveBeenCalled();
    expect(mockClient.listSessions).not.toHaveBeenCalled();
  });

  it('preloads recent identities from the existing catalog cache without a second history or catalog request', async () => {
    const store = createStore();
    mockClient.supportsSessionLifecycle.mockReturnValue(true);
    await store.connectAgent('agent-1');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [{ sessionId: 'recent', title: 'Cached recent', cwd: '/tmp/work', _meta: {
      querymt: { lifecycle: { session_id: 'recent', resolved: false, archived: false, resolved_at: null, archived_at: null } }
    } }] });
    await store.ensureSessionCatalog();
    await store.loadSession('agent-1', 'recent');
    store.dispose();
    const restored = createStore();
    await restored.connectAgent('agent-1');
    mockClient.listSessions.mockClear();
    mockClient.loadSession.mockClear();
    await restored.ensureSessionCatalog();
    expect(restored.recentSessionKeys).toEqual(['agent-1:recent']);
    expect(restored.sessionCatalog[0].title).toBe('Cached recent');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.loadSession).not.toHaveBeenCalled();
  });

  it('does not remember failed loads, known children, or background activity', async () => {
    const store = createStore();
    mockClient.loadSession.mockRejectedValueOnce(new Error('Missing session'));
    await store.loadSession('agent-1', 'missing');
    expect(store.recentSessionKeys).toEqual([]);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [{
      sessionId: 'child', title: 'Child', cwd: '/tmp/work', _meta: { parentSessionId: 'root', forkOrigin: 'delegation' }
    }] });
    await store.refreshSessionsForAgent('agent-1');
    await store.loadSession('agent-1', 'child');
    expect(store.recentSessionKeys).toEqual([]);
    await store.loadSession('agent-1', 'root');
    mockClient.emitSessionUpdate({ sessionId: 'child', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Background work' } } });
    await tick();
    expect(store.recentSessionKeys).toEqual(['agent-1:root']);
  });

  it('shows the upgrade message when opening a session on an outdated remote node', async () => {
    const store = createStore();
    mockClient.loadSession.mockRejectedValueOnce(new RemoteNodeUpgradeRequiredError('nas'));
    await store.loadSession('agent-1', 'remote-session');

    expect(store.error).toContain('Remote node "nas" must be upgraded');
    expect(store.activeSession.lastError).toContain('Remote node "nas" must be upgraded');
    expect(store.activeSession.runState).toBe('failed');
    expect(store.recentSessionKeys).toEqual([]);
  });

  it('remembers foreground creation but not background session creation', async () => {
    const store = createStore();
    await store.createBackgroundSession('agent-1', '/tmp/work');
    expect(store.recentSessionKeys).toEqual([]);
    await store.createSession('agent-1');
    expect(store.recentSessionKeys).toEqual(['agent-1:session-1']);
  });

  it('remembers successful remote attachments', async () => {
    const store = createStore();
    await store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    expect(store.recentSessionKeys).toEqual(['agent-1:remote-session-1']);
  });

  it('does not let a superseded successful load reorder recent sessions', async () => {
    const store = createStore();
    let release!: (value: { response: { configOptions: SessionConfigOption[] }; replay: SessionNotification[] }) => void;
    mockClient.loadSession.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = store.loadSession('agent-1', 'old');
    await vi.waitFor(() => expect(mockClient.loadSession).toHaveBeenCalledOnce());
    await store.loadSession('agent-1', 'new');
    release({ response: { configOptions: [] }, replay: [] });
    await old;
    expect(store.recentSessionKeys).toEqual(['agent-1:new']);
  });

  it('scopes identities to endpoints and removes them when changing endpoints', async () => {
    const store = createStore();
    await store.loadSession('agent-1', 'session-1');
    const restored = createStore();
    restored.configs = [{ ...restored.configs[0], commandLine: 'different-agent' }];
    expect(restored.recentSessionKeys).toEqual([]);
    store.updateConfig('agent-1', { name: 'Renamed' });
    expect(store.recentSessionKeys).toEqual(['agent-1:session-1']);
    store.updateConfig('agent-1', { commandLine: 'different-agent' });
    expect(store.recentSessionKeys).toEqual([]);
    expect(JSON.parse(localStorage.getItem(RECENT_SESSIONS_STORAGE_KEY)!)).toEqual([]);
  });

  it('forgets a session only after successful deletion', async () => {
    const store = createStore();
    mockClient.connect.mockResolvedValueOnce({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { delete: {} } }, authMethods: [] });
    await store.loadSession('agent-1', 'session-1');
    const deleted = store.sessionsByAgent['agent-1'][0];
    const retained = [{ ...deleted, agentId: 'agent-2' }, { ...deleted, sessionId: 'session-2' }];
    store.sessionCatalog = [deleted, ...retained];
    mockClient.deleteSession.mockRejectedValueOnce(new Error('Denied'));
    await expect(store.deleteSession('agent-1', 'session-1')).rejects.toThrow('Denied');
    expect(store.recentSessionKeys).toEqual(['agent-1:session-1']);
    expect(store.sessionCatalog).toEqual([deleted, ...retained]);
    expect(store.sessionsByAgent['agent-1']).toContainEqual(deleted);
    await store.deleteSession('agent-1', 'session-1');
    expect(store.sessionCatalog).toEqual(retained);
    expect(store.sessionsByAgent['agent-1']).toEqual([]);
    expect(store.recentSessionKeys).toEqual([]);
    expect(createStore().recentSessionKeys).toEqual([]);
  });

  it.each(['null', '{}', '[null, {"agentId":3}]', 'invalid json'])('ignores invalid stored recents (%s)', (raw) => {
    localStorage.setItem(RECENT_SESSIONS_STORAGE_KEY, raw);
    expect(createStore().recentSessionKeys).toEqual([]);
  });

  it('bounds and deduplicates persisted identities', async () => {
    const seed = createStore();
    const source = sessionCatalogKey(seed.configs, [], { resolution: 'any', archive: 'any' });
    const entries = Array.from({ length: 65 }, (_, index) => ({ agentId: 'agent-1', sessionId: `session-${index}`, source }));
    localStorage.setItem(RECENT_SESSIONS_STORAGE_KEY, JSON.stringify([entries[0], ...entries]));
    const store = createStore();
    expect(store.recentSessionKeys).toHaveLength(50);
    await store.loadSession('agent-1', 'newest');
    expect(store.recentSessionKeys[0]).toBe('agent-1:newest');
    expect(JSON.parse(localStorage.getItem(RECENT_SESSIONS_STORAGE_KEY)!)).toHaveLength(50);
  });

  it('keeps successful opens usable when recent-session storage writes fail', async () => {
    const store = createStore();
    const original = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === RECENT_SESSIONS_STORAGE_KEY) throw new Error('Storage full');
      original.call(this, key, value);
    });
    try {
      await store.loadSession('agent-1', 'session-1');
      expect(store.recentSessionKeys).toEqual(['agent-1:session-1']);
      expect(store.activeSession.lastError).toBeNull();
    } finally { storage.mockRestore(); }
  });
});

describe('AgentsStore open-session sidebar pagination', () => {
  function row(sessionId: string): SessionInfo {
    return { sessionId, title: sessionId, cwd: '/tmp/work', _meta: { querymt: { lifecycle: { session_id: sessionId, resolved: false, archived: false, resolved_at: null, archived_at: null } } } } as SessionInfo;
  }

  async function pagingStore() {
    const store = createStore();
    mockClient.supportsSessionLifecycle.mockReturnValue(true);
    await store.connectAgent('agent-1');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('first')], nextCursor: '100' });
    await store.refreshSessionsForAgent('agent-1');
    mockClient.listSessions.mockClear();
    return store;
  }

  it('continues the already loaded root page on demand instead of restarting a full catalog traversal', async () => {
    const store = await pagingStore();
    expect(store.hasMoreOpenSessions).toBe(true);
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('older')], nextCursor: '200' });
    await store.loadMoreOpenSessions();
    expect(mockClient.listSessions).toHaveBeenCalledExactlyOnceWith(listSessionsRequest({ cursor: '100' }));
    expect(store.sessionsByAgent['agent-1'].map((session) => session.sessionId)).toEqual(['first', 'older']);
    expect(store.hasMoreOpenSessions).toBe(true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('last')] });
    await store.loadMoreOpenSessions();
    expect(mockClient.listSessions).toHaveBeenLastCalledWith(listSessionsRequest({ cursor: '200' }));
    expect(store.hasMoreOpenSessions).toBe(false);
    await store.loadMoreOpenSessions();
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
  });

  it('coalesces overlapping sidebar requests for the same agent and keeps existing rows while loading', async () => {
    const store = await pagingStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = store.loadMoreOpenSessions();
    const second = store.loadMoreOpenSessions();
    expect(mockClient.listSessions).toHaveBeenCalledOnce();
    expect(store.openSessionsLoading).toBe(true);
    expect(store.sessionsByAgent['agent-1'][0].sessionId).toBe('first');
    release({ sessions: [row('next')] });
    await Promise.all([first, second]);
    expect(store.openSessionsLoading).toBe(false);
    expect(store.sessionsByAgent['agent-1']).toHaveLength(2);
  });

  it('does not reset the sidebar continuation when a recent-session head refresh runs', async () => {
    const store = await pagingStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('older')], nextCursor: '200' });
    await store.loadMoreOpenSessions();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('newer'), row('first')], nextCursor: '100' });
    await store.refreshSessionsForAgent('agent-1');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('last')] });
    await store.loadMoreOpenSessions();
    expect(mockClient.listSessions).toHaveBeenLastCalledWith(listSessionsRequest({ cursor: '200' }));
    expect(store.sessionsByAgent['agent-1'].some((session) => session.sessionId === 'older')).toBe(true);
  });

  it('retains failed pages for retry without marking the agent or its catalog failed', async () => {
    const store = await pagingStore();
    mockClient.listSessions.mockRejectedValueOnce(new RequestError(-32603, 'Internal error', 'Remote owner is offline'));
    await store.loadMoreOpenSessions();
    expect(store.openSessionsLoadError).toBe('QMTCODE: Remote owner is offline');
    expect(store.connectionStates['agent-1']).toBe('initialized');
    expect(store.sessionCatalogError).toBeNull();
    expect(store.sessionsByAgent['agent-1']).toHaveLength(1);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('retry')] });
    await store.loadMoreOpenSessions();
    expect(mockClient.listSessions).toHaveBeenLastCalledWith(listSessionsRequest({ cursor: '100' }));
    expect(store.openSessionsLoadError).toBeNull();
    expect(store.hasMoreOpenSessions).toBe(false);
  });

  it('rejects repeated cursors instead of automatically requesting the same page forever', async () => {
    const store = await pagingStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('bad')], nextCursor: '100' });
    await store.loadMoreOpenSessions();
    expect(store.openSessionsLoadError).toContain('repeated session cursor');
    expect(mockClient.listSessions).toHaveBeenCalledOnce();
    expect(store.sessionsByAgent['agent-1'].some((session) => session.sessionId === 'bad')).toBe(false);
  });

  it('starts a new traversal when selected remote peers change and ignores the old in-flight response', async () => {
    const store = await pagingStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = store.loadMoreOpenSessions();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('peer-owner', true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('new-scope')] });
    await store.loadMoreOpenSessions();
    expect(mockClient.listSessions).toHaveBeenLastCalledWith({ _meta: { session_scope: 'root', remoteNodeIds: ['peer-owner'] } });
    release({ sessions: [row('old-scope')] });
    await old;
    expect(store.sessionsByAgent['agent-1'].some((session) => session.sessionId === 'old-scope')).toBe(false);
    expect(store.hasMoreOpenSessions).toBe(false);
  });

  it('invalidates stale offsets after a lifecycle write and does not resurrect an older response', async () => {
    const store = await pagingStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = store.loadMoreOpenSessions();
    await store.setSessionLifecycle('agent-1', 'first', { resolved: true });
    release({ sessions: [row('first'), row('obsolete')] });
    await old;
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'first')?.lifecycle?.resolved).toBe(true);
    expect(store.sessionsByAgent['agent-1'].some((session) => session.sessionId === 'obsolete')).toBe(false);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('new-head')] });
    await store.loadMoreOpenSessions();
    expect(mockClient.listSessions).toHaveBeenLastCalledWith(listSessionsRequest());
  });

  it('does not issue lifecycle-dependent sidebar discovery for unsupported agents', async () => {
    const store = await pagingStore();
    mockClient.supportsSessionLifecycle.mockReturnValue(false);
    expect(store.hasMoreOpenSessions).toBe(false);
    await store.loadMoreOpenSessions();
    expect(mockClient.listSessions).not.toHaveBeenCalled();
  });
});

describe('AgentsStore child-session sidebar isolation', () => {
  function info(sessionId: string, meta: Record<string, unknown> = {}): SessionInfo {
    return {
      sessionId, title: `Task: ${sessionId}`, cwd: '/tmp/work',
      _meta: { querymt: { lifecycle: { session_id: sessionId, resolved: false, archived: false, resolved_at: null, archived_at: null } }, ...meta }
    } as SessionInfo;
  }

  function openRoots(store: AgentsStore) {
    return store.sessions.filter(isRootSession)
      .filter((session) => sessionMatchesLifecycle(session.lifecycle, { resolution: 'open', archive: 'excluded' }))
      .map((session) => session.sessionId);
  }

  it('does not promote a child reviewed from a log when its lifecycle is refreshed', async () => {
    const store = createStore();
    mockClient.supportsSessionLifecycle.mockReturnValue(true);
    await store.loadSession('agent-1', 'unlisted-child');
    await store.refreshSessionLifecycle('agent-1', 'unlisted-child');
    mockClient.emitSessionUpdate({ sessionId: 'unlisted-child', update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working' }
    } });
    await tick();

    await vi.waitFor(() => expect(store.sessions.find((session) => session.sessionId === 'unlisted-child')?.status).toBe('thinking'));
    expect(store.activeSessionId).toBe('unlisted-child');
    expect(store.sessions.find((session) => session.sessionId === 'unlisted-child')?.lifecycle?.resolved).toBe(false);
    expect(openRoots(store)).toEqual([]);
    expect(mockClient.listSessions).not.toHaveBeenCalled();

    // Only a root-scoped listing can establish that an otherwise unknown load is a root.
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('unlisted-child')] });
    await store.refreshSessionsForAgent('agent-1');
    expect(openRoots(store)).toEqual(['unlisted-child']);
  });

  it.each(['load', 'attach'] as const)('preserves known parentage through remote %s and partial catalog refreshes', async (operation) => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('remote-session-1', {
      location: 'remote', nodeId: 'node-1', parentSessionId: 'root', forkOrigin: 'delegation'
    })] });
    await store.refreshSessionsForAgent('agent-1');
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: { location: 'remote', nodeId: 'node-1' } }, replay: [] });
    if (operation === 'load') await store.loadSession('agent-1', 'remote-session-1');
    else await store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    expect(store.error).toBeNull();
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'remote-session-1'))
      .toMatchObject({ parentSessionId: 'root', forkOrigin: 'delegation' });

    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('remote-session-1', { location: 'remote', nodeId: 'node-1' })] });
    await store.refreshSessionsForAgent('agent-1');
    expect(openRoots(store)).toEqual([]);
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'remote-session-1'))
      .toMatchObject({ parentSessionId: 'root', forkOrigin: 'delegation' });
  });

  it.each([false, true])('remembers live child links before discovery even with an unselected parent (snake case=%s)', async (snakeCase) => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'other-root';
    mockClient.emitExtensionNotification({ method: 'querymt/session/delegationUpdate', params: snakeCase
      ? { session_id: 'root', child_session_id: 'child', tool_call_id: 'delegate-1' }
      : { sessionId: 'root', childSessionId: 'child', toolCallId: 'delegate-1' }
    });
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('root'), info('child')] });
    await store.refreshSessionsForAgent('agent-1');
    store.attentionSessionKeys = ['agent-1:child'];
    mockClient.emitSessionUpdate({ sessionId: 'child', update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working' }
    } });
    await tick();

    await vi.waitFor(() => expect(store.sessions.find((session) => session.sessionId === 'child')?.status).toBe('thinking'));
    expect(store.sessions.find((session) => session.sessionId === 'child')).toMatchObject({ parentSessionId: 'root' });
    expect(openRoots(store)).toEqual(['root']);
    expect(store.attentionSessionKeys).toContain('agent-1:child');
    expect(mockClient.listSessions).toHaveBeenCalledWith(listSessionsRequest());
  });

  it('keeps a live child link across a delayed catalog response and persisted cache hydration', async () => {
    const store = createStore();
    mockClient.supportsSessionLifecycle.mockReturnValue(true);
    await store.connectAgent('agent-1');
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const refresh = store.ensureSessionCatalog();
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledOnce());
    mockClient.emitExtensionNotification({ method: 'querymt/session/delegationUpdate', params: {
      sessionId: 'root', childSessionId: 'child', toolCallId: 'delegate-1'
    } });
    release({ sessions: [info('root'), info('child')] });
    await refresh;
    expect(store.sessionCatalog.find((session) => session.sessionId === 'child')?.parentSessionId).toBe('root');
    store.dispose();

    const restored = createStore();
    await restored.connectAgent('agent-1');
    mockClient.listSessions.mockClear();
    await restored.ensureSessionCatalog();
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(openRoots(restored)).toEqual(['root']);
    expect(restored.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'child')?.parentSessionId).toBe('root');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('root'), info('child')] });
    await restored.refreshSessionsForAgent('agent-1', true);
    expect(openRoots(restored)).toEqual(['root']);
  });

  it.each(['local', 'remote'])('uses owner-supplied child parentage on a direct %s load', async (location) => {
    const store = createStore();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      location, nodeId: 'node-1', parentSessionId: 'root', forkOrigin: 'delegation'
    } }, replay: [] });
    await store.loadSession('agent-1', 'child');
    expect(store.error).toBeNull();
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'child'))
      .toMatchObject({ parentSessionId: 'root', forkOrigin: 'delegation' });
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('root'), info('child')] });
    await store.refreshSessionsForAgent('agent-1', true);
    expect(openRoots(store)).toEqual(['root']);
  });

  it('restores child classification from the parent log while leaving child review available', async () => {
    const store = createStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('root'), info('child')] });
    await store.refreshSessionsForAgent('agent-1');
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      'querymt/sessionLoadSnapshot.v1': { audit: { events: [
        { seq: 1, kind: { type: 'tool_call_start', data: { tool_call_id: 'delegate-1', tool_name: 'delegate', arguments: '{}' } } },
        { seq: 2, kind: { type: 'session_forked', data: { parent_session_id: 'root', child_session_id: 'child', tool_call_id: 'delegate-1', origin: 'delegation' } } }
      ] } }
    } }, replay: [] });
    await store.loadSession('agent-1', 'root');
    expect(store.activeSession.toolCalls[0]?.childSessionId).toBe('child');
    expect(openRoots(store)).toEqual(['root']);
    await store.loadSession('agent-1', 'child');
    expect(store.activeSessionId).toBe('child');
    expect(mockClient.loadSession).toHaveBeenLastCalledWith('child', '/tmp/work');
    expect(openRoots(store)).toEqual(['root']);
  });
});

describe('AgentsStore shared session pins', () => {
  const pinTime = '2026-10-20T10:00:00Z';
  function row(id: string, pin = true, extra: Record<string, unknown> = {}): SessionInfo {
    return { sessionId: id, title: id, cwd: '/tmp/work', _meta: {
      querymt: { pin: { pinned: pin, pinned_at: pin ? pinTime : null }, lifecycle: { session_id: id, resolved: false, archived: false, resolved_at: null, archived_at: null } }, ...extra
    } } as SessionInfo;
  }
  async function connected() {
    const store = createStore();
    mockClient.supportsSessionPins.mockReturnValue(true);
    await store.connectAgent('agent-1');
    return store;
  }
  it('loads older root pins through every pin-only page without mesh or lifecycle filters', async () => {
    const store = await connected();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('old-peer', true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('old-pin')], nextCursor: '100' })
      .mockResolvedValueOnce({ sessions: [row('other-pin'), row('child', true, { parentSessionId: 'root' }), row('remote', true, { location: 'remote', nodeId: 'node-1' })] });
    await Promise.all([store.ensurePinnedSessions(), store.ensurePinnedSessions()]);
    expect(mockClient.listSessions.mock.calls.map(([request]) => request)).toEqual([
      { _meta: { session_scope: 'root', querymt: { sessionFilters: { pinned: true } } } },
      { cursor: '100', _meta: { session_scope: 'root', querymt: { sessionFilters: { pinned: true } } } }
    ]);
    expect(store.pinnedSessions.map((session) => session.sessionId)).toEqual(['old-pin', 'other-pin']);
    expect(mockClient.loadSession).not.toHaveBeenCalled();
  });
  it('uses the existing persistent cache then reconciles shared unpins and deletion notifications', async () => {
    const store = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('pinned')] });
    await store.ensurePinnedSessions();
    store.dispose();
    const restored = await connected();
    mockClient.listSessions.mockClear();
    await restored.ensurePinnedSessions();
    expect(restored.pinnedSessions[0]?.sessionId).toBe('pinned');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    mockClient.listSessions.mockResolvedValue({ sessions: [] });
    mockClient.emitExtensionNotification({ method: 'querymt/session/pinsChanged', params: { session_id: 'pinned' } });
    await vi.waitFor(() => expect(restored.pinnedSessions).toEqual([]));
  });
  it('gates unsupported, mesh and child writes without sending them', async () => {
    const store = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('root', false)] });
    await store.refreshSessionsForAgent('agent-1');
    const root = store.sessions[0];
    expect(store.canPinSession(root)).toBe(true);
    for (const invalid of [{ ...root, location: 'remote' as const }, { ...root, parentSessionId: 'parent' }]) {
      await expect(store.setSessionPinned(invalid, true)).rejects.toThrow('Pins are only available');
    }
    mockClient.supportsSessionPins.mockReturnValue(false);
    await store.ensurePinnedSessions();
    await expect(store.setSessionPinned(root, true)).rejects.toThrow('Pins are only available');
    expect(mockClient.setSessionPinned).not.toHaveBeenCalled();
  });
  it('updates only confirmed writes, preserves activity and prevents duplicate submissions', async () => {
    const store = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('root', false)] });
    await store.refreshSessionsForAgent('agent-1');
    const root = store.sessions[0];
    let release!: (pin: { session_id: string; pinned: boolean; pinned_at: string }) => void;
    mockClient.setSessionPinned.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    mockClient.listSessions.mockResolvedValue({ sessions: [row('root')] });
    const write = store.setSessionPinned(root, true);
    await store.setSessionPinned(root, true);
    expect(store.sessionPinPending['agent-1:root']).toBe(true);
    expect(store.pinnedSessions).toEqual([]);
    release({ session_id: 'root', pinned: true, pinned_at: pinTime });
    await write;
    await vi.waitFor(() => expect(store.pinnedSessions).toHaveLength(1));
    expect(mockClient.setSessionPinned).toHaveBeenCalledOnce();
    expect(store.sessions[0].pin?.pinned).toBe(true);
    expect(store.sessions[0].updatedAt).toBe(root.updatedAt);
    mockClient.setSessionPinned.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(store.setSessionPinned(store.sessions[0], false)).rejects.toThrow('Storage unavailable');
    expect(store.sessionPinErrors['agent-1:root']).toContain('Storage unavailable');
    expect(store.pinnedSessions).toHaveLength(1);
  });
  it('ignores a stale pinned page after a successful unpin', async () => {
    const store = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('root')] });
    await store.ensurePinnedSessions();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = store.ensurePinnedSessions(true);
    mockClient.listSessions.mockResolvedValue({ sessions: [] });
    await store.setSessionPinned(store.pinnedSessions[0], false);
    release({ sessions: [row('root')] });
    await old;
    expect(store.pinnedSessions).toEqual([]);
  });
  it('retains known pins on load error and permits retry', async () => {
    const store = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('root')] });
    await store.ensurePinnedSessions();
    mockClient.listSessions.mockRejectedValueOnce(new Error('Offline'));
    await store.ensurePinnedSessions(true);
    expect(store.pinnedSessions).toHaveLength(1);
    expect(store.pinnedSessionsErrors['agent-1']).toContain('Offline');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [] });
    await store.ensurePinnedSessions(true);
    expect(store.pinnedSessionsErrors['agent-1']).toBeNull();
    expect(store.pinnedSessions).toEqual([]);
  });
  it('clears stale ordinary pin metadata after a complete pin reconciliation, including a cache hit', async () => {
    const store = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('stale-pin')] });
    await store.refreshSessionsForAgent('agent-1');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [] });
    await store.ensurePinnedSessions();
    expect(store.sessions[0].pin?.pinned).toBe(false);
    store.dispose();
    const restored = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('stale-pin')] });
    await restored.refreshSessionsForAgent('agent-1');
    mockClient.listSessions.mockClear();
    await restored.ensurePinnedSessions();
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(restored.sessions[0].pin?.pinned).toBe(false);
  });
  it('loads a pin outside activity pages with its known workspace and root metadata', async () => {
    const store = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('old-pin')] });
    await store.ensurePinnedSessions();
    await store.loadSession('agent-1', 'old-pin');
    expect(mockClient.loadSession).toHaveBeenCalledWith('old-pin', '/tmp/work');
    expect(store.sessions.find((session) => session.sessionId === 'old-pin')).toMatchObject({
      title: 'old-pin', cwd: '/tmp/work', relationshipKnown: true, pin: { pinned: true }
    });
  });
  it('preserves a lifecycle write that completes while a pinned page is in flight', async () => {
    const store = await connected();
    mockClient.supportsSessionLifecycle.mockReturnValue(true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('old-pin')] });
    await store.ensurePinnedSessions();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const read = store.ensurePinnedSessions(true);
    await store.setSessionLifecycle('agent-1', 'old-pin', { archived: true });
    release({ sessions: [row('old-pin')] });
    await read;
    expect(store.pinnedSessions[0].lifecycle?.archived).toBe(true);
    const persisted = JSON.parse(window.localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)!);
    expect(persisted.entries.find((entry: { key: string }) => entry.key.startsWith('pins:')).sessions[0].lifecycle.archived).toBe(true);
  });
  it('ignores late pin reads after disposal', async () => {
    const store = await connected();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const read = store.ensurePinnedSessions();
    store.dispose();
    release({ sessions: [row('late-pin')] });
    await read;
    expect(store.pinnedSessions).toEqual([]);
  });
  it('retires a pending pin write when its endpoint changes', async () => {
    const store = await connected();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [row('root', false)] });
    await store.refreshSessionsForAgent('agent-1');
    let release!: (pin: { session_id: string; pinned: boolean; pinned_at: string }) => void;
    mockClient.setSessionPinned.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const write = store.setSessionPinned(store.sessions[0], true);
    store.updateConfig('agent-1', { commandLine: 'other-agent' });
    expect(store.sessionPinPending['agent-1:root']).toBeFalsy();
    release({ session_id: 'root', pinned: true, pinned_at: pinTime });
    await write;
    expect(store.pinnedSessions).toEqual([]);
    expect(store.sessions[0].pin?.pinned).toBe(false);
  });
  it('does not accept a late pin page from a replaced endpoint', async () => {
    const store = await connected();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const read = store.ensurePinnedSessions();
    store.updateConfig('agent-1', { commandLine: 'other-agent' });
    release({ sessions: [row('old-endpoint')] });
    await read;
    expect(store.pinnedSessions).toEqual([]);
  });
});

describe('AgentsStore session lifecycle', () => {
  async function lifecycleStore() {
    const store = createStore();
    mockClient.supportsSessionLifecycle.mockReturnValue(true);
    await store.connectAgent('agent-1');
    mockClient.listSessions.mockClear();
    return store;
  }

  function summary(sessionId = 'session-1'): DesktopSessionSummary {
    return { agentId: 'agent-1', agentName: 'QMTCODE', sessionId, title: sessionId, cwd: '/tmp/work', updatedAt: '2026-10-01T00:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'thinking', lifecycle: { session_id: sessionId, resolved: false, archived: false, resolved_at: null, archived_at: null } };
  }

  function listed(sessionId: string): SessionInfo {
    return { sessionId, title: sessionId, cwd: '/tmp/work', _meta: { querymt: { lifecycle: summary(sessionId).lifecycle } } } as SessionInfo;
  }

  it('reuses a fresh completed catalog when returning to the page instead of reloading every session', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('first')], nextCursor: '10' })
      .mockResolvedValueOnce({ sessions: [listed('later')] });
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    await store.ensureSessionCatalog();
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['first', 'later']);
  });

  it('shares one in-flight catalog fill across repeated requests for the same scope', async () => {
    const store = await lifecycleStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = store.ensureSessionCatalog();
    const second = store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledOnce();
    release({ sessions: [listed('shared')] });
    await Promise.all([first, second]);
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['shared']);
  });

  it('restores a fresh persisted catalog into a new store without a second catalog request', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('persisted')] });
    await store.ensureSessionCatalog();
    const restored = await lifecycleStore();
    await restored.ensureSessionCatalog();
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(restored.sessionCatalog.map((session) => session.sessionId)).toEqual(['persisted']);
    expect(restored.sessionsByAgent['agent-1'].some((session) => session.sessionId === 'persisted')).toBe(true);
  });

  it('shows stale cached rows immediately while reconciling in the background', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('stale')] });
    await store.ensureSessionCatalog();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SESSION_CATALOG_FRESH_MS + 1);
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    try {
      const refresh = store.ensureSessionCatalog();
      expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['stale']);
      expect(store.sessionCatalogLoading).toBe(true);
      release({ sessions: [listed('fresh')] });
      await refresh;
      expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['fresh']);
    } finally { clock.mockRestore(); }
  });

  it('restores an incomplete snapshot but restarts from page one instead of reusing an old offset', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('partial')], nextCursor: '10' })
      .mockRejectedValueOnce(new Error('Owner offline'));
    await store.ensureSessionCatalog();
    const restored = await lifecycleStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const refresh = restored.ensureSessionCatalog();
    expect(restored.sessionCatalog.map((session) => session.sessionId)).toEqual(['partial']);
    expect(mockClient.listSessions).toHaveBeenCalledWith({ _meta: { session_scope: 'root', querymt: { sessionFilters: { resolution: 'open', archive: 'excluded' } } } });
    release({ sessions: [listed('new-first')] });
    await refresh;
    expect(restored.sessionCatalog.map((session) => session.sessionId)).toEqual(['new-first']);
  });

  it('caches lifecycle views separately and restores the first view without reloading it', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('open-view')] });
    await store.ensureSessionCatalog();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [{ ...listed('resolved-view'), _meta: { querymt: { lifecycle: { ...summary('resolved-view').lifecycle!, resolved: true } } } }] });
    await store.ensureSessionCatalog({ resolution: 'resolved', archive: 'excluded' });
    expect(store.sessionCatalog[0].sessionId).toBe('resolved-view');
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog[0].sessionId).toBe('open-view');
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
  });

  it('keeps explicit Refresh authoritative even when a snapshot is fresh', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('old')] });
    await store.ensureSessionCatalog();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('new')] });
    await store.refreshSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['new']);
  });

  it('patches snapshots after confirmed lifecycle writes but not after rejected writes', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('task')] });
    await store.ensureSessionCatalog();
    mockClient.setSessionLifecycle.mockRejectedValueOnce(new Error('Write rejected'));
    await expect(store.setSessionLifecycle('agent-1', 'task', { resolved: true })).rejects.toThrow('Write rejected');
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledOnce();
    await store.setSessionLifecycle('agent-1', 'task', { resolved: true });
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledOnce();
    expect(store.sessionCatalog).toEqual([]);
  });

  it('patches every cached lifecycle view without extending freshness or reloading on navigation', async () => {
    const store = await lifecycleStore();
    const filters = [
      { resolution: 'open', archive: 'excluded' },
      { resolution: 'resolved', archive: 'excluded' },
      { resolution: 'any', archive: 'only' },
      { resolution: 'any', archive: 'any' }
    ] as const;
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('task'), listed('untouched')] });
    await store.ensureSessionCatalog(filters[0]);
    mockClient.listSessions.mockResolvedValue({ sessions: [] });
    await store.ensureSessionCatalog(filters[1]);
    await store.ensureSessionCatalog(filters[2]);
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('task'), listed('untouched')] });
    await store.ensureSessionCatalog(filters[3]);
    const before = JSON.parse(localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)!).entries;
    const calls = mockClient.listSessions.mock.calls.length;
    await store.setSessionLifecycle('agent-1', 'task', { resolved: true });
    for (const filter of filters) {
      await store.ensureSessionCatalog(filter);
      expect(store.sessionCatalog.some((session) => session.sessionId === 'task')).toBe(filter.archive !== 'only' && filter.resolution !== 'open');
    }
    expect(mockClient.listSessions).toHaveBeenCalledTimes(calls);
    store.dispose();
    const after = JSON.parse(localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)!).entries;
    expect(after.map((entry: { checkedAt: number }) => entry.checkedAt).sort()).toEqual(before.map((entry: { checkedAt: number }) => entry.checkedAt).sort());
    expect(after.every((entry: { complete: boolean }) => entry.complete)).toBe(true);
  });

  it('does not traverse a 7000-root catalog again after creation and deletion', async () => {
    const store = await lifecycleStore();
    mockClient.connect.mockResolvedValueOnce({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { delete: {} } }, authMethods: [] });
    await store.connectAgent('agent-1', true);
    const rows = Array.from({ length: 7000 }, (_, index) => listed(`root-${index}`));
    mockClient.listSessions.mockClear().mockImplementation(async (request) => {
      const offset = Number(request?.cursor ?? 0);
      return { sessions: rows.slice(offset, offset + 100), nextCursor: offset + 100 < rows.length ? String(offset + 100) : undefined };
    });
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog).toHaveLength(7000);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(70);
    await store.createBackgroundSession('agent-1', '/tmp/work');
    const afterCreate = mockClient.listSessions.mock.calls.length;
    expect(afterCreate).toBe(71);
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledTimes(afterCreate);
    expect(store.sessionCatalog).toHaveLength(7001);
    expect(store.sessionCatalog.some((session) => session.sessionId === 'session-1')).toBe(true);
    await store.deleteSession('agent-1', 'session-1');
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog).toHaveLength(7000);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(afterCreate);
  }, 15_000);

  it.each(['create', 'delete', 'lifecycle', 'pin'] as const)('keeps a confirmed %s across delayed catalog pages without restarting the traversal', async (mutation) => {
    const store = await lifecycleStore();
    mockClient.connect.mockResolvedValueOnce({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { delete: {} } }, authMethods: [] });
    await store.connectAgent('agent-1', true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('task')] });
    await store.ensureSessionCatalog();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const refresh = store.refreshSessionCatalog();
    if (mutation === 'create') await store.createBackgroundSession('agent-1', '/tmp/work');
    if (mutation === 'delete') await store.deleteSession('agent-1', 'task');
    if (mutation === 'lifecycle') await store.setSessionLifecycle('agent-1', 'task', { resolved: true });
    if (mutation === 'pin') {
      mockClient.supportsSessionPins.mockReturnValue(true);
      mockClient.listSessions.mockResolvedValue({ sessions: [{ ...listed('task'), _meta: { querymt: {
        lifecycle: summary('task').lifecycle, pin: { pinned: true, pinned_at: '2026-10-20T10:00:00Z' }
      } } }] });
      await store.setSessionPinned(store.sessionsByAgent['agent-1'][0], true);
    }
    release({ sessions: [listed('task')] });
    await refresh;
    const calls = mockClient.listSessions.mock.calls.length;
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledTimes(calls);
    expect(store.sessionCatalogLoading).toBe(false);
    if (mutation === 'create') expect(store.sessionCatalog.some((session) => session.sessionId === 'session-1')).toBe(true);
    if (mutation === 'delete' || mutation === 'lifecycle') expect(store.sessionCatalog.some((session) => session.sessionId === 'task')).toBe(false);
    if (mutation === 'pin') expect(store.sessionCatalog[0].pin?.pinned).toBe(true);
  });

  it('uses the selected owner catalog and sends the selected profile during remote creation', async () => {
    const store = await lifecycleStore();
    store.managedProfileOptions = [{ id: 'a-only', label: 'A only' }];
    store.setComposerTarget('node-1');
    await store.refreshRemoteProfiles('agent-1', 'node-1');
    expect(store.getProfileOptions('agent-1').map((profile) => profile.id)).toEqual(['querymt:owner-default', 'cdr', 'default']);
    expect(mockClient.listProfiles).toHaveBeenCalledWith('node-1');
    store.setComposerCwd('/owner/work');
    store.setComposerProfile('cdr');
    expect(await store.createSession('agent-1')).toBe('new-remote');
    expect(mockClient.createRemoteSession).toHaveBeenCalledWith({ node_id: 'node-1', cwd: '/owner/work', profile_id: 'cdr', attach: true });
    expect(mockClient.createSession).not.toHaveBeenCalled();
    store.setComposerTarget('node-2');
    expect(store.composerProfileId).toBe('querymt:owner-default');
    expect(store.getProfileOptions('agent-1').map((profile) => profile.id)).toEqual(['querymt:owner-default']);
  });

  it('keeps an explicit embedded-default profile distinct from the owner active default', async () => {
    const store = await lifecycleStore();
    store.setComposerTarget('node-1');
    store.setComposerCwd('/owner/work');
    store.setComposerProfile('default');
    await store.createSession('agent-1');
    expect(mockClient.createRemoteSession).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'default' }));
  });

  it('blocks an explicit remote profile when owner discovery fails rather than creating a default session', async () => {
    const store = await lifecycleStore();
    store.setComposerTarget('node-1');
    store.setComposerCwd('/owner/work');
    store.setComposerProfile('cdr');
    mockClient.listProfiles.mockRejectedValueOnce(new Error('Owner unavailable'));
    expect(await store.createSession('agent-1')).toBeNull();
    expect(store.error).toBe('Owner unavailable');
    expect(store.composerProfileId).toBe('cdr');
    expect(mockClient.createRemoteSession).not.toHaveBeenCalled();
  });

  it('dismisses only the selected owner profile error without changing catalogs or validation', async () => {
    const store = await lifecycleStore();
    store.remoteProfileErrors = {
      'agent-1:node-1': 'Owner unavailable', 'agent-1:node-2': 'Other owner unavailable',
      'other-agent:node-1': 'Other agent unavailable'
    };
    store.remoteProfileOptions = { 'agent-1:node-1': [{ id: 'cdr', label: 'Coder' }] };
    store.setComposerTarget('node-1');
    store.setComposerProfile('cdr');
    expect(store.getLaunchProfileError('agent-1')).toBe('Owner unavailable');
    store.clearLaunchProfileError(null);
    expect(store.getLaunchProfileError('agent-1')).toBe('Owner unavailable');
    store.clearLaunchProfileError('agent-1');
    expect(store.getLaunchProfileError('agent-1')).toBeNull();
    expect(store.remoteProfileErrors).toEqual({
      'agent-1:node-1': null, 'agent-1:node-2': 'Other owner unavailable',
      'other-agent:node-1': 'Other agent unavailable'
    });
    expect(store.remoteProfileOptions['agent-1:node-1']).toEqual([{ id: 'cdr', label: 'Coder' }]);
    store.setComposerTarget('local');
    store.clearLaunchProfileError('agent-1');
    expect(store.remoteProfileErrors['agent-1:local']).toBeUndefined();
    store.setComposerTarget('node-1');
    store.setComposerProfile('cdr');
    store.setComposerCwd('/owner/work');
    mockClient.listProfiles.mockRejectedValueOnce(new Error('Owner still unavailable'));
    expect(await store.createSession('agent-1')).toBeNull();
    expect(store.getLaunchProfileError('agent-1')).toBe('Owner still unavailable');
    expect(mockClient.createRemoteSession).not.toHaveBeenCalled();
  });

  it('does not offer an old endpoint catalog after a delayed owner profile response', async () => {
    const store = await lifecycleStore();
    store.setComposerTarget('node-1');
    let release!: () => void;
    mockClient.listProfiles.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ node_id: 'node-1', profiles: [{ id: 'old', name: 'Old owner', description: null }], active_profile_id: 'old' });
    }));
    const read = store.refreshRemoteProfiles('agent-1', 'node-1');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    store.updateConfig('agent-1', { commandLine: 'other-agent' });
    release();
    await read;
    expect(store.getProfileOptions('agent-1').map((profile) => profile.id)).toEqual(['querymt:owner-default']);
  });

  it('patches a newly created remote root only into scopes including its owner', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('local')] });
    await store.ensureSessionCatalog();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    await store.ensureSessionCatalog();
    const before = mockClient.listSessions.mock.calls.length;
    await store.createRemoteSession('agent-1', 'node-1', '/remote/work');
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog.find((session) => session.sessionId === 'new-remote')).toMatchObject({
      location: 'remote', remoteNodeId: 'node-1', cwd: '/remote/work', relationshipKnown: true
    });
    chatPreferencesStore.setShowRemoteSessions(false);
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['local']);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(before);
  });

  it('retains the head-page metadata for a new root in the reusable catalog', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('existing')] });
    await store.ensureSessionCatalog();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [{ ...listed('session-1'), title: 'Owner title' }] });
    await store.createBackgroundSession('agent-1', '/tmp/work');
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog.find((session) => session.sessionId === 'session-1')?.title).toBe('Owner title');
  });

  it('keeps the completed catalog after a rejected create or delete', async () => {
    const store = await lifecycleStore();
    mockClient.connect.mockResolvedValueOnce({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { delete: {} } }, authMethods: [] });
    await store.connectAgent('agent-1', true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('task')] });
    await store.ensureSessionCatalog();
    mockClient.createSession.mockRejectedValueOnce(new Error('Create denied'));
    await expect(store.createBackgroundSession('agent-1', '/tmp/work')).rejects.toThrow('Create denied');
    mockClient.deleteSession.mockRejectedValueOnce(new Error('Delete denied'));
    await expect(store.deleteSession('agent-1', 'task')).rejects.toThrow('Delete denied');
    const calls = mockClient.listSessions.mock.calls.length;
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledTimes(calls);
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['task']);
  });

  it('reconciles a confirmed deletion after reconnect without reloading or clearing newer runtime state', async () => {
    mockClient.connect.mockResolvedValue({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { delete: {} } }, authMethods: [] });
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('deleted')] });
    await store.ensureSessionCatalog();
    let confirm!: () => void;
    mockClient.deleteSession.mockImplementationOnce(() => new Promise<undefined>((resolve) => { confirm = () => resolve(undefined); }));
    const deletion = store.deleteSession('agent-1', 'deleted');
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    await store.connectAgent('agent-1', true);
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'deleted';
    store.activeSession.sessionId = 'deleted';
    confirm();
    await deletion;
    const reads = mockClient.listSessions.mock.calls.length;
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledTimes(reads);
    expect(store.sessionCatalog).toEqual([]);
    expect(store.sessionsByAgent['agent-1']).toEqual([]);
    expect(store.workspaceSessionGroups.flatMap((group) => group.sessions)).toEqual([]);
    expect(store.activeSessionId).toBe('deleted');
    store.dispose();
    const cached = JSON.parse(localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)!).entries;
    expect(cached.every((entry: { sessions: unknown[] }) => !entry.sessions.length)).toBe(true);
  });

  it.each(['create-response', 'lifecycle-response'] as const)('returns confirmed local creation after reconnect at %s and reconciles on the next catalog read', async (boundary) => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('existing')] });
    await store.ensureSessionCatalog();
    let release!: () => void;
    const response = { sessionId: 'confirmed-local', configOptions: [] };
    if (boundary === 'create-response') {
      mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(response); }));
    } else {
      mockClient.createSession.mockResolvedValueOnce(response);
      mockClient.getSessionLifecycle.mockImplementationOnce(() => new Promise((resolve) => {
        release = () => resolve(summary('confirmed-local').lifecycle!);
      }));
    }
    const creation = store.createBackgroundSession('agent-1', '/tmp/work');
    const outcome = expect(creation).resolves.toEqual(response);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await store.connectAgent('agent-1', true);
    release();
    await outcome;
    expect(store.lastCreatedSession).toBeNull();
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('existing'), listed('confirmed-local')] });
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog.some((session) => session.sessionId === 'confirmed-local')).toBe(true);
    expect(mockClient.createSession).toHaveBeenCalledOnce();
  });

  it.each(['create-response', 'lifecycle-response'] as const)('returns confirmed remote creation after reconnect at %s without publishing the old attachment', async (boundary) => {
    const store = await lifecycleStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('existing')] });
    await store.ensureSessionCatalog();
    let release!: () => void;
    const response: RemoteSessionAttachInfo = { session_id: 'confirmed-remote', node_id: 'node-1', attached: true,
      config_options: [], snapshot: { audit: { events: [] } } };
    if (boundary === 'create-response') {
      mockClient.createRemoteSession.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(response); }));
    } else {
      mockClient.createRemoteSession.mockResolvedValueOnce(response);
      mockClient.getSessionLifecycle.mockImplementationOnce(() => new Promise((resolve) => {
        release = () => resolve(summary('confirmed-remote').lifecycle!);
      }));
    }
    const creation = store.createRemoteSession('agent-1', 'node-1', '/remote/work');
    const outcome = expect(creation).resolves.toEqual(response);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await store.connectAgent('agent-1', true);
    release();
    await outcome;
    expect(store.lastRemoteAttachByAgent['agent-1']).toBeUndefined();
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('existing'), { ...listed('confirmed-remote'),
      _meta: { querymt: { lifecycle: summary('confirmed-remote').lifecycle, remote: true, node_id: 'node-1' } } }] });
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog.some((session) => session.sessionId === 'confirmed-remote')).toBe(true);
    expect(mockClient.createRemoteSession).toHaveBeenCalledOnce();
  });

  it.each((['delete', 'local-create', 'remote-create'] as const).flatMap((mutation) =>
    (['replace', 'replace-restore', 'save-restore', 'remove-recreate', 'dispose'] as const).map((change) => ({ mutation, change }))
  ))('does not apply a confirmed $mutation to retired state after $change', async ({ mutation, change }) => {
    mockClient.connect.mockResolvedValue({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { delete: {} } }, authMethods: [] });
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('same-id')] });
    await store.ensureSessionCatalog();
    let confirm!: () => void;
    const localResponse = { sessionId: 'old-created', configOptions: [] };
    const remoteResponse: RemoteSessionAttachInfo = { session_id: 'old-created', node_id: 'node-1', attached: true,
      config_options: [], snapshot: { audit: { events: [] } } };
    const expected = mutation === 'delete' ? undefined : mutation === 'local-create' ? localResponse : remoteResponse;
    if (mutation === 'delete') mockClient.deleteSession.mockImplementationOnce(() => new Promise<undefined>((resolve) => { confirm = () => resolve(undefined); }));
    if (mutation === 'local-create') mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => {
      confirm = () => resolve(localResponse);
    }));
    if (mutation === 'remote-create') mockClient.createRemoteSession.mockImplementationOnce(() => new Promise((resolve) => {
      confirm = () => resolve(remoteResponse);
    }));
    const operation = mutation === 'delete' ? store.deleteSession('agent-1', 'same-id') : mutation === 'local-create'
      ? store.createBackgroundSession('agent-1', '/tmp/work') : store.createRemoteSession('agent-1', 'node-1', '/remote/work');
    const outcome = expect(operation).resolves.toEqual(expected);
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    const original = { ...store.configs[0] };
    if (change === 'dispose') store.dispose();
    else if (change === 'remove-recreate') {
      const runtime = { ...store.statuses['agent-1'] };
      await store.deleteConfig('agent-1');
      store.saveConfig(original);
      store.statuses = { ...store.statuses, 'agent-1': runtime };
      await store.connectAgent('agent-1');
    } else if (change === 'save-restore') {
      store.saveConfig({ ...original, commandLine: 'other-agent' });
      store.saveConfig(original);
    } else {
      store.updateConfig('agent-1', { commandLine: 'other-agent' });
      if (change === 'replace-restore') store.updateConfig('agent-1', { commandLine: original.commandLine });
    }
    if (change !== 'dispose') await store.ensureSessionCatalog();
    const reads = mockClient.listSessions.mock.calls.length;
    const remoteReads = mockClient.listRemoteSessions.mock.calls.length;
    confirm();
    await outcome;
    if (change !== 'dispose') await store.ensureSessionCatalog();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['same-id']);
    expect(store.sessionsByAgent['agent-1'].map((session) => session.sessionId)).toEqual(['same-id']);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(reads);
    expect(mockClient.listRemoteSessions).toHaveBeenCalledTimes(remoteReads);
    expect(store.lastCreatedSession).toBeNull();
    expect(store.lastRemoteAttachByAgent['agent-1']).toBeUndefined();
  });

  it('returns the created remote session ID after reconnect without hydrating an old attachment over a newer selection', async () => {
    const store = await lifecycleStore();
    store.setComposerTarget('node-1');
    let confirm!: () => void;
    mockClient.createRemoteSession.mockImplementationOnce(() => new Promise((resolve) => {
      confirm = () => resolve({ session_id: 'created-remote', node_id: 'node-1', attached: true, config_options: [], snapshot: { audit: { events: [] } } });
    }));
    const creation = store.createSession('agent-1');
    const outcome = expect(creation).resolves.toBe('created-remote');
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    await store.connectAgent('agent-1', true);
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'newer-selection';
    store.activeSession.sessionId = 'newer-selection';
    confirm();
    await outcome;
    expect(store.activeSessionId).toBe('newer-selection');
    expect(store.lastRemoteAttachByAgent['agent-1']).toBeUndefined();
    expect(store.error).toBeNull();
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it('reports an outdated remote node on create without leaving a half-created session', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('existing')] });
    await store.ensureSessionCatalog();
    store.composerTargetId = 'node-1';
    mockClient.createRemoteSession.mockRejectedValueOnce(
      new RemoteNodeUpgradeRequiredError('nas')
    );

    await expect(store.createSession('agent-1')).resolves.toBeNull();

    expect(store.error).toContain('Remote node "nas" must be upgraded');
    expect(store.activeSessionId).toBeNull();
    expect(store.lastRemoteAttachByAgent['agent-1']).toBeUndefined();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['existing']);
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
    expect(mockClient.createRemoteSession).toHaveBeenCalledOnce();
  });

  it.each(['local', 'node-1'])('does not select or configure a session from a replaced endpoint when composer target is %s', async (target) => {
    const store = await lifecycleStore();
    store.setComposerTarget(target);
    let confirm!: () => void;
    if (target === 'local') mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => {
      confirm = () => resolve({ sessionId: 'old-created', configOptions: [] });
    }));
    else mockClient.createRemoteSession.mockImplementationOnce(() => new Promise((resolve) => {
      confirm = () => resolve({ session_id: 'old-created', node_id: target, attached: true, config_options: [], snapshot: { audit: { events: [] } } });
    }));
    const creation = store.createSession('agent-1');
    const outcome = expect(creation).resolves.toBe('old-created');
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    store.updateConfig('agent-1', { commandLine: 'other-agent' });
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'replacement-selection';
    store.activeSession.sessionId = 'replacement-selection';
    confirm();
    await outcome;
    expect(store.activeSessionId).toBe('replacement-selection');
    expect(store.error).toBeNull();
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it('isolates remote peer selections even when the selected lifecycle view is unchanged', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('local-only')] });
    await store.ensureSessionCatalog();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('new-peer', true);
    try {
      mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('with-peer')] });
      await store.ensureSessionCatalog();
      expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
      expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['with-peer']);
    } finally {
      chatPreferencesStore.setRemoteSessionPeer('new-peer', false);
      chatPreferencesStore.setShowRemoteSessions(false);
    }
  });

  it('does not query a discovered but excluded peer for lifecycle statuses', async () => {
    const store = await lifecycleStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    store.meshNodesByAgent = { 'agent-1': meshNodes(['legacy-peer']) };
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', true);
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', false);
    mockClient.listSessions.mockImplementation(async (request) => {
      if (request?._meta?.remoteNodeIds) throw new Error('Legacy peer has no lifecycle support');
      return { sessions: [listed('local')] };
    });
    await store.refreshAllSessions();
    await store.ensureSessionCatalog();
    expect(store.sessionCatalogError).toBeNull();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['local']);
    expect(mockClient.listSessions).toHaveBeenLastCalledWith({
      _meta: { session_scope: 'root', querymt: { sessionFilters: { resolution: 'open', archive: 'excluded' } } }
    });
    expect(mockClient.listSessions.mock.calls.every(([request]) => !request?._meta?.remoteNodeIds)).toBe(true);
  });

  it.each(['peer', 'all-remotes'])('clears an excluded peer error immediately when disabling %s, without mounting Sessions', async (setting) => {
    const store = await lifecycleStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', true);
    mockClient.listSessions.mockRejectedValueOnce(new RequestError(-32603, 'Internal error',
      'Remote session owner cannot provide lifecycle-filtered results: unsupported'));
    await store.refreshSessionCatalog();
    expect(store.sessionCatalogError).toContain('unsupported');

    if (setting === 'peer') chatPreferencesStore.setRemoteSessionPeer('legacy-peer', false);
    else chatPreferencesStore.setShowRemoteSessions(false);
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('local')] });
    const refresh = store.refreshAllSessions();
    expect(store.sessionCatalogError).toBeNull();
    await refresh;
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['local']);
    expect(store.sessionCatalogError).toBeNull();
  });

  it.each(['reject', 'resolve'] as const)('ignores an excluded peer catalog response (%s) even while Sessions is unmounted', async (outcome) => {
    const store = await lifecycleStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', true);
    let release!: (page: { sessions: SessionInfo[]; nextCursor?: string }) => void;
    let reject!: (error: Error) => void;
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('old-local')], nextCursor: 'remote:0:0:live' })
      .mockImplementationOnce(() => new Promise((resolve, rejectPage) => { release = resolve; reject = rejectPage; }));
    const old = store.refreshSessionCatalog();
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledTimes(2));
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', false);
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('new-local')] });
    await store.refreshAllSessions();
    if (outcome === 'reject') reject(new Error('Remote session owner is unavailable for lifecycle-filtered results: deadline has elapsed'));
    else release({ sessions: [listed('obsolete')], nextCursor: 'remote:0:100:live' });
    await old;
    expect(mockClient.listSessions).toHaveBeenCalledTimes(3);
    expect(store.sessionCatalogError).toBeNull();
    expect(store.sessionCatalogLoading).toBe(false);
    expect(store.sessionCatalog.some((session) => session.sessionId === 'obsolete')).toBe(false);
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['new-local']);
  });

  it.each(['reject', 'resolve'] as const)('restarts discovery with no excluded peer instead of coalescing with an old scope (%s)', async (outcome) => {
    const store = await lifecycleStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', true);
    let release!: (page: { sessions: SessionInfo[]; nextCursor?: string }) => void;
    let reject!: (error: Error) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve, rejectPage) => { release = resolve; reject = rejectPage; }));
    const old = store.refreshSessionsForAgent('agent-1', true);
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledOnce());
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', false);
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('local')] });
    const refresh = store.refreshAllSessions();
    if (outcome === 'reject') reject(new Error('Obsolete remote request failed'));
    else release({ sessions: [listed('obsolete')], nextCursor: 'remote:0:0:live' });
    await Promise.all([old, refresh]);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    expect(mockClient.listSessions).toHaveBeenLastCalledWith(listSessionsRequest());
    expect(store.sessionsByAgent['agent-1'].map((session) => session.sessionId)).toEqual(['local']);
    expect(store.connectionStates['agent-1']).toBe('initialized');
    expect(store.agentErrors['agent-1']).toBeNull();
    expect(store.error).toBeNull();
  });

  it('keeps other included peers in lifecycle requests when an unsupported peer is excluded', async () => {
    const store = await lifecycleStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', true);
    chatPreferencesStore.setRemoteSessionPeer('updated-peer', true);
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', false);
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('local')] });
    await store.refreshAllSessions();
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenLastCalledWith({ _meta: {
      session_scope: 'root', remoteNodeIds: ['updated-peer'],
      querymt: { sessionFilters: { resolution: 'open', archive: 'excluded' } }
    } });
    expect(store.sessionCatalogError).toBeNull();
    mockClient.listSessions.mockRejectedValueOnce(new Error('Included owner failed'));
    await store.refreshSessionCatalog();
    expect(store.sessionCatalogError).toContain('Included owner failed');
  });

  it('still coalesces full discoveries for the same peer scope', async () => {
    const store = await lifecycleStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = store.refreshSessionsForAgent('agent-1', true);
    const second = store.refreshSessionsForAgent('agent-1', true);
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledOnce());
    release({ sessions: [listed('local')] });
    await Promise.all([first, second]);
    expect(mockClient.listSessions).toHaveBeenCalledOnce();
  });

  it('does not deadlock a queued activity refresh when exclusion queues a replacement discovery', async () => {
    const store = await lifecycleStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', true);
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = store.refreshSessionsForAgent('agent-1', true);
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledOnce());
    const activity = store.refreshSessionsForAgent('agent-1');
    chatPreferencesStore.setRemoteSessionPeer('legacy-peer', false);
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('local')] });
    const refresh = store.refreshAllSessions();
    release({ sessions: [listed('obsolete')] });
    await Promise.all([old, activity, refresh]);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(3);
    expect(mockClient.listSessions).toHaveBeenLastCalledWith(listSessionsRequest());
    expect(store.sessionsByAgent['agent-1'].map((session) => session.sessionId)).toEqual(['local']);
  });

  it('applies lifecycle predicates on every server page without discarding the global cache', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = { 'agent-1': [summary('history')] };
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('first')], nextCursor: '10' }).mockResolvedValueOnce({ sessions: [listed('later')] });
    await store.refreshSessionCatalog({ resolution: 'open', archive: 'excluded' });
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(1, { _meta: { session_scope: 'root', querymt: { sessionFilters: { resolution: 'open', archive: 'excluded' } } } });
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, { cursor: '10', _meta: { session_scope: 'root', querymt: { sessionFilters: { resolution: 'open', archive: 'excluded' } } } });
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['first', 'later']);
    expect(store.sessionsByAgent['agent-1'].some((session) => session.sessionId === 'history')).toBe(true);
  });

  it('publishes the first page while the next page is still pending', async () => {
    const store = await lifecycleStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('first')], nextCursor: '10' })
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const refresh = store.refreshSessionCatalog();
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledTimes(2));
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['first']);
    expect(store.sessionCatalogLoading).toBe(true);
    release({ sessions: [listed('later')] });
    await refresh;
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['first', 'later']);
    expect(store.sessionCatalogLoading).toBe(false);
  });

  it('counts only unique sessions received in the current load rather than retained cached rows', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('cached'), listed('first')] });
    await store.refreshSessionCatalog();
    expect(store.sessionCatalogLoadedCount).toBe(2);
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('first')], nextCursor: '10' })
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const refresh = store.refreshSessionCatalog();
    expect(store.sessionCatalogLoadedCount).toBe(0);
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledTimes(3));
    expect(store.sessionCatalog).toHaveLength(2);
    expect(store.sessionCatalogLoadedCount).toBe(1);
    release({ sessions: [listed('first'), listed('later')] });
    await refresh;
    expect(store.sessionCatalogLoadedCount).toBe(2);
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['first', 'later']);
  });

  it('publishes a fast agent without waiting for another agent', async () => {
    const store = await lifecycleStore();
    store.configs = [...store.configs, { ...store.configs[0], id: 'agent-2', name: 'Second agent' }];
    store.statuses = { ...store.statuses, 'agent-2': { ...store.statuses['agent-1'], agentId: 'agent-2' } };
    await store.connectAgent('agent-2');
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockClear().mockResolvedValueOnce({ sessions: [listed('fast')] })
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const refresh = store.refreshSessionCatalog();
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledTimes(2));
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['fast']);
    expect(store.sessionCatalogLoadedCount).toBe(1);
    expect(store.sessionCatalogLoading).toBe(true);
    release({ sessions: [listed('slow')] });
    await refresh;
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['fast', 'slow']);
    expect(store.sessionCatalogLoadedCount).toBe(2);
  });

  it('retains successful pages when a later page fails and clears the error on retry', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('first')], nextCursor: '10' })
      .mockRejectedValueOnce(new Error('Later page timed out'));
    await store.refreshSessionCatalog();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['first']);
    expect(store.sessionCatalogError).toContain('Later page timed out');
    expect(store.sessionCatalogLoading).toBe(false);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('first')], nextCursor: '10' })
      .mockResolvedValueOnce({ sessions: [listed('later')] });
    await store.refreshSessionCatalog();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['first', 'later']);
    expect(store.sessionCatalogError).toBeNull();
  });

  it.each([
    'Remote session owner cannot provide lifecycle-filtered results: lifecycle filtering is unsupported by the owner store',
    { message: 'Remote session owner is unavailable for lifecycle-filtered results: request timed out' }
  ])('shows ACP error details without dropping remote lifecycle filters (%j)', async (data) => {
    const store = await lifecycleStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('peer-owner', true);
    try {
      mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('local')], nextCursor: 'remote:0:0:live' })
        .mockRejectedValueOnce(new RequestError(-32603, 'Internal error', data));
      await store.refreshSessionCatalog();
      const detail = typeof data === 'string' ? data : data.message;
      expect(store.sessionCatalogError).toBe(`QMTCODE: ${detail}`);
      expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['local']);
      expect(store.sessionCatalogLoading).toBe(false);
      expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
      expect(mockClient.listSessions).toHaveBeenLastCalledWith({
        cursor: 'remote:0:0:live',
        _meta: { session_scope: 'root', remoteNodeIds: ['peer-owner'], querymt: { sessionFilters: { resolution: 'open', archive: 'excluded' } } }
      });
    } finally {
      chatPreferencesStore.setRemoteSessionPeer('peer-owner', false);
      chatPreferencesStore.setShowRemoteSessions(false);
    }
  });

  it('preserves cached rows on a failed refresh but removes missing rows after a complete refresh', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('cached')] });
    await store.refreshSessionCatalog();
    mockClient.listSessions.mockRejectedValueOnce(new Error('Owner offline'));
    await store.refreshSessionCatalog();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['cached']);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [] });
    await store.refreshSessionCatalog();
    expect(store.sessionCatalog).toEqual([]);
    expect(store.sessionCatalogError).toBeNull();
  });

  it('does not let an obsolete later-page error affect the current view', async () => {
    const store = await lifecycleStore();
    let reject!: (error: Error) => void;
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('old-first')], nextCursor: '10' })
      .mockImplementationOnce(() => new Promise((_resolve, rejectPage) => { reject = rejectPage; }));
    const old = store.refreshSessionCatalog();
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalledTimes(2));
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('new-view')] });
    await store.refreshSessionCatalog({ resolution: 'any', archive: 'any' });
    reject(new Error('Obsolete page failed'));
    await old;
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['new-view']);
    expect(store.sessionCatalogError).toBeNull();
    expect(store.sessionCatalogLoading).toBe(false);
  });

  it('distinguishes an empty lifecycle category from sessions on a later unfiltered remote page', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = {};
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('peer-owner', true);
    try {
      mockClient.listSessions.mockResolvedValueOnce({ sessions: [] })
        .mockResolvedValueOnce({ sessions: [], nextCursor: 'remote:0:0:live' })
        .mockResolvedValueOnce({ sessions: [listed('other-category')] });
      await store.refreshSessionCatalog({ resolution: 'resolved', archive: 'excluded' });
      expect(store.sessionCatalog).toEqual([]);
      expect(store.sessionCatalogHasSessions).toBe(true);
      expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, { _meta: { session_scope: 'root', remoteNodeIds: ['peer-owner'] } });
      expect(mockClient.listSessions).toHaveBeenLastCalledWith({ cursor: 'remote:0:0:live', _meta: { session_scope: 'root', remoteNodeIds: ['peer-owner'] } });
    } finally {
      chatPreferencesStore.setRemoteSessionPeer('peer-owner', false);
      chatPreferencesStore.setShowRemoteSessions(false);
    }
  });

  it('confirms the whole catalog is empty before offering first-session recovery', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = {};
    await store.refreshSessionCatalog({ resolution: 'any', archive: 'only' });
    expect(store.sessionCatalogHasSessions).toBe(false);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    expect(mockClient.listSessions).toHaveBeenLastCalledWith(listSessionsRequest());
  });

  it('does not label a failed existence check as an empty catalog', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = {};
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [] }).mockRejectedValueOnce(new Error('Unfiltered history unavailable'));
    await store.refreshSessionCatalog({ resolution: 'resolved', archive: 'excluded' });
    expect(store.sessionCatalogHasSessions).toBeNull();
    expect(store.sessionCatalog).toEqual([]);
    expect(store.sessionCatalogLoading).toBe(false);
  });

  it('uses known sessions without an extra existence request for empty categories', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = { 'agent-1': [summary('known-open')] };
    await store.refreshSessionCatalog({ resolution: 'resolved', archive: 'excluded' });
    expect(store.sessionCatalogHasSessions).toBe(true);
    expect(mockClient.listSessions).toHaveBeenCalledOnce();
  });

  it('excludes an unsupported agent without turning compatibility into an error or repeated refresh', async () => {
    const store = await lifecycleStore();
    mockClient.supportsSessionLifecycle.mockReturnValue(false);
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(store.sessionCatalogError).toBeNull();
    expect(store.sessionCatalogExcludedAgents).toEqual([{ id: 'agent-1', name: 'QMTCODE' }]);
    expect(store.sessionCatalogSupportedAgentCount).toBe(0);
    expect(store.sessionCatalogHasSessions).toBeNull();
    expect(store.sessionCatalogLoading).toBe(false);
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    await store.ensureSessionCatalog({ resolution: 'any', archive: 'any' });
    expect(mockClient.listSessions).toHaveBeenCalledWith(listSessionsRequest());
    expect(store.sessionCatalogExcludedAgents).toEqual([]);
    expect(store.sessionCatalogError).toBeNull();
  });

  it('loads and caches supported agents in a mixed-version setup while keeping real failures separate', async () => {
    const store = await lifecycleStore();
    const legacy = { ...createDistinctMockClient(), supportsSessionLifecycle: vi.fn(() => false) };
    vi.mocked(DesktopAcpClient).mockImplementationOnce(function () { return legacy as unknown as DesktopAcpClient; });
    store.configs = [...store.configs, { ...store.configs[0], id: 'legacy', name: 'Older agent' }];
    store.statuses = { ...store.statuses, legacy: { ...store.statuses['agent-1'], agentId: 'legacy' } };
    await store.connectAgent('legacy');
    legacy.listSessions.mockClear();
    mockClient.listSessions.mockClear().mockResolvedValueOnce({ sessions: [listed('supported-result')] });
    await store.ensureSessionCatalog();
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['supported-result']);
    expect(store.sessionCatalogExcludedAgents).toEqual([{ id: 'legacy', name: 'Older agent' }]);
    expect(store.sessionCatalogSupportedAgentCount).toBe(1);
    expect(store.sessionCatalogError).toBeNull();
    expect(legacy.listSessions).not.toHaveBeenCalled();
    await store.ensureSessionCatalog();
    expect(mockClient.listSessions).toHaveBeenCalledOnce();
    mockClient.listSessions.mockRejectedValueOnce(new Error('Owner timed out'));
    await store.refreshSessionCatalog();
    expect(store.sessionCatalogError).toBe('QMTCODE: Owner timed out');
    expect(store.sessionCatalogExcludedAgents).toEqual([{ id: 'legacy', name: 'Older agent' }]);
    expect(store.sessionCatalog).toHaveLength(1);
  });

  it('does not let a slow old view overwrite a newer catalog', async () => {
    const store = await lifecycleStore();
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const old = store.refreshSessionCatalog({ resolution: 'open', archive: 'excluded' });
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('new-view')] });
    await store.refreshSessionCatalog({ resolution: 'any', archive: 'any' });
    release({ sessions: [listed('old-view')] });
    await old;
    expect(store.sessionCatalog.map((session) => session.sessionId)).toEqual(['new-view']);
    expect(store.sessionCatalogLoadedCount).toBe(1);
    expect(store.sessionCatalogLoading).toBe(false);
  });

  it('reports listing failures instead of presenting an unavailable owner as an empty success', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockRejectedValueOnce(new Error('Remote owner is offline'));
    await store.refreshSessionCatalog();
    expect(store.sessionCatalogError).toContain('QMTCODE: Remote owner is offline');
    expect(store.sessionCatalogLoading).toBe(false);
  });

  it('updates only the requested lifecycle field after persistence, without affecting execution or parents', async () => {
    const store = await lifecycleStore();
    const child = { ...summary(), parentSessionId: 'parent', lifecycle: { ...summary().lifecycle!, archived: true, archived_at: '2026-09-01T00:00:00Z' } };
    store.sessionsByAgent = { 'agent-1': [child, summary('parent')] };
    store.sessionCatalog = [child];
    store.activeSession.runState = 'thinking';
    const saved = { ...child.lifecycle!, resolved: true, resolved_at: '2026-10-18T00:00:00Z' };
    let release!: (value: typeof saved) => void;
    mockClient.setSessionLifecycle.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const write = store.setSessionLifecycle('agent-1', 'session-1', { resolved: true });
    expect(store.sessionsByAgent['agent-1'][0].lifecycle?.resolved).toBe(false);
    expect(store.sessionLifecyclePending['agent-1:session-1']).toBe(true);
    release(saved);
    await write;
    expect(mockClient.setSessionLifecycle).toHaveBeenCalledWith('session-1', { resolved: true });
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({ lifecycle: saved, updatedAt: child.updatedAt, status: 'thinking' });
    expect(store.sessionsByAgent['agent-1'][1].lifecycle?.resolved).toBe(false);
    expect(store.activeSession.runState).toBe('thinking');
    expect(mockClient.cancelSession).not.toHaveBeenCalled();
    expect(store.sessionLifecyclePending['agent-1:session-1']).toBe(false);
  });

  it('retains listed lifecycle, Open membership and menu controls on a failed read, then reconciles on retry', async () => {
    const store = await lifecycleStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('session-1')] });
    await store.ensureSessionCatalog();
    const known = store.sessions[0].lifecycle;
    const key = 'agent-1:session-1';
    mockClient.getSessionLifecycle.mockRejectedValueOnce(new RequestError(-32603, 'Internal error', 'Owner timed out'));
    await store.refreshSessionLifecycle('agent-1', 'session-1');
    expect(store.sessions[0].lifecycle).toEqual(known);
    expect(store.sessionCatalog[0].lifecycle).toEqual(known);
    expect(store.sessions.filter((session) => isRootSession(session) && sessionMatchesLifecycle(session.lifecycle,
      { resolution: 'open', archive: 'excluded' })).map((session) => session.sessionId)).toEqual(['session-1']);
    expect(store.sessionLifecycleErrors[key]).toBe('Owner timed out');

    try {
      const menu = render(SessionActionsMenu, { session: store.sessions[0], canManage: store.canSetSessionLifecycle('agent-1'),
        error: store.sessionLifecycleErrors[key], onSetLifecycle: vi.fn(async () => {}) });
      await fireEvent.click(screen.getByRole('button', { name: 'Session actions for session-1' }));
      expect(screen.getByRole('menuitem', { name: 'Mark resolved' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
      expect(screen.queryByText(/Lifecycle controls unavailable/)).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Owner timed out');

      const saved = { ...known!, resolved: true, resolved_at: '2026-10-20T16:00:00Z' };
      mockClient.getSessionLifecycle.mockResolvedValueOnce(saved);
      await store.refreshSessionLifecycle('agent-1', 'session-1');
      expect(store.sessions[0].lifecycle).toEqual(saved);
      expect(store.sessionCatalog[0].lifecycle).toEqual(saved);
      expect(store.sessionLifecycleErrors[key]).toBeNull();
      await menu.rerender({ session: store.sessions[0], error: store.sessionLifecycleErrors[key] });
      expect(screen.getByRole('menuitem', { name: 'Reopen' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { cleanup(); }
  });

  it('keeps unknown lifecycle out of Open on read failure without inventing state', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = { 'agent-1': [{ ...summary(), lifecycle: null }] };
    mockClient.getSessionLifecycle.mockRejectedValueOnce(new Error('Owner offline'));
    await store.refreshSessionLifecycle('agent-1', 'session-1');
    expect(store.sessions[0].lifecycle).toBeNull();
    expect(sessionMatchesLifecycle(store.sessions[0].lifecycle, { resolution: 'open', archive: 'excluded' })).toBe(false);
    expect(store.sessionLifecycleErrors['agent-1:session-1']).toBe('Owner offline');
  });

  it.each([
    ['success', 'success'], ['success', 'error'], ['error', 'success'], ['error', 'error']
  ] as const)('ignores an older lifecycle read %s after a newer read %s', async (older, newer) => {
    const store = await lifecycleStore();
    const known = summary().lifecycle!;
    store.sessionsByAgent = { 'agent-1': [summary()] };
    store.sessionCatalog = [summary()];
    let release!: (value: typeof known) => void;
    let reject!: (error: Error) => void;
    mockClient.getSessionLifecycle.mockImplementationOnce(() => new Promise((resolve, rejectRead) => { release = resolve; reject = rejectRead; }));
    const old = store.refreshSessionLifecycle('agent-1', 'session-1');
    const saved = { ...known, resolved: true, resolved_at: '2026-10-20T17:00:00Z' };
    if (newer === 'success') mockClient.getSessionLifecycle.mockResolvedValueOnce(saved);
    else mockClient.getSessionLifecycle.mockRejectedValueOnce(new Error('Latest read failed'));
    await store.refreshSessionLifecycle('agent-1', 'session-1');
    if (older === 'success') release(known);
    else reject(new Error('Obsolete read failed'));
    await old;
    expect(mockClient.getSessionLifecycle).toHaveBeenCalledTimes(2);
    expect(store.sessions[0].lifecycle).toEqual(newer === 'success' ? saved : known);
    expect(store.sessionCatalog[0].lifecycle).toEqual(newer === 'success' ? saved : known);
    expect(store.sessionLifecycleErrors['agent-1:session-1']).toBe(newer === 'success' ? null : 'Latest read failed');
  });

  it('owns lifecycle reads by both agent and session rather than globally', async () => {
    const store = await lifecycleStore();
    store.configs = [...store.configs, { ...store.configs[0], id: 'agent-2' }];
    await store.connectAgent('agent-2');
    store.sessionsByAgent = { 'agent-1': [summary(), summary('other')], 'agent-2': [{ ...summary(), agentId: 'agent-2' }] };
    const saved = { ...summary().lifecycle!, resolved: true };
    let release!: (value: typeof saved) => void;
    mockClient.getSessionLifecycle.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = store.refreshSessionLifecycle('agent-1', 'session-1');
    await store.refreshSessionLifecycle('agent-1', 'other');
    await store.refreshSessionLifecycle('agent-2', 'session-1');
    release(saved);
    await first;
    expect(store.sessionsByAgent['agent-1'][0].lifecycle).toEqual(saved);
    expect(store.sessionsByAgent['agent-1'][1].lifecycle?.resolved).toBe(false);
    expect(store.sessionsByAgent['agent-2'][0].lifecycle?.resolved).toBe(false);
  });

  it.each(['dispose', 'disconnect', 'delete'] as const)('retires pending lifecycle reads on %s', async (action) => {
    mockClient.connect.mockResolvedValueOnce({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { delete: {} } }, authMethods: [] });
    const store = await lifecycleStore();
    store.sessionsByAgent = { 'agent-1': [summary()] };
    const saved = { ...summary().lifecycle!, resolved: true };
    let release!: (value: typeof saved) => void;
    mockClient.getSessionLifecycle.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const read = store.refreshSessionLifecycle('agent-1', 'session-1');
    if (action === 'dispose') store.dispose();
    else if (action === 'disconnect') await store.stopConfiguredAgent('agent-1');
    else await store.deleteSession('agent-1', 'session-1');
    release(saved);
    await read;
    expect(store.sessionLifecycles['agent-1:session-1']).toBeUndefined();
    expect(store.sessionLifecycleErrors['agent-1:session-1']).toBeUndefined();
  });

  it('ignores a stale read failure after a newer successful lifecycle write', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = { 'agent-1': [summary()] };
    let reject!: (error: Error) => void;
    mockClient.getSessionLifecycle.mockImplementationOnce(() => new Promise((_resolve, rejectRead) => { reject = rejectRead; }));
    const refresh = store.refreshSessionLifecycle('agent-1', 'session-1');
    await store.setSessionLifecycle('agent-1', 'session-1', { resolved: true });
    reject(new Error('Obsolete timeout'));
    await refresh;
    expect(store.sessions[0].lifecycle?.resolved).toBe(true);
    expect(store.sessionLifecycleErrors['agent-1:session-1']).toBeNull();
  });

  it('keeps a failed mutation visible with an actionable error and allows retry', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = { 'agent-1': [summary()] };
    store.sessionCatalog = [summary()];
    mockClient.setSessionLifecycle.mockRejectedValueOnce(new Error('Owner refused update'));
    await expect(store.setSessionLifecycle('agent-1', 'session-1', { archived: true })).rejects.toThrow('Owner refused update');
    expect(store.sessionCatalog).toHaveLength(1);
    expect(store.sessionsByAgent['agent-1'][0].lifecycle?.archived).toBe(false);
    expect(store.sessionLifecycleErrors['agent-1:session-1']).toBe('Owner refused update');
    await store.setSessionLifecycle('agent-1', 'session-1', { archived: true });
    expect(store.sessionCatalog).toHaveLength(0);
  });

  it('protects a successful mutation from an older global list response', async () => {
    const store = await lifecycleStore();
    store.sessionsByAgent = { 'agent-1': [summary()] };
    let release!: (page: { sessions: SessionInfo[] }) => void;
    mockClient.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const refresh = store.refreshSessionsForAgent('agent-1');
    await vi.waitFor(() => expect(mockClient.listSessions).toHaveBeenCalled());
    await store.setSessionLifecycle('agent-1', 'session-1', { resolved: true });
    release({ sessions: [listed('session-1')] });
    await refresh;
    expect(store.sessionsByAgent['agent-1'][0].lifecycle?.resolved).toBe(true);
  });
});

describe('AgentsStore connections', () => {
  it('keeps a selected workspace peer visible as the target when it goes offline', () => {
    const store = createStore();
    store.setComposerAgent('agent-1');
    store.setComposerTarget('peer-offline');
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'remote-1', title: 'Remote task',
        cwd: '/remote/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
        source: 'acp', location: 'remote', remoteNodeId: 'peer-offline',
        remoteNodeLabel: 'Laptop', status: 'idle'
      } satisfies DesktopSessionSummary]
    };

    expect(store.getTargetOptions('agent-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'peer-offline', label: 'Laptop' })
    ]));
    expect(store.getTargetOptions(null).map((target) => target.id)).toEqual(['local']);
  });

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

  it('completes session hydration when runtime refresh fails', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
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
      }]
    };
    mockClient.getSessionRuntimeStatus.mockRejectedValueOnce(new Error('runtime unavailable'));
    await store.connectAgent('agent-1');

    await store.loadSession('agent-1', 'session-1');

    expect(mockClient.getUndoStack).toHaveBeenCalledWith('session-1');
    expect(store.activeSession.runState).toBe('unknown');
    expect(store.activeSession.lastError).toBeNull();
    expect(store.error).toBeNull();
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

    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.loadSession).toHaveBeenCalledWith('session-child', '');
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

    expect(mockClient.listSessions).not.toHaveBeenCalled();
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

  it('loads a bookmarked remote deep link without scanning the session catalog', async () => {
    const store = createStore();
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: [], _meta: {
        location: 'remote', nodeId: 'node-1', nodeLabel: 'Laptop',
        cwd: '/remote/work', title: 'Remote task',
        'querymt/sessionLoadSnapshot.v1': { audit: { events: [
          { seq: 1, timestamp: 1, kind: { type: 'prompt_received', data: { message_id: 'm1', content: 'Remote prompt' } } }
        ] } }
      } }, replay: []
    });

    await store.loadSession('agent-1', 'remote-session-1');
    expect(mockClient.loadSession).toHaveBeenCalledWith('remote-session-1', '');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.attachRemoteSession).not.toHaveBeenCalled();
    expect(store.sessionsByAgent['agent-1']).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'remote-session-1', location: 'remote', remoteNodeId: 'node-1', cwd: '/remote/work' })
    ]));
    expect(store.activeSession.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Remote prompt' })
    ]));

    await store.loadSession('agent-1', 'remote-session-1');
    expect(mockClient.loadSession).toHaveBeenCalledTimes(2);
    expect(mockClient.attachRemoteSession).not.toHaveBeenCalled();
  });

  it.each([
    { responseTitle: null, expectedTitle: 'Catalog title' },
    { responseTitle: 'Response title', expectedTitle: 'Response title' }
  ])('keeps the right remote title when discovery finishes during load ($expectedTitle)', async ({ responseTitle, expectedTitle }) => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    await store.connectAgent('agent-1');

    let resolveLoad!: (value: {
      response: { configOptions: SessionConfigOption[]; _meta?: Record<string, unknown> };
      replay: SessionNotification[];
    }) => void;
    mockClient.loadSession.mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const loading = store.loadSession('agent-1', 'remote-session-1');
    await vi.waitFor(() => expect(mockClient.loadSession).toHaveBeenCalledWith('remote-session-1', ''));

    mockClient.listSessions.mockResolvedValueOnce({ sessions: [{
      sessionId: 'remote-session-1', title: 'Catalog title', cwd: '/remote/work',
      _meta: { location: 'remote', nodeId: 'node-1' }
    }] });
    await store.refreshSessionsForAgent('agent-1', true);
    expect(store.sessionsByAgent['agent-1'][0].title).toBe('Catalog title');

    resolveLoad({ response: { configOptions: [], _meta: {
      location: 'remote', nodeId: 'node-1', title: responseTitle, cwd: '/remote/work'
    } }, replay: [] });
    await loading;

    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({
      title: expectedTitle, location: 'remote', remoteNodeId: 'node-1'
    });
    expect(store.workspaceSessionGroupsForLocation('remote')[0].sessions[0].title).toBe(expectedTitle);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    expect(mockClient.attachRemoteSession).not.toHaveBeenCalled();
  });

  it('uses the owner profile from remote load metadata without inventing local config options', async () => {
    const store = createStore();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      location: 'remote', nodeId: 'node-1', profileId: 'owner-profile', profileLabel: 'Owner Profile'
    } }, replay: [] });

    await store.loadSession('agent-1', 'remote-session-1');
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({
      remoteProfileId: 'owner-profile', remoteProfileLabel: 'Owner Profile'
    });
    expect(store.activeSession.configOptions).toEqual([]);
    expect(store.getProfileOptions().some((option) => option.id === 'owner-profile')).toBe(false);
  });

  it('clears a stale remote profile when the owner reports no binding', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'remote-session-1', title: 'Remote task',
      cwd: '/remote', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
      source: 'acp', location: 'remote', remoteNodeId: 'node-1',
      remoteProfileId: 'stale', remoteProfileLabel: 'Stale', status: 'idle'
    }] };
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      location: 'remote', nodeId: 'node-1', profileId: null, profileLabel: null
    } }, replay: [] });

    await store.loadSession('agent-1', 'remote-session-1');
    expect(store.sessionsByAgent['agent-1'][0].remoteProfileId).toBeUndefined();
    expect(store.sessionsByAgent['agent-1'][0].remoteProfileLabel).toBeUndefined();
  });

  it('does not reuse an old profile label when the owner reports a different ID', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'remote-session-1', title: 'Remote task',
      cwd: '/remote', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
      source: 'acp', location: 'remote', remoteNodeId: 'node-1',
      remoteProfileId: 'old', remoteProfileLabel: 'Old Profile', status: 'idle'
    }] };
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      location: 'remote', nodeId: 'node-1', profileId: 'new'
    } }, replay: [] });

    await store.loadSession('agent-1', 'remote-session-1');
    expect(store.sessionsByAgent['agent-1'][0].remoteProfileId).toBe('new');
    expect(store.sessionsByAgent['agent-1'][0].remoteProfileLabel).toBeUndefined();
  });

  it('uses the owner profile from remote attach without local profile options', async () => {
    const store = createStore();
    mockClient.attachRemoteSession.mockResolvedValueOnce({
      session_id: 'remote-session-1', node_id: 'node-1', attached: true,
      config_options: [], profile_id: 'owner-profile', profile_label: 'Owner Profile',
      snapshot: { audit: { events: [{ seq: 1, timestamp: 1, kind: { type: 'prompt_received', data: {
        message_id: 'm1', content: 'Review deployment'
      } } }] } }
    });

    await store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({
      remoteProfileId: 'owner-profile', remoteProfileLabel: 'Owner Profile'
    });
    expect(store.activeSession.configOptions).toEqual([]);
  });

  it.each(['fallback', 'explicit'] as const)('ignores a delayed %s attach after navigating to another session', async (kind) => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.remoteSessionsByAgent = { 'agent-1': { 'node-1': {
      node_id: 'node-1', total_count: 1,
      sessions: [{ id: 'remote-session-1', node_id: 'node-1', cwd: '/remote' }]
    } } };
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    let resolveAttach!: (value: RemoteSessionAttachInfo) => void;
    mockClient.attachRemoteSession.mockImplementationOnce(() => new Promise((resolve) => { resolveAttach = resolve; }));
    if (kind === 'fallback') {
      mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { message: 'session not found' }));
    }
    const attaching = kind === 'fallback'
      ? store.loadSession('agent-1', 'remote-session-1')
      : store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    await vi.waitFor(() => expect(mockClient.attachRemoteSession).toHaveBeenCalled());
    await store.loadSession('agent-1', 'local-session-2');
    const selected = store.activeSession;
    resolveAttach({
      session_id: 'remote-session-1', node_id: 'node-1', attached: true,
      config_options: [], snapshot: { audit: { events: [] } }
    });
    await attaching;
    expect(store.activeSessionId).toBe('local-session-2');
    expect(store.activeSession).toBe(selected);
    expect(store.lastRemoteAttachByAgent['agent-1']).toBeUndefined();
    store.setComposerPrompt('Stay on the selected host');
    await store.sendPromptToActiveSession();
    expect(mockClient.sendPrompt).toHaveBeenCalledWith('local-session-2', 'Stay on the selected host', [], expect.any(Object));
  });

  it('does not let an older load failure or cleanup change a newer pending load', async () => {
    const store = createStore();
    let rejectOlder!: (error: Error) => void;
    let resolveNewer!: (value: { response: { configOptions: SessionConfigOption[] }; replay: SessionNotification[] }) => void;
    mockClient.loadSession
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOlder = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; }));
    const older = store.loadSession('agent-1', 'older');
    await vi.waitFor(() => expect(mockClient.loadSession).toHaveBeenCalledTimes(1));
    const newer = store.loadSession('agent-1', 'newer');
    await vi.waitFor(() => expect(mockClient.loadSession).toHaveBeenCalledTimes(2));
    rejectOlder(new Error('Old session unavailable'));
    await older;
    expect(store.activeSessionId).toBe('newer');
    expect(store.activeSession.runState).toBe('thinking');
    expect(store.activeSession.lastError).toBeNull();
    expect(store.sessionHistoryLoading).toBe(true);
    expect(store.error).toBeNull();
    resolveNewer({ response: { configOptions: [] }, replay: [] });
    await newer;
    expect(store.sessionHistoryLoading).toBe(false);
  });

  it('clears history loading when an explicit attach supersedes a pending load', async () => {
    const store = createStore();
    let resolveLoad!: (value: { response: { configOptions: SessionConfigOption[] }; replay: SessionNotification[] }) => void;
    mockClient.loadSession.mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const loading = store.loadSession('agent-1', 'local-session-2');
    await vi.waitFor(() => expect(mockClient.loadSession).toHaveBeenCalled());
    expect(store.sessionHistoryLoading).toBe(true);
    await store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    expect(store.activeSessionId).toBe('remote-session-1');
    expect(store.sessionHistoryLoading).toBe(false);
    resolveLoad({ response: { configOptions: [] }, replay: [] });
    await loading;
    expect(store.activeSessionId).toBe('remote-session-1');
    expect(store.sessionHistoryLoading).toBe(false);
  });

  it.each(['connection', 'rpc', 'identity'] as const)('clears loading after an explicit attach fails during %s', async (failure) => {
    const store = createStore();
    let resolveLoad!: (value: { response: { configOptions: SessionConfigOption[] }; replay: SessionNotification[] }) => void;
    mockClient.loadSession.mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const loading = store.loadSession('agent-1', 'local-session-2');
    await vi.waitFor(() => expect(mockClient.loadSession).toHaveBeenCalled());
    if (failure === 'connection') {
      vi.spyOn(store as unknown as { connectInitializedRecord(): Promise<undefined> }, 'connectInitializedRecord')
        .mockResolvedValueOnce(undefined);
    } else if (failure === 'rpc') {
      mockClient.attachRemoteSession.mockRejectedValueOnce(new Error('Attach unavailable'));
    } else {
      mockClient.attachRemoteSession.mockResolvedValueOnce({ session_id: 'wrong-session', node_id: 'node-1', attached: true,
        config_options: [], snapshot: { audit: { events: [] } } });
    }
    await expect(store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1')).rejects.toThrow();
    expect(store.activeSessionId).toBe('local-session-2');
    expect(store.sessionHistoryLoading).toBe(false);
    resolveLoad({ response: { configOptions: [] }, replay: [] });
    await loading;
    expect(store.sessionHistoryLoading).toBe(false);
  });

  it('does not clear a newer pending load when an older explicit attach fails', async () => {
    const store = createStore();
    let rejectAttach!: (error: Error) => void;
    let resolveLoad!: (value: { response: { configOptions: SessionConfigOption[] }; replay: SessionNotification[] }) => void;
    mockClient.attachRemoteSession.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectAttach = reject; }));
    const attaching = store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    await vi.waitFor(() => expect(mockClient.attachRemoteSession).toHaveBeenCalled());
    mockClient.loadSession.mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const loading = store.loadSession('agent-1', 'local-session-2');
    await vi.waitFor(() => expect(mockClient.loadSession).toHaveBeenCalled());
    rejectAttach(new Error('Late attach failure'));
    await expect(attaching).rejects.toThrow('Late attach failure');
    expect(store.sessionHistoryLoading).toBe(true);
    expect(store.activeSessionId).toBe('local-session-2');
    resolveLoad({ response: { configOptions: [] }, replay: [] });
    await loading;
    expect(store.sessionHistoryLoading).toBe(false);
  });

  it('leaves fallback attachment failure cleanup to the initiating load', async () => {
    const store = createStore();
    store.remoteSessionsByAgent = { 'agent-1': { 'node-1': {
      node_id: 'node-1', total_count: 1, sessions: [{ id: 'remote-session-1', node_id: 'node-1' }]
    } } };
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { message: 'session not found' }));
    mockClient.attachRemoteSession.mockRejectedValueOnce(new Error('Owner offline'));
    const attach = store.attachRemoteSession.bind(store);
    vi.spyOn(store, 'attachRemoteSession').mockImplementationOnce(async (...args) => {
      try { return await attach(...args); }
      finally { expect(store.sessionHistoryLoading).toBe(true); }
    });
    await store.loadSession('agent-1', 'remote-session-1');
    expect(store.activeSession.lastError).toBe('Owner offline');
    expect(store.sessionHistoryLoading).toBe(false);
  });

  it('ignores an older attach when navigating away and back to the same remote session', async () => {
    const store = createStore();
    let resolveAttach!: (value: RemoteSessionAttachInfo) => void;
    mockClient.attachRemoteSession.mockImplementationOnce(() => new Promise((resolve) => { resolveAttach = resolve; }));
    const attaching = store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    await vi.waitFor(() => expect(mockClient.attachRemoteSession).toHaveBeenCalled());
    await store.loadSession('agent-1', 'local-session-2');
    await store.loadSession('agent-1', 'remote-session-1');
    const selected = store.activeSession;
    resolveAttach({ session_id: 'remote-session-1', node_id: 'node-1', attached: true,
      config_options: [], snapshot: { audit: { events: [] } } });
    await attaching;
    expect(store.activeSessionId).toBe('remote-session-1');
    expect(store.activeSession).toBe(selected);
  });

  it('keeps a newer snapshot when an older load for the same session completes last', async () => {
    const store = createStore();
    let resolveLoad!: (value: { response: { configOptions: SessionConfigOption[] }; replay: SessionNotification[] }) => void;
    mockClient.loadSession.mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const older = store.loadSession('agent-1', 'remote-session-1');
    await vi.waitFor(() => expect(mockClient.loadSession).toHaveBeenCalledTimes(1));
    await store.loadSession('agent-1', 'local-session-2');
    await store.loadSession('agent-1', 'remote-session-1');
    const selected = store.activeSession;
    resolveLoad({ response: { configOptions: [] }, replay: [] });
    await older;
    expect(store.activeSession).toBe(selected);
    expect(store.activeSessionId).toBe('remote-session-1');
  });

  it.each([
    { session_id: 'unexpected-session', node_id: 'node-1' },
    { session_id: 'remote-session-1', node_id: 'unexpected-node' }
  ])('rejects an attach response with mismatched identity ($session_id / $node_id)', async (identity) => {
    const store = createStore();
    await store.loadSession('agent-1', 'local-session-2');
    const selected = store.activeSession;
    mockClient.attachRemoteSession.mockResolvedValueOnce({ ...identity, attached: true,
      config_options: [], snapshot: { audit: { events: [] } } });
    await expect(store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1'))
      .rejects.toThrow('Remote attachment identity does not match the requested session.');
    expect(store.activeSession).toBe(selected);
    expect(store.activeSessionId).toBe('local-session-2');
    expect(store.lastRemoteAttachByAgent['agent-1']).toBeUndefined();
  });

  it.each(['fallback', 'explicit'] as const)('keeps a successful %s attachment usable when catalog refresh fails', async (kind) => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.remoteSessionsByAgent = { 'agent-1': { 'node-1': {
      node_id: 'node-1', total_count: 1, sessions: [{ id: 'remote-session-1', node_id: 'node-1' }]
    } } };
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    if (kind === 'fallback') {
      mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { message: 'session not found' }));
    }
    mockClient.attachRemoteSession.mockResolvedValueOnce({
      session_id: 'remote-session-1', node_id: 'node-1', attached: true, config_options: [],
      snapshot: { audit: { events: [{ seq: 1, timestamp: 1, kind: { type: 'prompt_received', data: {
        message_id: 'm1', content: 'Usable owner snapshot'
      } } }] } }
    });
    const refreshError = new Error('Catalog unavailable');
    mockClient.listRemoteSessions.mockRejectedValueOnce(refreshError);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const attaching = kind === 'fallback'
        ? store.loadSession('agent-1', 'remote-session-1')
        : store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
      await expect(attaching).resolves.toBe(kind === 'fallback' ? undefined : 'remote-session-1');
      expect(store.activeSessionId).toBe('remote-session-1');
      expect(store.activeSession.runState).not.toBe('failed');
      expect(store.activeSession.lastError).toBeNull();
      expect(store.error).toBeNull();
      expect(store.activeSession.transcript).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: 'Usable owner snapshot' })
      ]));
      expect(warn).toHaveBeenCalledWith('Remote session attached, but catalog refresh failed', refreshError);
      await store.loadSession('agent-1', 'remote-session-1');
      expect(mockClient.loadSession).toHaveBeenCalledTimes(kind === 'fallback' ? 1 : 0);
      expect(store.activeSession.lastError).toBeNull();
      mockClient.listRemoteSessions.mockResolvedValueOnce({ node_id: 'node-1', total_count: 0, sessions: [] });
      await store.refreshRemoteSessionsForAgent('agent-1', 'node-1');
      expect(store.remoteSessionsByAgent['agent-1']['node-1']?.sessions).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('shows the owner mode on remote load and updates it from a confirmed write and reload', async () => {
    const store = createStore();
    const modeOption = (mode: string): SessionConfigOption => ({
      id: 'mode', name: 'Session Mode', type: 'select', currentValue: mode,
      options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }, { value: 'review', name: 'Review' }]
    });
    mockClient.loadSession.mockResolvedValueOnce({ response: {
      configOptions: [modeOption('plan')], _meta: { location: 'remote', nodeId: 'node-1' }
    }, replay: [] });

    await store.loadSession('agent-1', 'remote-session-1');
    expect(store.activeSession.configOptions).toEqual([modeOption('plan')]);
    expect(store.getSessionModeId('agent-1', 'remote-session-1')).toBe('plan');

    mockClient.setSessionConfigOption.mockResolvedValueOnce([modeOption('review')]);
    await store.setActiveSessionConfigOption('mode', 'review');
    expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'remote-session-1', configId: 'mode', value: 'review'
    }));
    expect(store.getSessionModeId('agent-1', 'remote-session-1')).toBe('review');

    mockClient.loadSession.mockResolvedValueOnce({ response: {
      configOptions: [modeOption('review')], _meta: { location: 'remote', nodeId: 'node-1' }
    }, replay: [] });
    await store.loadSession('agent-1', 'remote-session-1');
    expect(store.activeSession.configOptions).toEqual([modeOption('review')]);
    expect(store.getSessionModeId('agent-1', 'remote-session-1')).toBe('review');
  });

  it('shows the confirmed owner mode after remote attach', async () => {
    const store = createStore();
    const modeOption: SessionConfigOption = {
      id: 'mode', name: 'Session Mode', type: 'select', currentValue: 'plan',
      options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]
    };
    mockClient.attachRemoteSession.mockResolvedValueOnce({
      session_id: 'remote-session-1', node_id: 'node-1', attached: true,
      config_options: [modeOption], snapshot: { audit: { events: [] } }
    });

    await store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    expect(store.activeSession.configOptions).toEqual([modeOption]);
    expect(store.getSessionModeId('agent-1', 'remote-session-1')).toBe('plan');
  });

  it('loads an unknown local deep link without remote discovery even when peers are selected', async () => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    await store.loadSession('agent-1', 'local-session-1');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.loadSession).toHaveBeenCalled();
    expect(store.sessionsByAgent['agent-1']).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'local-session-1', location: 'local' })
    ]));
  });

  it('does not scan remote peers after a known local session is missing', async () => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    store.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'local-session-1', title: 'Local task',
      cwd: '/tmp/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
      source: 'acp', location: 'local', status: 'idle'
    }] };
    mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { message: 'session not found' }));

    await store.loadSession('agent-1', 'local-session-1');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.attachRemoteSession).not.toHaveBeenCalled();
    expect(store.sessionsByAgent['agent-1'][0].location).toBe('local');
    expect(store.activeSession.lastError).toBe('Invalid params');
  });

  it('uses an explicit local load result over stale remote catalog metadata', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Task',
      cwd: '/tmp/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
      source: 'acp', location: 'remote', remoteNodeId: 'node-1', status: 'idle'
    }] };
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: { location: 'local' } }, replay: [] });

    await store.loadSession('agent-1', 'session-1');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.attachRemoteSession).not.toHaveBeenCalled();
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({ location: 'local', remoteNodeId: undefined });
  });

  it('moves a corrected local session out of its stale remote workspace', async () => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [{
      sessionId: 'session-1', title: 'Remote task', cwd: '/remote',
      _meta: { location: 'remote', nodeId: 'node-1' }
    }] });
    await store.refreshSessionsForAgent('agent-1', true);
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      location: 'local', title: 'Local task', cwd: '/local'
    } }, replay: [] });

    await store.loadSession('agent-1', 'session-1');
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({ location: 'local', cwd: '/local', title: 'Local task' });
    expect(store.workspaceSessionGroupsForLocation('remote')).toEqual([]);
    expect(store.workspaceSessionGroupsForLocation('local')).toEqual(expect.arrayContaining([
      expect.objectContaining({ cwd: '/local' })
    ]));
  });

  it('uses the direct load metadata to correct a stale local catalog entry', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Local task',
      cwd: '/local', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
      source: 'acp', location: 'local', status: 'idle'
    }] };
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      location: 'remote', nodeId: 'node-1', nodeLabel: 'Laptop', title: 'Remote task', cwd: '/remote'
    } }, replay: [] });

    await store.loadSession('agent-1', 'session-1');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.attachRemoteSession).not.toHaveBeenCalled();
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({
      location: 'remote', remoteNodeId: 'node-1', title: 'Remote task', cwd: '/remote'
    });
  });

  it('does not turn an offline remote into a local session or scan peers', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'remote-session-1', title: 'Remote task',
      cwd: '/remote/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
      source: 'acp', location: 'remote', remoteNodeId: 'node-1', status: 'idle'
    }] };
    mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32603, 'Remote node unavailable', {
      category: 'remote_session_connect', code: 'node_unavailable'
    }));

    await store.loadSession('agent-1', 'remote-session-1');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.attachRemoteSession).not.toHaveBeenCalled();
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({ location: 'remote', remoteNodeId: 'node-1' });
    expect(store.activeSession.lastError).toBe('Remote node unavailable');
  });

  it('discovers an unbookmarked remote only after the direct load reports it missing', async () => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { message: 'session not found' }));
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [{
      sessionId: 'remote-session-1', title: 'Remote task', cwd: '/remote/work',
      _meta: { location: 'remote', nodeId: 'node-1', nodeLabel: 'Laptop' }
    }] });

    await store.loadSession('agent-1', 'remote-session-1');
    expect(mockClient.loadSession).toHaveBeenCalledTimes(1);
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    expect(mockClient.loadSession.mock.invocationCallOrder[0]).toBeLessThan(mockClient.listSessions.mock.invocationCallOrder[0]);
    expect(mockClient.listSessions.mock.invocationCallOrder[0]).toBeLessThan(mockClient.attachRemoteSession.mock.invocationCallOrder[0]);
    expect(mockClient.attachRemoteSession).toHaveBeenCalledWith({ node_id: 'node-1', session_id: 'remote-session-1' });
  });

  it('stops remote discovery at the matching page without loading the full catalog or models', async () => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { message: 'session not found' }));
    mockClient.listSessions
      .mockResolvedValueOnce({ sessions: [{ sessionId: 'remote-session-1', title: 'Local collision', cwd: '/local' }], nextCursor: 'next' })
      .mockResolvedValueOnce({ sessions: [{ sessionId: 'remote-session-1', title: 'Remote task', cwd: '/remote',
        _meta: { location: 'remote', nodeId: 'node-1' } }], nextCursor: 'more' });

    await store.connectAgent('agent-1');
    mockClient.listModels.mockClear();
    await store.loadSession('agent-1', 'remote-session-1');
    expect(mockClient.listSessions).toHaveBeenCalledTimes(2);
    expect(mockClient.listSessions).toHaveBeenNthCalledWith(2, { _meta: { session_scope: 'all', remoteNodeIds: ['node-1'] }, cursor: 'next' });
    expect(mockClient.attachRemoteSession).toHaveBeenCalledWith({ node_id: 'node-1', session_id: 'remote-session-1' });
    expect(mockClient.listModels).not.toHaveBeenCalled();
    expect(store.sessionsByAgent['agent-1']).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'remote-session-1', location: 'remote', remoteNodeId: 'node-1', cwd: '/remote' })
    ]));
  });

  it.each(['deep link', 'live parent', 'historical parent'])('loads an undiscovered remote delegate from a %s through the existing attach path', async (source) => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    if (source !== 'deep link') {
      mockClient.listSessions.mockResolvedValueOnce({ sessions: [{
        sessionId: 'root', title: 'Parent task', cwd: '/remote',
        _meta: { location: 'remote', nodeId: 'node-1' }
      }] });
      await store.refreshSessionsForAgent('agent-1', true);
      expect(mockClient.listSessions).toHaveBeenCalledWith({
        _meta: { session_scope: 'root', remoteNodeIds: ['node-1'] }
      });
      mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
        location: 'remote', nodeId: 'node-1',
        ...(source === 'historical parent' ? { 'querymt/sessionLoadSnapshot.v1': { audit: { events: [
          { seq: 1, kind: { type: 'tool_call_start', data: { tool_call_id: 'delegate-1', tool_name: 'delegate', arguments: '{}' } } },
          { seq: 2, kind: { type: 'session_forked', data: { parent_session_id: 'root', child_session_id: 'remote-session-1', tool_call_id: 'delegate-1', origin: 'delegation' } } }
        ] } } } : {})
      } }, replay: [] });
      await store.loadSession('agent-1', 'root');
      if (source === 'live parent') mockClient.emitExtensionNotification({
        method: 'querymt/session/delegationUpdate',
        params: { sessionId: 'root', childSessionId: 'remote-session-1', toolCallId: 'delegate-1' }
      });
    }
    mockClient.listSessions.mockClear();
    mockClient.loadSession.mockClear();
    mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', {
      message: 'Session has no profile binding'
    }));
    mockClient.listSessions.mockImplementationOnce(async (request) => ({ sessions: request?._meta?.session_scope === 'all' ? [{
      sessionId: 'remote-session-1', title: 'Delegate task', cwd: '/remote',
      _meta: { location: 'remote', nodeId: 'node-1', parentSessionId: 'root', forkOrigin: 'delegation' }
    }, {
      sessionId: 'unrelated-child', cwd: '/remote',
      _meta: { location: 'remote', nodeId: 'node-1', parentSessionId: 'other-root', forkOrigin: 'delegation' }
    }] : [] }));

    await store.loadSession('agent-1', 'remote-session-1');

    expect(mockClient.listSessions).toHaveBeenCalledExactlyOnceWith({
      _meta: { session_scope: 'all', remoteNodeIds: ['node-1'] }
    });
    expect(mockClient.attachRemoteSession).toHaveBeenCalledExactlyOnceWith({ node_id: 'node-1', session_id: 'remote-session-1' });
    expect(mockClient.loadSession).toHaveBeenCalledTimes(1);
    expect(store.activeSessionId).toBe('remote-session-1');
    expect(store.activeSession.lastError).toBeNull();
    expect(store.activeSession.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'user_message_chunk', text: 'Review deployment' })
    ]));
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'remote-session-1'))
      .toMatchObject({ location: 'remote', remoteNodeId: 'node-1', parentSessionId: 'root', forkOrigin: 'delegation' });
    expect(store.sessionsByAgent['agent-1'].some((session) => session.sessionId === 'unrelated-child')).toBe(false);
    expect(store.sessions.filter(isRootSession).map((session) => session.sessionId)).toEqual(source === 'deep link' ? [] : ['root']);
  });

  it('uses a cached remote listing before making another catalog request', async () => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    store.remoteSessionsByAgent = { 'agent-1': { 'node-1': {
      node_id: 'node-1', total_count: 1,
      sessions: [{ id: 'remote-session-1', node_id: 'node-1', title: 'Cached task', cwd: '/remote' }]
    } } };
    mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { message: 'session not found' }));

    await store.loadSession('agent-1', 'remote-session-1');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    expect(mockClient.attachRemoteSession).toHaveBeenCalledWith({ node_id: 'node-1', session_id: 'remote-session-1' });
  });

  it('discovers selected remote sessions and attaches only when direct load finds no bookmark', async () => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
    mockClient.listSessions.mockResolvedValueOnce({
      sessions: [{
        sessionId: 'remote-session-1', title: 'Review deployment', cwd: '/srv/app',
        updatedAt: '2026-07-29T22:30:00Z',
        _meta: { location: 'remote', nodeId: 'node-1', nodeLabel: 'Laptop', connectionState: 'available' }
      }]
    });

    await store.refreshSessionsForAgent('agent-1', true);
    expect(mockClient.listSessions).toHaveBeenCalledWith({
      _meta: { session_scope: 'root', remoteNodeIds: ['node-1'] }
    });
    expect(store.workspaceSessionGroupsForLocation('remote')).toEqual(expect.arrayContaining([
      expect.objectContaining({ cwd: '/srv/app', location: 'remote' })
    ]));
    expect(store.workspaceSessionGroupsForLocation('local')).toEqual([]);
    mockClient.loadSession.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { message: 'session not found' }));
    await store.loadSession('agent-1', 'remote-session-1');
    expect(mockClient.loadSession).toHaveBeenCalledWith('remote-session-1', '/srv/app');
    expect(mockClient.listSessions).toHaveBeenCalledTimes(1);
    expect(mockClient.loadSession.mock.invocationCallOrder[0]).toBeLessThan(mockClient.attachRemoteSession.mock.invocationCallOrder[0]);
    expect(mockClient.attachRemoteSession).toHaveBeenCalledWith({ node_id: 'node-1', session_id: 'remote-session-1' });
  });

  it('hydrates and activates an attached remote session without reloading it immediately', async () => {
    const store = createStore();
    chatPreferencesStore.setShowRemoteSessions(true);
    chatPreferencesStore.setRemoteSessionPeer('node-1', true);
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
    store.setLaunchModel('agent-1', 'launch-only');
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
    expect(store.getLaunchModelId('agent-1')).toBe('launch-only');
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

  it('uses owner model identity on remote reload and live changes, independently of reasoning patches', async () => {
    const store = createStore();
    store.configs = store.configs.map((config) => ({ ...config, name: 'qmtcode' }));
    const local = { id: 'codex/test', provider: 'codex', model: 'test', label: 'Test' };
    const remote = { ...local, node_id: 'B', node_label: 'Machine B' };
    const servingNode = '12D3KooWQmtLocalAgentPeer00000000000000';
    store.modelsByAgent = { 'agent-1': [local, remote] };
    const modelOption = (node: string | null): SessionConfigOption => ({
      id: 'model', name: 'Model', type: 'select', currentValue: local.id,
      options: [{ value: local.id, name: local.label }],
      _meta: { querymt: { modelEntry: { ...local, node_id: node } } }
    });
    const reasoning: SessionConfigOption = {
      id: 'reasoning_effort', name: 'Reasoning Effort', type: 'select', currentValue: 'max',
      options: [{ value: 'max', name: 'Max' }]
    };
    let node: string | null = null;
    mockClient.loadSession.mockImplementation(async () => ({
      response: {
        configOptions: [modelOption(node), reasoning],
        _meta: { location: 'remote', nodeId: 'B', nodeLabel: 'Machine B' }
      }, replay: []
    }));
    await store.loadSession('agent-1', 'session-1');
    expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(remote));
    expect(store.getSessionModelLocation('agent-1', 'session-1')).toEqual({
      servingNodeId: servingNode, ownerNodeId: 'B', servingNodeLabel: 'lstr'
    });
    expect(store.activeSession.configOptions).toContainEqual(reasoning);
    node = servingNode;
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'config_option_update', configOptions: [modelOption(node)]
    } });
    expect(store.getSessionModelId('agent-1', 'session-1')).toBe(local.id);
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'config_option_update', configOptions: [{ ...reasoning, currentValue: 'auto' }]
    } });
    expect(store.getSessionModelId('agent-1', 'session-1')).toBe(local.id);
    await store.loadSession('agent-1', 'session-1');
    expect(store.getSessionModelId('agent-1', 'session-1')).toBe(local.id);
    mockClient.attachRemoteSession.mockResolvedValueOnce({
      session_id: 'attached-remote', node_id: 'B', attached: true,
      config_options: [modelOption(null), reasoning], snapshot: { audit: { events: [] } }
    });
    await store.attachRemoteSession('agent-1', 'B', 'attached-remote');
    expect(store.getSessionModelId('agent-1', 'attached-remote')).toBe(getModelSelectionKey(remote));
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it('re-resolves confirmed identity when serving-node metadata arrives after session load', async () => {
    const store = createStore();
    const local = { id: 'codex/test', provider: 'codex', model: 'test', label: 'Test' };
    store.modelsByAgent = { 'agent-1': [local] };
    let finishStatus!: (value: MeshStatusInfo) => void;
    mockClient.listMeshStatus.mockImplementationOnce(() => new Promise((resolve) => { finishStatus = resolve; }));
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [{
      id: 'model', name: 'Model', type: 'select', currentValue: local.id,
      options: [{ value: local.id, name: local.label }],
      _meta: { querymt: { modelEntry: { ...local, node_id: 'A' } } }
    }] }, replay: [] });
    await store.loadSession('agent-1', 'session-1');
    expect(store.getSessionModelId('agent-1', 'session-1')).not.toBe(local.id);
    finishStatus({ enabled: true, peer_id: 'A', known_peer_count: 0, has_invite_store: true, has_mesh_state_store: true, scopes: [] });
    await vi.waitFor(() => expect(store.getSessionModelId('agent-1', 'session-1')).toBe(local.id));
    expect(store.getSessionModelLocation('agent-1', 'session-1').servingNodeLabel).toBeUndefined();
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it.each(['catalog', 'mesh'])('keeps acknowledged legacy model writes across %s refreshes', async (refresh) => {
    const store = createStore();
    const local: ModelEntry = { id: 'codex/test', provider: 'codex', model: 'test', label: 'Test' };
    const remote: ModelEntry = { ...local, node_id: 'B', node_label: 'flkr' };
    const different: ModelEntry = { id: 'codex/other', provider: 'codex', model: 'other' };
    const models = [local, remote, different];
    store.modelsByAgent = { 'agent-1': models };
    const mode: SessionConfigOption = {
      id: 'mode', name: 'Mode', type: 'select', currentValue: 'build', options: [{ value: 'build', name: 'Build' }]
    };
    for (const [previous, selected] of [[remote, local], [local, remote], [remote, different]]) {
      for (const response of [[], [mode]]) {
        mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [{
          id: 'model', name: 'Model', type: 'select', currentValue: previous.id,
          options: [local, different].map((model) => ({ value: model.id, name: model.model })),
          _meta: { other: 'preserved', querymt: { modelEntry: previous, other: 'preserved' } }
        }, mode] }, replay: [] });
        await store.loadSession('agent-1', 'session-1');
        await store.refreshMeshForAgent('agent-1');
        expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(previous));
        mockClient.setSessionConfigOption.mockResolvedValueOnce(response);
        await store.setSessionModel('agent-1', 'session-1', getModelSelectionKey(selected));
        expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(selected));
        expect(store.activeSession.configOptions.find((option) => option.id === 'model')).toMatchObject({
          currentValue: selected.id, _meta: { other: 'preserved', querymt: { other: 'preserved' } }
        });
        if (refresh === 'catalog') {
          mockClient.refreshAndListModels.mockResolvedValueOnce(models);
          await store.refreshModelsForAgent('agent-1');
        } else {
          await store.refreshMeshForAgent('agent-1');
        }
        expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(selected));
        expect(store.activeSession.configOptions).toContainEqual(mode);
        mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
          sessionUpdate: 'config_option_update', configOptions: [{
            id: 'model', name: 'Model', type: 'select', currentValue: previous.id,
            options: [{ value: previous.id, name: previous.model }],
            _meta: { querymt: { modelEntry: previous } }
          }]
        } });
        expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(previous));
      }
    }
  });

  it('keeps a remote selection scoped when a legacy model patch omits identity metadata', async () => {
    const store = createStore();
    const local: ModelEntry = { id: 'codex/test', provider: 'codex', model: 'test', label: 'Test' };
    const remote: ModelEntry = { ...local, node_id: 'B', node_label: 'flkr' };
    const different: ModelEntry = { id: 'codex/other', provider: 'codex', model: 'other' };
    store.modelsByAgent = { 'agent-1': [local, remote, different] };
    const modelOption: SessionConfigOption = {
      id: 'model', name: 'Model', type: 'select', currentValue: local.id,
      options: [local, different].map((model) => ({ value: model.id, name: model.model })),
      _meta: { querymt: { modelEntry: remote } }
    };
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [modelOption] }, replay: [] });
    await store.loadSession('agent-1', 'session-1');
    expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(remote));
    const { _meta, ...legacy } = modelOption;
    for (const patch of [legacy, { ...legacy, description: 'legacy confirmation' }]) {
      mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
        sessionUpdate: 'config_option_update', configOptions: [patch]
      } });
      expect(store.getSessionModelId('agent-1', 'session-1')).toBe(getModelSelectionKey(remote));
    }
    // A different model must not inherit the previous provider node or stale metadata.
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'config_option_update', configOptions: [{ ...legacy, currentValue: different.id }]
    } });
    expect(store.getSessionModelId('agent-1', 'session-1')).toBe(different.id);
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
  const modeAndModelOptions = (mode: string, modelId: string): SessionConfigOption[] => [
    ...modeOptions(mode),
    ...modelOptions(modelId)
  ];

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

  it('choosing Grok on Start leaves session A on Sol and applies Grok only to new session B', async () => {
    const store = setup();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: modelOptions(sol.id) }, replay: [] });
    await store.loadSession('agent-1', 'session-a');

    store.setLaunchModel('agent-1', grok.id);

    expect(store.activeSessionId).toBe('session-a');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-b', configOptions: modelOptions(sol.id) });
    await store.createSession('agent-1');

    expect(mockClient.setSessionConfigOption).toHaveBeenCalledTimes(1);
    expect(mockClient.setSessionConfigOption).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-b', value: grok.id }));
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(store.getSessionModelId('agent-1', 'session-b')).toBe(grok.id);
    store.setLaunchModel('agent-1', glm.id);
    expect(mockClient.setSessionConfigOption).toHaveBeenCalledTimes(1);
    expect(store.getSessionModelId('agent-1', 'session-b')).toBe(grok.id);
  });

  it('snapshots launch settings before creation and configures mode before model and prompt', async () => {
    const store = setup();
    store.setLaunchModel('agent-1', grok.id);
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
    store.setLaunchModel('agent-1', glm.id);
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
    expect(store.getLaunchModelId('agent-1')).toBe(glm.id);
    expect(store.getSessionModelId('agent-1', 'session-b')).toBe(grok.id);
  });

  it('does not send the first prompt when the model write fails', async () => {
    const store = setup();
    store.setLaunchModel('agent-1', grok.id);
    mockClient.setSessionConfigOption.mockRejectedValueOnce(new Error('Model rejected'));

    expect(await store.startSessionWithPrompt('agent-1')).toBeNull();
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(store.error).toBe('Model rejected');
  });

  it('does not silently use the default model when the launch selection is unavailable', async () => {
    const store = setup();
    store.setLaunchModel('agent-1', 'missing/model');

    expect(await store.startSessionWithPrompt('agent-1')).toBeNull();
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
    expect(store.error).toContain('Selected model is unavailable');
  });

  it('keeps confirmed selection on failure and obeys the server response rather than the requested model', async () => {
    const store = setup();
    await store.setSessionModel('agent-1', 'session-a', sol.id);
    store.setLaunchModel('agent-1', glm.id);
    mockClient.setSessionConfigOption.mockRejectedValueOnce(new Error('Denied'));
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(store.error).toBe('Denied');
    expect(store.sessionConfigPending.model).toBe(false);

    mockClient.setSessionConfigOption.mockResolvedValueOnce(modelOptions(glm.id));
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
    expect(store.getLaunchModelId('agent-1')).toBe(glm.id);
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

  it('preserves the selected model when a mode change response omits model metadata and accepts later authoritative updates', async () => {
    const store = setup();
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));
    await store.setActiveSessionConfigOption('mode', 'plan');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(grok.id);
    store.setLaunchModel('agent-1', glm.id);
    mockClient.emitSessionUpdate({ sessionId: 'session-a', update: {
      sessionUpdate: 'config_option_update', configOptions: modelOptions(sol.id)
    } });
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(store.getLaunchModelId('agent-1')).toBe(glm.id);
  });

  it('keeps the selected model across live mode-change notifications without model metadata', async () => {
    const store = setup();
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    mockClient.emitSessionUpdate({ sessionId: 'session-a', update: {
      sessionUpdate: 'config_option_update', configOptions: modeOptions('plan')
    } });
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(grok.id);

    mockClient.emitSessionUpdate({ sessionId: 'session-a', update: {
      sessionUpdate: 'current_mode_update', currentModeId: 'build'
    } });
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(grok.id);
  });

  it('treats a mode-change response model default as temporary and restores the recent model for an unseen mode', async () => {
    const store = setup();
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeAndModelOptions('plan', glm.id));
    await store.setActiveSessionConfigOption('mode', 'plan');

    // The agent confirmed glm as the plan default, but plan has no saved
    // preference yet, so the desktop restores the agent's most recent
    // confirmed available model (grok) with an explicit follow-up write.
    // (The leading model write is the initial setSessionModel above.)
    const writes = mockClient.setSessionConfigOption.mock.calls.map((call) => (call[0] as SetSessionConfigOptionRequest).configId);
    expect(writes).toEqual(['model', 'mode', 'model']);
    expect(mockClient.setSessionConfigOption).toHaveBeenLastCalledWith(
      expect.objectContaining({ configId: 'model', value: grok.id })
    );
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(grok.id);
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({ modelId: grok.id });
  });

  it('applies an authoritative model change reported alongside a mode change in a config_option_update', async () => {
    const store = setup();
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    mockClient.emitSessionUpdate({ sessionId: 'session-a', update: {
      sessionUpdate: 'config_option_update', configOptions: modeAndModelOptions('plan', glm.id)
    } });

    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
    expect(store.activeSession.configOptions).toEqual(modeAndModelOptions('plan', glm.id));
  });
});


describe('AgentsStore session mode preferences', () => {
  const sol: ModelEntry = { id: 'codex/gpt-5.6-sol', provider: 'codex', model: 'gpt-5.6-sol', label: 'Sol' };
  const grok: ModelEntry = { id: 'xai/grok-4.6', provider: 'xai', model: 'grok-4.6', label: 'Grok' };
  const glm: ModelEntry = { id: 'zai/glm-5.3-flash', provider: 'zai', model: 'glm-5.3-flash', label: 'GLM' };
  const remoteGrok: ModelEntry = { ...grok, node_id: 'node-1', node_label: 'Build server' };

  const modelOptions = (modelId: string): SessionConfigOption[] => [{
    id: 'model', name: 'Model', type: 'select', currentValue: modelId,
    options: [sol, grok, glm].map((model) => ({ value: model.id, name: model.label ?? model.model }))
  }];
  const modeOptions = (mode: string): SessionConfigOption[] => [{
    id: 'mode', name: 'Mode', type: 'select', currentValue: mode,
    options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]
  }];
  const reasoningOptions = (value: string): SessionConfigOption[] => [{
    id: 'thought_level', name: 'Reasoning', type: 'select', currentValue: value,
    options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }]
  }];
  const fullOptions = (mode: string, modelId: string, reasoning: string): SessionConfigOption[] => [
    ...modeOptions(mode),
    ...modelOptions(modelId),
    ...reasoningOptions(reasoning)
  ];
  const preferenceFor = (agentId: string, sessionId: string, modeId?: string) =>
    modeId == null
      ? JSON.parse(localStorage.getItem('querymt-desktop.session-mode-preferences') ?? '{}')?.agents?.[agentId]?.sessions?.[sessionId]
      : JSON.parse(localStorage.getItem('querymt-desktop.session-mode-preferences') ?? '{}')?.agents?.[agentId]?.sessions?.[sessionId]?.modes?.[modeId];

  function setup(savedModes: Record<string, unknown> = {}) {
    localStorage.clear();
    if (Object.keys(savedModes).length > 0) {
      localStorage.setItem(
        'querymt-desktop.session-mode-preferences',
        JSON.stringify({
          version: 1,
          agents: { 'agent-1': { sessions: { 'session-a': { modes: savedModes, updatedAt: '2026-09-01T00:00:00.000Z' } } } }
        })
      );
    }
    const store = createStore();
    store.modelsByAgent = { 'agent-1': [sol, grok, glm, remoteGrok] };
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

  it('captures confirmed model and reasoning per agent, session, and mode in isolation', async () => {
    const store = setup();
    mockClient.loadSession.mockImplementation(async () => ({
      response: { configOptions: fullOptions('build', sol.id, 'low') },
      replay: []
    }));
    await store.loadSession('agent-1', 'session-a');
    store.activeSessionId = 'session-b';
    store.activeSession.sessionId = 'session-b';
    await store.loadSession('agent-1', 'session-b');

    // Session A: explicit model + reasoning writes confirm a build-mode preference.
    store.activeSessionId = 'session-a';
    store.activeSession.sessionId = 'session-a';
    mockClient.setSessionConfigOption.mockImplementation(async (request) =>
      request.configId === 'model' ? modelOptions(grok.id) : reasoningOptions('high'));
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    await store.setActiveSessionConfigOption('thought_level', 'high');

    expect(store.getSessionModePreference('agent-1', 'session-a', 'build')).toEqual({
      modelId: grok.id,
      reasoningId: 'high'
    });
    // Session B keeps its load-seeded preference, untouched by session A writes.
    expect(store.getSessionModePreference('agent-1', 'session-b', 'build')).toEqual({
      modelId: sol.id,
      reasoningId: 'low'
    });
    // Exact selection keys preserve mesh identity separately from local models.
    expect(preferenceFor('agent-1', 'session-a', 'build')?.modelId).toBe('xai/grok-4.6');
    expect(preferenceFor('agent-1', 'session-a', 'plan')).toBeUndefined();
    expect(preferenceFor('agent-1', 'session-b', 'build')?.modelId).toBe(sol.id);
  });

  it('removes persisted mode entries when the session is deleted', async () => {
    const store = setup();
    mockClient.connect.mockImplementation(async (): Promise<InitializeResponse> => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {}, delete: {} } },
      authMethods: []
    }));
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: fullOptions('build', grok.id, 'high') },
      replay: []
    });
    await store.loadSession('agent-1', 'session-a');
    expect(store.getSessionModePreference('agent-1', 'session-a', 'build')).toEqual({
      modelId: grok.id,
      reasoningId: 'high'
    });

    await store.deleteSession('agent-1', 'session-a');
    expect(store.getSessionModePreference('agent-1', 'session-a', 'build')).toBeUndefined();
    expect(preferenceFor('agent-1', 'session-a')).toBeUndefined();
  });

  it('merges partial config responses by option id without losing the confirmed mode', async () => {
    const store = setup();
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: fullOptions('build', sol.id, 'low') },
      replay: []
    });
    await store.loadSession('agent-1', 'session-a');

    // Mode-only response: model and reasoning options survive the merge.
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));
    await store.setActiveSessionConfigOption('mode', 'plan');
    expect(store.getSessionModeId('agent-1', 'session-a')).toBe('plan');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(findReasoningConfigOption(store.activeSession.configOptions)?.currentValue).toBe('low');

    // Model-only response: the confirmed active mode stays known.
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modelOptions(grok.id));
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    expect(store.getSessionModeId('agent-1', 'session-a')).toBe('plan');
    expect(findModeConfigOption(store.activeSession.configOptions)?.currentValue).toBe('plan');

    // Reasoning-only response keeps mode and model.
    mockClient.setSessionConfigOption.mockResolvedValueOnce(reasoningOptions('high'));
    await store.setActiveSessionConfigOption('thought_level', 'high');
    expect(store.getSessionModeId('agent-1', 'session-a')).toBe('plan');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(grok.id);

    // Full-option response replaces the merged values wholesale.
    mockClient.setSessionConfigOption.mockResolvedValueOnce(fullOptions('build', glm.id, 'low'));
    await store.setActiveSessionConfigOption('thought_level', 'low');
    expect(store.getSessionModeId('agent-1', 'session-a')).toBe('build');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
    expect(store.getSessionModePreference('agent-1', 'session-a', 'build')).toEqual({
      modelId: glm.id,
      reasoningId: 'low'
    });
  });

  it('seeds the loaded active mode from agent state instead of an older local preference', async () => {
    const store = setup({ build: { modelId: glm.id, reasoningId: 'low' } });
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: fullOptions('build', sol.id, 'high') },
      replay: []
    });

    await store.loadSession('agent-1', 'session-a');
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    // Agent-confirmed values overwrite the stale local preference.
    expect(store.getSessionModePreference('agent-1', 'session-a', 'build')).toEqual({
      modelId: sol.id,
      reasoningId: 'high'
    });
  });

  it('does not substitute a model when a loaded session omits model metadata', async () => {
    const store = setup({ build: { modelId: glm.id } });
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: [...modeOptions('build'), ...reasoningOptions('low')] },
      replay: []
    });

    await store.loadSession('agent-1', 'session-a');
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe('');
    // The saved model stays untouched rather than being presented as confirmed.
    expect(store.getSessionModePreference('agent-1', 'session-a', 'build')).toEqual({
      modelId: glm.id,
      reasoningId: 'low'
    });
  });
});

describe('AgentsStore mode transitions', () => {
  const sol: ModelEntry = { id: 'codex/gpt-5.6-sol', provider: 'codex', model: 'gpt-5.6-sol', label: 'Sol' };
  const grok: ModelEntry = { id: 'xai/grok-4.6', provider: 'xai', model: 'grok-4.6', label: 'Grok' };
  const glm: ModelEntry = { id: 'zai/glm-5.3-flash', provider: 'zai', model: 'glm-5.3-flash', label: 'GLM' };
  const remoteGrok: ModelEntry = { ...grok, node_id: 'node-1', node_label: 'Build server' };

  const modelOptions = (modelId: string): SessionConfigOption[] => [{
    id: 'model', name: 'Model', type: 'select', currentValue: modelId,
    options: [sol, grok, glm].map((model) => ({ value: model.id, name: model.label ?? model.model }))
  }];
  const modeOptions = (mode: string): SessionConfigOption[] => [{
    id: 'mode', name: 'Mode', type: 'select', currentValue: mode,
    options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]
  }];
  const reasoningOptions = (value: string, choices: string[] = ['low', 'high']): SessionConfigOption[] => [{
    id: 'thought_level', name: 'Reasoning', type: 'select', currentValue: value,
    options: choices.map((choice) => ({ value: choice, name: choice }))
  }];
  const fullOptions = (mode: string, modelId: string, reasoning: string): SessionConfigOption[] => [
    ...modeOptions(mode),
    ...modelOptions(modelId),
    ...reasoningOptions(reasoning)
  ];
  const configIdsWritten = () =>
    mockClient.setSessionConfigOption.mock.calls.map((call) => (call[0] as SetSessionConfigOptionRequest).configId);
  const preferenceFor = (agentId: string, sessionId: string, modeId: string) =>
    JSON.parse(localStorage.getItem('querymt-desktop.session-mode-preferences') ?? '{}')?.agents?.[agentId]?.sessions?.[sessionId]?.modes?.[modeId];

  function setup(savedModes: Record<string, unknown> = {}) {
    localStorage.clear();
    if (Object.keys(savedModes).length > 0) {
      localStorage.setItem(
        'querymt-desktop.session-mode-preferences',
        JSON.stringify({
          version: 1,
          agents: { 'agent-1': { sessions: { 'session-a': { modes: savedModes, updatedAt: '2026-09-01T00:00:00.000Z' } } } }
        })
      );
    }
    const store = createStore();
    store.modelsByAgent = { 'agent-1': [sol, grok, glm, remoteGrok] };
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-a';
    store.activeSession.sessionId = 'session-a';
    store.sessionsByAgent = {
      'agent-1': ['session-a', 'session-b'].map((sessionId) => ({
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId, title: sessionId, cwd: '/tmp/work',
        updatedAt: '2026-09-07T20:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }))
    };
    mockClient.loadSession.mockResolvedValue({
      response: { configOptions: fullOptions('build', sol.id, 'low') },
      replay: []
    });
    return store;
  }

  async function loadActive(store: AgentsStore, sessionId = 'session-a') {
    store.activeSessionId = sessionId;
    store.activeSession.sessionId = sessionId;
    await store.loadSession('agent-1', sessionId);
  }

  it('restores saved target preferences in mode → model → reasoning order', async () => {
    const store = setup({ plan: { modelId: glm.id, reasoningId: 'high' } });
    await loadActive(store);
    mockClient.setSessionConfigOption
      .mockResolvedValueOnce(modeOptions('plan'))
      .mockResolvedValueOnce(modelOptions(glm.id))
      .mockResolvedValueOnce(reasoningOptions('high'));

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(configIdsWritten()).toEqual(['mode', 'model', 'thought_level']);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({
      modelId: glm.id,
      reasoningId: 'high'
    });
  });

  it('transitions independent sessions concurrently', async () => {
    const store = setup();
    await loadActive(store, 'session-a');
    await loadActive(store, 'session-b');

    let finishA!: (options: SessionConfigOption[]) => void;
    mockClient.setSessionConfigOption.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }));
    const transitionA = store.setSessionMode('agent-1', 'session-a', 'plan');
    await vi.waitFor(() => expect(finishA).toBeDefined());

    // Session B's transition proceeds while session A's is blocked.
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));
    const transitionB = store.setSessionMode('agent-1', 'session-b', 'plan');
    await transitionB;
    expect(store.getSessionModeId('agent-1', 'session-b')).toBe('plan');
    expect(store.getSessionModeId('agent-1', 'session-a')).toBe('build');

    finishA(modeOptions('plan'));
    await transitionA;
    expect(store.getSessionModeId('agent-1', 'session-a')).toBe('plan');
  });

  it('falls back to the recent model when the saved selection is unavailable', async () => {
    const store = setup({ plan: { modelId: getModelSelectionKey({ ...glm, node_id: 'offline-node' }) } });
    await loadActive(store);
    store.recentModelsByAgent = { 'agent-1': [grok.id, sol.id] };
    mockClient.setSessionConfigOption
      .mockResolvedValueOnce(modeOptions('plan'))
      .mockResolvedValueOnce(modelOptions(grok.id));

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(mockClient.setSessionConfigOption).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ configId: 'model', value: grok.id })
    );
    expect(configIdsWritten()).toEqual(['mode', 'model']);
  });

  it('keeps the agent-confirmed model when neither saved nor recent models are available', async () => {
    const store = setup({ plan: { modelId: getModelSelectionKey({ ...glm, node_id: 'offline-node' }) } });
    await loadActive(store);
    store.recentModelsByAgent = { 'agent-1': [getModelSelectionKey({ ...glm, node_id: 'offline-node' })] };
    mockClient.setSessionConfigOption.mockResolvedValueOnce(
      [...modeOptions('plan'), ...modelOptions(glm.id)]
    );

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(configIdsWritten()).toEqual(['mode']);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
  });

  it('does not write model or reasoning when the confirmed values already match the saved preferences', async () => {
    const store = setup({ plan: { modelId: grok.id, reasoningId: 'low' } });
    await loadActive(store);
    store.recentModelsByAgent = { 'agent-1': [sol.id] };
    // The mode response confirms the saved model and reasoning values itself.
    mockClient.setSessionConfigOption.mockResolvedValueOnce(fullOptions('plan', grok.id, 'low'));

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(configIdsWritten()).toEqual(['mode']);
  });

  it('resolves reasoning from choices refreshed by the model response', async () => {
    const store = setup({ plan: { modelId: glm.id, reasoningId: 'high' } });
    await loadActive(store);
    // The mode response offers no reasoning choice above 'low'; only after the
    // model write does the agent expose 'high' among the refreshed choices.
    mockClient.setSessionConfigOption
      .mockResolvedValueOnce([...modeOptions('plan'), ...reasoningOptions('low', ['low'])])
      .mockResolvedValueOnce([...modelOptions(glm.id), ...reasoningOptions('low', ['low', 'high'])])
      .mockResolvedValueOnce(reasoningOptions('high', ['low', 'high']));

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(configIdsWritten()).toEqual(['mode', 'model', 'thought_level']);
    expect(mockClient.setSessionConfigOption).toHaveBeenLastCalledWith(
      expect.objectContaining({ configId: 'thought_level', value: 'high' })
    );
  });

  it('retains the confirmed reasoning and replaces a stale saved effort that is no longer offered', async () => {
    const store = setup({ plan: { modelId: glm.id, reasoningId: 'max' } });
    await loadActive(store);
    mockClient.setSessionConfigOption
      .mockResolvedValueOnce(modeOptions('plan'))
      .mockResolvedValueOnce(modelOptions(glm.id));

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(configIdsWritten()).toEqual(['mode', 'model']);
    // The stale 'max' preference is replaced by the agent-confirmed value.
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({
      modelId: glm.id,
      reasoningId: 'low'
    });
  });

  it('reports partial failure and never records rejected values', async () => {
    const store = setup({ plan: { modelId: glm.id, reasoningId: 'high' } });
    await loadActive(store);
    mockClient.setSessionConfigOption
      .mockResolvedValueOnce(modeOptions('plan'))
      .mockRejectedValueOnce(new Error('Model rejected'));

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(store.error).toBe('Model rejected');
    // Mode confirmed, model rejected: the rejected write and the stale
    // pre-switch state stay out of persistence; previously saved values remain
    // available for a later retry.
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({
      modelId: glm.id,
      reasoningId: 'high'
    });
  });

  it('keeps unsolicited updates during a transition from overwriting saved target preferences', async () => {
    const store = setup({ plan: { modelId: glm.id, reasoningId: 'high' } });
    await loadActive(store);
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));
    // Block the restore model write so the transition is still in flight.
    let finishModel!: (options: SessionConfigOption[]) => void;
    mockClient.setSessionConfigOption.mockImplementationOnce(
      () => new Promise((resolve) => { finishModel = resolve; })
    );
    const transition = store.setSessionMode('agent-1', 'session-a', 'plan');
    await vi.waitFor(() => expect(finishModel).toBeDefined());

    // Intermediate agent defaults race in while restoration is still pending.
    mockClient.emitSessionUpdate({ sessionId: 'session-a', update: {
      sessionUpdate: 'config_option_update', configOptions: [...modelOptions(sol.id), ...reasoningOptions('low')]
    } });
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({
      modelId: glm.id,
      reasoningId: 'high'
    });

    finishModel(modelOptions(glm.id));
    await transition;
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({
      modelId: glm.id,
      reasoningId: 'high'
    });
  });

  it('captures the outgoing mode preference before switching', async () => {
    const store = setup();
    await loadActive(store);
    // A confirmed model in the build mode that has not been saved yet.
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modelOptions(grok.id));
    await store.setSessionModel('agent-1', 'session-a', grok.id);
    expect(preferenceFor('agent-1', 'session-a', 'build')).toEqual({ modelId: grok.id, reasoningId: 'low' });

    mockClient.setSessionConfigOption.mockClear();
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));
    await store.setSessionMode('agent-1', 'session-a', 'plan');

    // The build preference survived the switch and the plan mode was created.
    expect(preferenceFor('agent-1', 'session-a', 'build')).toEqual({ modelId: grok.id, reasoningId: 'low' });
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({ modelId: grok.id, reasoningId: 'low' });
  });

  it('restores the target model when the mode response omits model metadata', async () => {
    // Regression: the agent may switch its session model to its own mode
    // default while reporting no model metadata. The previously displayed
    // selection must not suppress the restore write.
    const store = setup({ plan: { modelId: sol.id } });
    await loadActive(store);
    // The loaded belief (sol) equals the resolved saved model, yet the mode
    // response confirms nothing; restoration must still write the model.
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(configIdsWritten()).toEqual(['mode', 'model']);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(sol.id);
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({
      modelId: sol.id,
      reasoningId: 'low'
    });
  });

  it('serializes a user model change made during a transition and records it normally', async () => {
    const store = setup({ plan: { modelId: glm.id } });
    await loadActive(store);
    store.recentModelsByAgent = { 'agent-1': [glm.id] };
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));
    // Block the transition's restore model write so it is still in flight.
    let finishModel!: (options: SessionConfigOption[]) => void;
    mockClient.setSessionConfigOption.mockImplementationOnce(
      () => new Promise((resolve) => { finishModel = resolve; })
    );
    const transition = store.setSessionMode('agent-1', 'session-a', 'plan');
    await vi.waitFor(() => expect(finishModel).toBeDefined());

    // The user selection must queue behind the in-flight transition instead of
    // interleaving with it, and must still update recency and persistence.
    const userWrite = store.setSessionModel('agent-1', 'session-a', grok.id);
    finishModel(modelOptions(glm.id));
    await Promise.all([transition, userWrite]);

    expect(mockClient.setSessionConfigOption).toHaveBeenLastCalledWith(
      expect.objectContaining({ configId: 'model', value: grok.id })
    );
    expect(store.recentModelsByAgent['agent-1'][0]).toBe(grok.id);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(grok.id);
    expect(store.getSessionModePreference('agent-1', 'session-a', 'plan')).toEqual({
      modelId: grok.id,
      reasoningId: 'low'
    });
  });

  it('loads the model catalog before resolving restoration when it is empty', async () => {
    const store = setup({ plan: { modelId: glm.id } });
    await loadActive(store);
    // Simulate a refresh where the catalog has not arrived yet.
    store.modelsByAgent = {};
    mockClient.listModels.mockResolvedValue([sol, grok, glm]);
    mockClient.setSessionConfigOption.mockResolvedValueOnce(modeOptions('plan'));

    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(mockClient.listModels).toHaveBeenCalled();
    expect(configIdsWritten()).toEqual(['mode', 'model']);
    expect(store.getSessionModelId('agent-1', 'session-a')).toBe(glm.id);
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

  it('updates availability from model notifications and refresh without replacing an unavailable selection', async () => {
    const store = createStore();
    mockClient.listModels.mockResolvedValue([localModel, remoteModel]);
    await store.loadInitialModelsForAgent('agent-1');
    store.setLaunchModel('agent-1', getModelSelectionKey(remoteModel));
    store.recentModelsByAgent = { 'agent-1': [getModelSelectionKey(remoteModel)] };
    mockClient.listModels.mockResolvedValue([localModel, { ...remoteModel, availability: 'unavailable' }]);
    mockClient.emitExtensionNotification({ method: 'querymt/models/changed', params: { version: 2 } });
    await vi.waitFor(() => expect(store.modelsByAgent['agent-1'][1].availability).toBe('unavailable'));
    expect(store.getLaunchModelId('agent-1')).toBe(getModelSelectionKey(remoteModel));
    expect(store.getRecentModels('agent-1')[0].availability).toBe('unavailable');
    expect(store.modelsByAgent['agent-1'][0]).not.toHaveProperty('availability');
    mockClient.refreshAndListModels.mockResolvedValue([localModel, { ...remoteModel, availability: 'available' }]);
    await store.refreshModelsForAgent('agent-1');
    expect(store.getRecentModels('agent-1')[0].availability).toBe('available');
    expect(store.getLaunchModelId('agent-1')).toBe(getModelSelectionKey(remoteModel));
    expect(mockClient.setSessionConfigOption).not.toHaveBeenCalled();
  });

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

  beforeEach(() => localStorage.removeItem('querymt-desktop.recent-delegate-models'));
  afterEach(() => localStorage.removeItem('querymt-desktop.recent-delegate-models'));

  function setupRecentDelegateModels() {
    const store = createStore();
    selectSession(store);
    store.delegateAssignmentsBySession = { 'agent-1:session-1': assignmentState };
    const models: ModelEntry[] = Array.from({ length: 7 }, (_, index) => ({
      id: `codex/model-${index}`, provider: 'codex', model: `model-${index}`
    }));
    store.modelsByAgent = { 'agent-1': models };
    mockClient.getDelegateModels.mockImplementation(async ({ session_id }) =>
      store.delegateAssignmentsBySession[`${store.activeAgentId}:${session_id}`] ?? assignmentState);
    return { store, models };
  }

  it('persists five recent models per delegate, moves reused models first, and shares history across sessions', async () => {
    const { store, models } = setupRecentDelegateModels();
    for (const model of models) {
      await expect(store.setActiveDelegateModel('coder', { model_id: model.id })).resolves.toBe(true);
    }
    expect(store.getRecentDelegateModels('agent-1', 'quorum', 'coder')).toEqual(models.slice(2).reverse());

    await store.setActiveDelegateModel('coder', { model_id: models[4].id });
    const expected = [models[4], models[6], models[5], models[3], models[2]];
    expect(store.getRecentDelegateModels('agent-1', 'quorum', 'coder')).toEqual(expected);
    expect(store.activeRecentDelegateModels).toEqual({ coder: expected });
    expect(store.recentModelsByAgent['agent-1']).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('querymt-desktop.recent-delegate-models')!)).toEqual({
      [JSON.stringify(['agent-1', 'quorum', 'coder'])]: expected.map(getModelSelectionKey)
    });

    const reloaded = createStore();
    reloaded.modelsByAgent = { 'agent-1': models };
    reloaded.activeAgentId = 'agent-1';
    reloaded.activeSessionId = 'session-2';
    reloaded.delegateAssignmentsBySession = {
      'agent-1:session-2': { ...assignmentState, session_id: 'session-2' }
    };
    expect(reloaded.activeRecentDelegateModels.coder).toEqual(expected);
  });

  it('isolates histories by delegate, profile, and connected agent', async () => {
    const { store, models } = setupRecentDelegateModels();
    await store.setActiveDelegateModel('coder', { model_id: models[0].id });
    store.delegateAssignmentsBySession['agent-1:session-1'] = {
      ...assignmentState,
      assignments: [...assignmentState.assignments, { ...assignmentState.assignments[0], agent_id: 'reviewer' }]
    };
    await store.setActiveDelegateModel('reviewer', { model_id: models[1].id });
    store.delegateAssignmentsBySession['agent-1:session-1'] = { ...assignmentState, profile_id: 'other-profile' };
    await store.setActiveDelegateModel('coder', { model_id: models[2].id });
    store.configs = [...store.configs, { ...store.configs[0], id: 'agent-2' }];
    store.activeAgentId = 'agent-2';
    store.modelsByAgent['agent-2'] = models;
    store.delegateAssignmentsBySession['agent-2:session-1'] = assignmentState;
    await store.setActiveDelegateModel('coder', { model_id: models[3].id });

    expect(store.getRecentDelegateModels('agent-1', 'quorum', 'coder')).toEqual([models[0]]);
    expect(store.getRecentDelegateModels('agent-1', 'quorum', 'reviewer')).toEqual([models[1]]);
    expect(store.getRecentDelegateModels('agent-1', 'other-profile', 'coder')).toEqual([models[2]]);
    expect(store.getRecentDelegateModels('agent-2', 'quorum', 'coder')).toEqual([models[3]]);
    expect(store.getRecentDelegateModels('agent-1', 'quorum', 'unused-role')).toEqual([]);
  });

  it('keeps local and mesh history distinct and hides unavailable models without deleting saved history', async () => {
    const { store, models } = setupRecentDelegateModels();
    const local = models[0];
    const remote = { ...local, node_id: 'node-1', node_label: 'Build server' };
    store.modelsByAgent['agent-1'] = [local, remote];
    await store.setActiveDelegateModel('coder', { model_id: local.id });
    await store.setActiveDelegateModel('coder', { model_id: remote.id, node_id: remote.node_id });
    expect(store.activeRecentDelegateModels.coder).toEqual([remote, local]);

    const saved = localStorage.getItem('querymt-desktop.recent-delegate-models');
    store.modelsByAgent['agent-1'] = [local];
    expect(store.activeRecentDelegateModels.coder).toEqual([local]);
    expect(localStorage.getItem('querymt-desktop.recent-delegate-models')).toBe(saved);
    store.modelsByAgent['agent-1'] = [local, remote];
    expect(store.activeRecentDelegateModels.coder).toEqual([remote, local]);
  });

  it('does not change recent models for reasoning, default resets, refreshes, failures, or conflicts', async () => {
    const { store, models } = setupRecentDelegateModels();
    await store.setActiveDelegateModel('coder', { model_id: models[0].id });
    await store.setActiveDelegateModel('coder', { model_id: models[1].id });
    const saved = localStorage.getItem('querymt-desktop.recent-delegate-models');

    await store.setActiveDelegateModel('coder', { model_id: models[0].id }, DelegateReasoningEffort.High);
    await store.setActiveDelegateModel('coder', null);
    await store.refreshDelegateAssignments('agent-1', 'session-1');
    mockClient.setDelegateModel.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(store.setActiveDelegateModel('coder', { model_id: models[2].id })).resolves.toBe(false);
    mockClient.setDelegateModel.mockRejectedValueOnce(new RequestError(-32602, 'Conflict', {
      code: 'delegate_assignment_conflict', expected_revision: 2, actual_revision: 3
    }));
    await expect(store.setActiveDelegateModel('coder', { model_id: models[2].id })).resolves.toBe(false);

    expect(store.activeRecentDelegateModels.coder).toEqual([models[1], models[0]]);
    expect(localStorage.getItem('querymt-desktop.recent-delegate-models')).toBe(saved);
  });

  it('only remembers a server-confirmed matching model and treats reselecting the current override as explicit use', async () => {
    const { store, models } = setupRecentDelegateModels();
    store.delegateAssignmentsBySession['agent-1:session-1'] = {
      ...assignmentState,
      assignments: [{ ...assignmentState.assignments[0], model: { model_id: models[0].id } }]
    };
    await store.setActiveDelegateModel('coder', { model_id: models[0].id });
    expect(mockClient.setDelegateModel).not.toHaveBeenCalled();
    expect(store.activeRecentDelegateModels.coder).toEqual([models[0]]);

    mockClient.setDelegateModel.mockResolvedValueOnce({
      version: 1, reasoning_effort_supported: true, session_id: 'session-1', agent_id: 'coder',
      model: { model_id: models[2].id }, reasoning_effort: null, revision: 3, durable: true
    });
    await store.setActiveDelegateModel('coder', { model_id: models[1].id });
    expect(store.activeRecentDelegateModels.coder).toEqual([models[0]]);
  });

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

  it('offers a retry instead of hiding delegate routing when the remote owner read fails', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Remote task',
      cwd: '/remote', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
      source: 'acp', location: 'remote', remoteNodeId: 'node-1', status: 'idle'
    }] };
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      location: 'remote', nodeId: 'node-1'
    } }, replay: [] });
    mockClient.getDelegateModels.mockRejectedValue(new Error('session is not bound to an available profile'));

    await store.loadSession('agent-1', 'session-1');
    await vi.waitFor(() => expect(store.activeDelegateAssignmentsError).toBe('session is not bound to an available profile'));
    expect(mockClient.getDelegateModels).toHaveBeenCalledWith({ session_id: 'session-1' });
    expect(store.canConfigureDelegateModels('agent-1')).toBe(true);
  });

  it('keeps routing available for confirmed remote roles or saved routes despite a refresh error', async () => {
    const store = createStore();
    selectSession(store);
    store.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Remote task',
      cwd: '/remote', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE',
      source: 'acp', location: 'remote', remoteNodeId: 'node-1', status: 'idle'
    }] };
    mockClient.getDelegateModels.mockRejectedValueOnce(new Error('Transient failure'));
    await store.connectAgent('agent-1');
    expect(store.canConfigureDelegateModels('agent-1')).toBe(true);

    store.delegateAssignmentsBySession = { 'agent-1:session-1': assignmentState };
    expect(store.canConfigureDelegateModels('agent-1')).toBe(true);
    store.delegateAssignmentsBySession = { 'agent-1:session-1': {
      ...assignmentState, assignments: [],
      orphaned_overrides: [{ agent_id: 'removed-role', model: { model_id: 'legacy/model' }, reasoning_effort: null }]
    } };
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
    // Legacy backend payload: predates the reasoning-effort fields.
    const oldBackendState = {
      ...assignmentState,
      reasoning_effort_supported: undefined,
      assignments: [],
      orphaned_overrides: [{ agent_id: 'removed-role', model: { model_id: 'legacy/model' } }]
    } as unknown as DelegateAssignmentsInfo;
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
    // Legacy backend confirmation: predates the reasoning-effort fields.
    } as SetDelegateModelResponse);
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
    // Model-only confirmation: reasoning_effort omitted means "keep current".
    } as SetDelegateModelResponse);
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
    // Model-only confirmation: reasoning_effort omitted means "keep current".
    } as SetDelegateModelResponse);
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

  it('tracks delegate lifecycle independently from completed dispatch tools', async () => {
    const store = createStore();
    selectSession(store);
    store.activeSession.toolCalls = [{
      id: 'delegate-1',
      title: 'Run delegate',
      status: 'completed',
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

    expect(store.activeSession.toolCalls[0]).toMatchObject({ status: 'completed', childSessionId: 'child-session-1', delegationState: 'forked' });
    mockClient.emitExtensionNotification({
      method: 'querymt/session/delegationUpdate',
      params: { version: 1, sessionId: 'session-1', toolCallId: 'delegate-1', state: 'failed', updatedAt: 2 }
    });
    expect(store.activeSession.toolCalls[0]).toMatchObject({ status: 'completed', childSessionId: 'child-session-1', delegationState: 'failed' });
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

describe('AgentsStore mesh node availability', () => {
  const NODE_ALPHA = '12D3KooWQmtDesktopNodeAlpha11111111111111';
  const NODE_BRAVO = '12D3KooWQmtDesktopNodeBravo11111111111111';
  const NODE_CHARLIE = '12D3KooWQmtDesktopNodeCharlie111111111111';

  function websocketConfig(id: string): AgentConfig {
    return {
      id,
      name: 'Remote QueryMT',
      transport: 'websocket',
      commandLine: '',
      websocketUrl: '127.0.0.1:3030',
      enabled: true,
      autoStart: true
    };
  }

  it('populates the mesh node count from a successful connection', async () => {
    const store = createStore();
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));

    await store.connectAgent('agent-1');
    await tick();

    expect(store.connectionStates['agent-1']).toBe('initialized');
    expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    expect(store.meshNodeCount).toBe(2);
  });

  it('deduplicates the same remote node reported by multiple connected agents', async () => {
    const store = createStore();
    store.configs = [
      ...store.configs,
      {
        id: 'agent-2',
        name: 'Second QMTCODE',
        transport: 'stdio',
        commandLine: '/usr/local/bin/qmtcode-2 --acp',
        enabled: true,
        autoStart: true
      }
    ];
    store.statuses = {
      ...store.statuses,
      'agent-2': { ...store.statuses['agent-1'], agentId: 'agent-2' }
    };
    // Peers of the same mesh: both agents report the same remote nodes, so a
    // naive per-agent sum would double-count every stable node id.
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));

    await store.connectAgent('agent-1');
    await store.connectAgent('agent-2');
    await tick();

    expect(store.meshNodeCount).toBe(2);
  });

  it('ignores cached nodes for agents that are disconnected or disabled', () => {
    const store = createStore();
    store.configs = [...store.configs, websocketConfig('agent-offline'), { ...websocketConfig('agent-disabled'), transport: 'stdio', websocketUrl: undefined, enabled: false }];
    store.connectionStates = {
      'agent-1': 'initialized',
      'agent-offline': 'failed',
      'agent-disabled': 'initialized'
    };
    store.meshNodesByAgent = {
      'agent-1': meshNodes([NODE_ALPHA, NODE_BRAVO]),
      'agent-offline': meshNodes([NODE_CHARLIE]),
      'agent-disabled': meshNodes([NODE_CHARLIE])
    };

    expect(store.meshNodeCount).toBe(2);
  });

  it('drops the mesh node count when the agent is stopped', async () => {
    const store = createStore();
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA]));

    await store.connectAgent('agent-1');
    await tick();
    expect(store.meshNodeCount).toBe(1);

    await store.stopConfiguredAgent('agent-1');

    expect(store.meshNodesByAgent['agent-1']).toBeNull();
    expect(store.meshNodeCount).toBe(0);
  });

  it('clears the mesh node count on unexpected loss and repopulates it after reconnecting', async () => {
    vi.useFakeTimers();
    const store = createStore();
    store.configs = [websocketConfig('remote-agent')];
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));

    await store.connectAgent('remote-agent');
    await tick();
    expect(store.meshNodeCount).toBe(2);

    mockClient.emitConnectionLoss('WebSocket closed (code 1006).');

    expect(store.connectionStates['remote-agent']).toBe('reconnecting');
    expect(store.meshNodesByAgent['remote-agent']).toBeNull();
    expect(store.meshNodeCount).toBe(0);

    await vi.advanceTimersByTimeAsync(250);
    await tick();

    expect(store.connectionStates['remote-agent']).toBe('initialized');
    expect(store.meshNodeCount).toBe(2);
  });

  it('drops the mesh node count when the websocket config is disabled or its transport changes', async () => {
    const store = createStore();
    store.configs = [websocketConfig('remote-agent')];
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA]));

    await store.connectAgent('remote-agent');
    await tick();
    expect(store.meshNodeCount).toBe(1);

    store.updateConfig('remote-agent', { enabled: false });

    expect(store.meshNodesByAgent['remote-agent']).toBeNull();
    expect(store.meshNodeCount).toBe(0);

    store.updateConfig('remote-agent', { enabled: true, transport: 'stdio' });

    expect(store.meshNodesByAgent['remote-agent']).toBeNull();
    expect(store.meshNodeCount).toBe(0);
  });

  it('keeps the connection healthy when the agent lacks the mesh extension', async () => {
    const store = createStore();
    mockClient.listMeshStatus.mockRejectedValue(new Error(`Agent is missing required capability ${QMT_METHOD_MESH_STATUS}.`));
    mockClient.listMeshNodes.mockRejectedValue(new Error(`Agent is missing required capability ${QMT_METHOD_MESH_NODES}.`));

    await store.connectAgent('agent-1');
    await tick();

    expect(store.connectionStates['agent-1']).toBe('initialized');
    expect(store.agentErrors['agent-1']).toBeNull();
    expect(store.error).toBeNull();
    expect(store.meshNodesByAgent['agent-1']).toBeNull();
    expect(store.meshNodeCount).toBe(0);
  });

  it('reconnects with a fresh client after stopping a stdio agent and repopulates mesh nodes', async () => {
    const store = createStore();
    const firstClient = createDistinctMockClient();
    const secondClient = createDistinctMockClient();
    const pendingClients = [firstClient, secondClient];
    vi.mocked(DesktopAcpClient).mockImplementation(function () {
      const next = pendingClients.shift();
      if (!next) throw new Error('unexpected extra DesktopAcpClient construction');
      return next as never;
    });
    firstClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));
    secondClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_CHARLIE]));
    // Non-empty models let the connect-time model chain finish in one
    // attempt; pending retries would outlive the test and touch shared
    // mock state from later tests.
    firstClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    secondClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);

    await store.startConfiguredAgent('agent-1');
    await vi.waitFor(() => expect(store.meshNodeCount).toBe(2));
    expect(firstClient.connect).toHaveBeenCalledTimes(1);

    await store.stopConfiguredAgent('agent-1');
    // The stdio sidecar has no loss callback, so the stop path itself must
    // dispose the client instead of leaving a zombie for the next start.
    expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
    expect(store.meshNodesByAgent['agent-1']).toBeNull();
    expect(store.meshNodeCount).toBe(0);

    await store.startConfiguredAgent('agent-1');
    await vi.waitFor(() => {
      expect(secondClient.connect).toHaveBeenCalledTimes(1);
      expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_CHARLIE]);
    });
    expect(store.meshNodeCount).toBe(2);
  });

  it('surfaces the native start failure string instead of a generic connect error', async () => {
    const store = createStore();
    vi.mocked(startAgent).mockRejectedValueOnce(
      "Could not find the 'qmtcode' agent. Looked in: [/tmp/x/qmtcode]" as never
    );

    await store.startConfiguredAgent('agent-1');

    expect(store.error).toContain("Could not find the 'qmtcode' agent");
  });

  it('surfaces the native restart failure string instead of a generic reconnect error', async () => {
    const store = createStore();
    vi.mocked(restartAgent).mockRejectedValueOnce(
      "Could not find the 'qmtcode' agent. Looked in: [/tmp/x/qmtcode]" as never
    );

    await store.restartConfiguredAgent('agent-1');

    expect(store.error).toContain("Could not find the 'qmtcode' agent");
    expect(store.error).not.toContain('Failed to reconnect');
  });

  it('does not resurrect mesh nodes when a pending refresh settles after a stop', async () => {
    const store = createStore();
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA]));
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    await store.connectAgent('agent-1');
    await tick();
    expect(store.meshNodeCount).toBe(1);

    let resolveStaleNodes!: (value: MeshNodesInfo) => void;
    const staleNodes = new Promise<MeshNodesInfo>((resolve) => {
      resolveStaleNodes = resolve;
    });
    mockClient.listMeshNodes.mockImplementationOnce(() => staleNodes);
    mockClient.emitExtensionNotification({ method: 'querymt/mesh/nodesChanged', params: {} });
    await vi.waitFor(() => expect(mockClient.listMeshNodes).toHaveBeenCalledTimes(2));

    await store.stopConfiguredAgent('agent-1');
    resolveStaleNodes(meshNodes([NODE_ALPHA, NODE_BRAVO, NODE_CHARLIE]));
    await tick();
    await tick();

    expect(store.meshNodesByAgent['agent-1']).toBeNull();
    expect(store.meshNodeCount).toBe(0);
  });

  it('keeps restarted mesh nodes when the pre-restart refresh settles afterwards', async () => {
    const store = createStore();
    const firstClient = createDistinctMockClient();
    const secondClient = createDistinctMockClient();
    const pendingClients = [firstClient, secondClient];
    vi.mocked(DesktopAcpClient).mockImplementation(function () {
      const next = pendingClients.shift();
      if (!next) throw new Error('unexpected extra DesktopAcpClient construction');
      return next as never;
    });
    firstClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA]));
    secondClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));
    firstClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    secondClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);

    await store.startConfiguredAgent('agent-1');
    await vi.waitFor(() => expect(store.meshNodeCount).toBe(1));

    let resolveStaleNodes!: (value: MeshNodesInfo) => void;
    const staleNodes = new Promise<MeshNodesInfo>((resolve) => {
      resolveStaleNodes = resolve;
    });
    firstClient.listMeshNodes.mockImplementationOnce(() => staleNodes);
    firstClient.emitExtensionNotification({ method: 'querymt/mesh/nodesChanged', params: {} });
    await vi.waitFor(() => expect(firstClient.listMeshNodes).toHaveBeenCalledTimes(2));

    await store.restartConfiguredAgent('agent-1');
    await vi.waitFor(() => {
      expect(secondClient.connect).toHaveBeenCalledTimes(1);
      expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    });
    expect(store.meshNodeCount).toBe(2);

    resolveStaleNodes(meshNodes([NODE_ALPHA, NODE_CHARLIE]));
    await tick();
    await tick();

    expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    expect(store.meshNodeCount).toBe(2);
  });

  it('lets a newer same-record refresh win when the older request settles later', async () => {
    const store = createStore();
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA]));
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    await store.connectAgent('agent-1');
    await tick();
    expect(store.meshNodeCount).toBe(1);

    let resolveOlderNodes!: (value: MeshNodesInfo) => void;
    const olderNodes = new Promise<MeshNodesInfo>((resolve) => {
      resolveOlderNodes = resolve;
    });
    mockClient.listMeshNodes.mockImplementationOnce(() => olderNodes);
    mockClient.emitExtensionNotification({ method: 'querymt/mesh/nodesChanged', params: {} });
    await vi.waitFor(() => expect(mockClient.listMeshNodes).toHaveBeenCalledTimes(2));

    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));
    mockClient.emitExtensionNotification({ method: 'querymt/mesh/joined', params: {} });
    await vi.waitFor(() => {
      expect(mockClient.listMeshNodes).toHaveBeenCalledTimes(3);
      expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    });
    expect(store.meshNodeCount).toBe(2);

    resolveOlderNodes(meshNodes([NODE_ALPHA, NODE_CHARLIE]));
    await tick();
    await tick();

    expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    expect(store.meshNodeCount).toBe(2);
  });

  it('clears availability when a notification-driven refresh fails but keeps the connection healthy', async () => {
    const store = createStore();
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    await store.connectAgent('agent-1');
    await tick();
    expect(store.meshNodeCount).toBe(2);

    mockClient.listMeshStatus.mockRejectedValueOnce(new Error('mesh status failed'));
    mockClient.emitExtensionNotification({ method: 'querymt/mesh/peerExpired', params: {} });

    await vi.waitFor(() => expect(store.meshNodesByAgent['agent-1']).toBeNull());

    expect(store.meshNodeCount).toBe(0);
    expect(store.connectionStates['agent-1']).toBe('initialized');
    expect(store.agentErrors['agent-1']).toBeNull();
    expect(store.error).toBeNull();
  });

  it('keeps newer mesh data when a superseded request rejects afterwards', async () => {
    const store = createStore();
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA]));
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    await store.connectAgent('agent-1');
    await tick();
    expect(store.meshNodeCount).toBe(1);

    let rejectOlderNodes!: (error: Error) => void;
    const olderNodes = new Promise<MeshNodesInfo>((_resolve, reject) => {
      rejectOlderNodes = reject;
    });
    mockClient.listMeshNodes.mockImplementationOnce(() => olderNodes);
    mockClient.emitExtensionNotification({ method: 'querymt/mesh/nodesChanged', params: {} });
    await vi.waitFor(() => expect(mockClient.listMeshNodes).toHaveBeenCalledTimes(2));

    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));
    mockClient.emitExtensionNotification({ method: 'querymt/mesh/nodesChanged', params: {} });
    await vi.waitFor(() => {
      expect(mockClient.listMeshNodes).toHaveBeenCalledTimes(3);
      expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    });

    // The stale rejection is absorbed by the availability wrapper without
    // clearing the newer data (an unhandled rejection would fail the run).
    rejectOlderNodes(new Error('stale request failed'));
    await tick();
    await tick();

    expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    expect(store.meshNodeCount).toBe(2);
    expect(store.error).toBeNull();
    expect(store.agentErrors['agent-1']).toBeNull();
  });

  it('ignores a pending notification refresh that settles after an unexpected loss', async () => {
    const store = createStore();
    store.configs = [{ ...websocketConfig('remote-agent'), autoStart: false }];
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA, NODE_BRAVO]));
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);

    await store.connectAgent('remote-agent');
    await tick();
    expect(store.meshNodeCount).toBe(2);

    let resolveStaleNodes!: (value: MeshNodesInfo) => void;
    const staleNodes = new Promise<MeshNodesInfo>((resolve) => {
      resolveStaleNodes = resolve;
    });
    mockClient.listMeshNodes.mockImplementationOnce(() => staleNodes);
    mockClient.emitExtensionNotification({ method: 'querymt/mesh/nodesChanged', params: {} });
    await vi.waitFor(() => expect(mockClient.listMeshNodes).toHaveBeenCalledTimes(2));

    mockClient.emitConnectionLoss('WebSocket closed (code 1006).');
    expect(store.meshNodesByAgent['remote-agent']).toBeNull();
    expect(store.meshNodeCount).toBe(0);

    resolveStaleNodes(meshNodes([NODE_ALPHA, NODE_BRAVO, NODE_CHARLIE]));
    await tick();
    await tick();

    expect(store.meshNodesByAgent['remote-agent']).toBeNull();
    expect(store.meshNodeCount).toBe(0);
  });

  it('rejects a manual mesh refresh when the current RPC fails', async () => {
    const store = createStore();
    mockClient.listMeshNodes.mockResolvedValue(meshNodes([NODE_ALPHA]));
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);
    await store.connectAgent('agent-1');
    await tick();
    expect(store.meshNodeCount).toBe(1);

    mockClient.listMeshStatus.mockRejectedValueOnce(new Error('mesh down'));
    await expect(store.refreshMeshForAgent('agent-1')).rejects.toThrow('mesh down');

    // A manual failure still rejects for the mesh page but leaves the last
    // known availability untouched.
    expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA]);
    expect(store.meshNodeCount).toBe(1);
    expect(store.connectionStates['agent-1']).toBe('initialized');
  });

  it('lets a manual refresh started while disconnected win after the connection-ready automatic refresh fails', async () => {
    const store = createStore();
    // Call ordering is deterministic: the connection-ready hook issues its
    // listMeshNodes synchronously during the connect, while the manual
    // refresh can only issue its RPC after connectAgent resolves. The first
    // call is therefore the automatic one (fails) and the second the manual
    // one (succeeds).
    mockClient.listMeshNodes
      .mockRejectedValueOnce(new Error('mesh nodes failed'))
      .mockResolvedValueOnce(meshNodes([NODE_ALPHA, NODE_BRAVO]));
    mockClient.listModels.mockResolvedValue([{ id: 'model-1', provider: 'test', model: 'model-1' }]);

    // Begin the public manual refresh while the agent has no client at all:
    // connecting is part of the manual refresh's job.
    const manual = store.refreshMeshForAgent('agent-1');
    await vi.waitFor(() => expect(mockClient.listMeshNodes).toHaveBeenCalledTimes(2));
    const result = await manual;
    await tick();
    await tick();

    expect(store.connectionStates['agent-1']).toBe('initialized');
    expect(result?.meshNodes.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    expect(store.meshNodesByAgent['agent-1']?.nodes.map((node) => node.id)).toEqual([NODE_ALPHA, NODE_BRAVO]);
    expect(store.meshNodeCount).toBe(2);
    // The automatic failure is absorbed and never surfaces as a store error.
    expect(store.error).toBeNull();
    expect(store.agentErrors['agent-1']).toBeNull();
  });
});

describe('AgentsStore status consistency', () => {
  afterEach(cleanup);

  it.each([
    { sessionUpdate: 'config_option_update', configOptions: [] },
    { sessionUpdate: 'current_mode_update', currentModeId: 'build' },
    { sessionUpdate: 'usage_update', used: 4, size: 100 },
    { sessionUpdate: 'available_commands_update', availableCommands: [] }
  ] satisfies SessionNotification['update'][])('keeps observed-idle recency/order for $sessionUpdate while reconciling status', async (update) => {
    const store = await selectedStore();
    const oldStamp = '2020-01-01T00:00:00Z';
    const otherStamp = '2021-01-01T00:00:00Z';
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [
      { sessionId: 'session-1', title: 'Idle S', cwd: '/work', updatedAt: oldStamp, _meta: {
        userMessageCount: 0, runtimeStatus: runtime(SessionRuntimePhase.Idle, 1)
      } },
      { sessionId: 'other-session', title: 'Newer T', cwd: '/work', updatedAt: otherStamp, _meta: {
        userMessageCount: 0, runtimeStatus: runtime(SessionRuntimePhase.Idle, 1)
      } }
    ] });
    await store.refreshSessionsForAgent('agent-1');
    // A stale summary must still converge to cached runtime without inventing activity.
    store.sessionsByAgent = { ...store.sessionsByAgent, 'agent-1': store.sessionsByAgent['agent-1'].map((item) =>
      item.sessionId === 'session-1' ? { ...item, status: 'unknown' as const } : item) };
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update });
    const own = () => store.sessionsByAgent['agent-1'].find((item) => item.sessionId === 'session-1');
    expect(own()).toMatchObject({ status: 'idle', updatedAt: oldStamp, hasUserHistory: false });
    expect(store.sessions.map((item) => item.sessionId)).toEqual(['other-session', 'session-1']);
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'session_info_update', title: 'Renamed S'
    } });
    expect(own()).toMatchObject({ title: 'Renamed S', updatedAt: oldStamp });
    const explicitStamp = '2022-01-01T00:00:00Z';
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'session_info_update', updatedAt: explicitStamp
    } });
    expect(own()).toMatchObject({ title: 'Renamed S', updatedAt: explicitStamp, status: 'idle' });
    expect(store.sessions.map((item) => item.sessionId)).toEqual(['session-1', 'other-session']);
  });

  it.each([
    { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'New turn' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working' } },
    { sessionUpdate: 'tool_call', toolCallId: 'shell-new', title: 'Shell', status: 'in_progress' }
  ] satisfies SessionNotification['update'][])('still bumps genuine $sessionUpdate activity with observed runtime', async (update) => {
    const store = await selectedStore();
    const oldStamp = '2020-01-01T00:00:00Z';
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [
      { sessionId: 'session-1', cwd: '/work', updatedAt: oldStamp, _meta: {
        userMessageCount: 0, runtimeStatus: runtime(SessionRuntimePhase.Idle, 1)
      } },
      { sessionId: 'other-session', cwd: '/work', updatedAt: '2021-01-01T00:00:00Z' }
    ] });
    await store.refreshSessionsForAgent('agent-1');
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update });
    const own = store.sessionsByAgent['agent-1'].find((item) => item.sessionId === 'session-1')!;
    expect(own.updatedAt! > '2021-01-01T00:00:00Z').toBe(true);
    expect(store.sessions.map((item) => item.sessionId)).toEqual(['session-1', 'other-session']);
    expect(own.hasUserHistory).toBe(update.sessionUpdate === 'user_message_chunk');
    expect(own.status).toBe(update.sessionUpdate === 'user_message_chunk' ? 'completed' : 'idle');
  });

  it('retains positive user-history evidence accumulated within one summary batch', async () => {
    const store = await selectedStore();
    const listed = (revision: number): SessionInfo => ({ sessionId: 'session-1', cwd: '/work', _meta: {
      messageCount: 0, userMessageCount: 0, hasErrors: false, runtimeStatus: runtime(SessionRuntimePhase.Idle, revision)
    } });
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed(1)] });
    await store.refreshSessionsForAgent('agent-1');
    expect(store.sessionsByAgent['agent-1'][0].hasUserHistory).toBe(false);
    const notifications: SessionNotification[] = [
      { sessionId: 'session-1', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'New turn' } } },
      { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working' } } },
      { sessionId: 'session-1', update: { sessionUpdate: 'tool_call', toolCallId: 'new-shell', title: 'Shell', status: 'in_progress' } }
    ];
    (store as unknown as { applySessionSummaryUpdates(updates: Array<{ agentId: string; notification: SessionNotification }>): void })
      .applySessionSummaryUpdates(notifications.map((notification) => ({ agentId: 'agent-1', notification })));
    expect(store.sessionsByAgent['agent-1'][0].hasUserHistory).toBe(true);
    announce(runtime(SessionRuntimePhase.Idle, 2));
    expect(store.sessionsByAgent['agent-1'][0].status).toBe('completed');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed(3)] });
    await store.refreshSessionsForAgent('agent-1');
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({ status: 'idle', hasUserHistory: false });
  });

  it.each(['tool_call', 'tool_call_update'] as const)('keeps new B %s progress and Stop when cached Idle A predates it', async (sessionUpdate) => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Tools, 1, { active_run_id: 'run-a' }));
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'tool_call', toolCallId: 'shell-a', title: 'Shell A', status: 'in_progress'
    } });
    announce(runtime(SessionRuntimePhase.Idle, 2));
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate, toolCallId: 'shell-b', title: 'Long shell B', status: 'in_progress'
    } });
    const toolB = () => store.activeSession.toolCalls.find((tool) => tool.id === 'shell-b');
    expect(toolB()).toMatchObject({ status: 'in_progress' });
    expect(toolB()?.runId).not.toBe('run-a');
    expect(store.activeRunBusy).toBe(true);
    expect(store.activeSession.activeToolCallId).toBe('shell-b');
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'usage_update', used: 4, size: 100
    } });
    expect(toolB()?.status).toBe('in_progress');
    expect(store.activeRunBusy).toBe(true);
    announce(runtime(SessionRuntimePhase.Tools, 3, { active_run_id: 'run-b' }));
    expect(toolB()).toMatchObject({ runId: 'run-b', status: 'in_progress' });
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'shell-a', status: 'completed', rawOutput: 'Late real A result'
    } });
    expect(toolB()).toMatchObject({ runId: 'run-b', status: 'in_progress' });
    expect(store.activeSession).toMatchObject({ runId: 'run-b', activeToolCallId: 'shell-b' });
    expect(store.activeRunBusy).toBe(true);
  });

  it.each(['unsupported', 'unavailable'] as const)('keeps actual loaded history unavailable in the header when execution is %s', async (mode) => {
    const store = createStore();
    mockClient.supportsQuerymtMethod.mockReturnValue(mode !== 'unsupported');
    mockClient.listSessions.mockResolvedValue({ sessions: [{ sessionId: 'session-1', cwd: '/tmp/work' }] });
    await store.connectAgent('agent-1', true);
    await store.refreshSessionsForAgent('agent-1');
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [] }, replay: [{ sessionId: 'session-1', update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Stored answer' }
    } }] });
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Unknown, 0, {
      observation: { availability: 'unavailable' }
    }));
    await store.loadSession('agent-1', 'session-1');
    const summary = store.sessionsByAgent['agent-1'].find((item) => item.sessionId === 'session-1');
    expect(summary?.status).toBe('unknown');
    render(SessionHeader, { session: store.activeSession, summaryStatus: summary!.status,
      title: 'History', workspace: 'work', updatedAt: 'Now' });
    expect(screen.getByLabelText('Status: Status unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status: Turn complete')).not.toBeInTheDocument();
    if (mode === 'unsupported') expect(mockClient.getSessionRuntimeStatus).not.toHaveBeenCalled();
  });

  it('keeps an actual failed own outcome visible with a live verifier without exposing own Stop', async () => {
    const store = await selectedStore();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      'querymt/sessionLoadSnapshot.v1': { audit: { events: [
        { seq: 1, kind: { type: 'run_started', data: { run_id: 'run-a' } } },
        { seq: 2, kind: { type: 'run_completed', data: { run_id: 'run-a', outcome: 'failed' } } }
      ] } }
    } }, replay: [] });
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Idle, 2, { delegation_activity: [verifier] }));
    await store.loadSession('agent-1', 'session-1');
    expect(store.activeSession.runState).toBe('failed');
    expect(store.activeSession.dependencyLabel).toBe('Verifying delegate result');
    expect(store.activeRunBusy).toBe(false);
    render(SessionHeader, { session: store.activeSession, title: 'Failed own turn', workspace: 'work', updatedAt: 'Now' });
    expect(screen.getByLabelText('Status: Failed')).toBeInTheDocument();
    expect(mockClient.cancelSession).not.toHaveBeenCalled();
  });

  it.each([
    [SessionRuntimePhase.Tools, 'thinking'], [SessionRuntimePhase.Waiting, 'thinking'],
    [SessionRuntimePhase.CancelRequested, 'cancelling'], [SessionRuntimePhase.Idle, 'idle'],
    [SessionRuntimePhase.Unknown, 'unknown']
  ] as const)('accepts remote runtime-only %s without inventing history or dropping owner metadata', async (phase, status) => {
    const store = await selectedStore();
    const runtimeStatus = runtime(phase, 1, { observation: { availability: phase === SessionRuntimePhase.Unknown ? 'unavailable' : 'live', epoch: 'remote-e1', revision: 1 } });
    const lifecycle = { session_id: 'remote-s', resolved: false, archived: false, resolved_at: null, archived_at: null };
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [{ sessionId: 'remote-s', cwd: '/remote/work', _meta: {
      location: 'remote', nodeId: 'remote-node', nodeLabel: 'Owner', profileId: 'coder', profileLabel: 'Coder',
      connectionState: 'available', parentSessionId: 'parent', forkOrigin: 'delegation', sessionKind: 'delegate',
      querymt: { lifecycle }, runtimeStatus
    } }] });
    await store.refreshSessionsForAgent('agent-1');
    expect(store.sessionsByAgent['agent-1'].find((item) => item.sessionId === 'remote-s')).toMatchObject({
      status, location: 'remote', remoteNodeId: 'remote-node', remoteNodeLabel: 'Owner',
      remoteProfileId: 'coder', remoteProfileLabel: 'Coder', remoteConnectionState: 'available',
      lifecycle, parentSessionId: 'parent', forkOrigin: 'delegation', sessionKind: 'delegate', relationshipKnown: true
    });
  });

  it('preserves zero, known and unavailable history evidence through list/runtime/notification summary paths', async () => {
    const store = await selectedStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [
      { sessionId: 'empty', cwd: '/work', _meta: { messageCount: 0, userMessageCount: 0, hasErrors: false, runtimeStatus: runtime(SessionRuntimePhase.Idle, 1) } },
      { sessionId: 'used', cwd: '/work', _meta: { messageCount: 2, userMessageCount: 1, hasErrors: false, runtimeStatus: runtime(SessionRuntimePhase.Idle, 1) } },
      { sessionId: 'runtime-only', cwd: '/remote', _meta: { runtimeStatus: runtime(SessionRuntimePhase.Idle, 1) } }
    ] });
    await store.refreshSessionsForAgent('agent-1');
    const check = () => expect(Object.fromEntries(store.sessionsByAgent['agent-1'].filter((item) => ['empty', 'used', 'runtime-only'].includes(item.sessionId))
      .map((item) => [item.sessionId, item.status]))).toEqual({ empty: 'idle', used: 'completed', 'runtime-only': 'idle' });
    check();
    for (const sessionId of ['empty', 'used', 'runtime-only']) {
      mockClient.emitExtensionNotification({ method: 'querymt/session/runtimeChanged', params: {
        version: 1, session_id: sessionId, runtime: runtime(SessionRuntimePhase.Tools, 2)
      } });
      mockClient.emitExtensionNotification({ method: 'querymt/session/runtimeChanged', params: {
        version: 1, session_id: sessionId, runtime: runtime(SessionRuntimePhase.Idle, 3)
      } });
      mockClient.emitSessionUpdate({ sessionId, update: { sessionUpdate: 'config_option_update', configOptions: [] } });
    }
    check();
  });

  it.each([SessionRuntimePhase.Tools, SessionRuntimePhase.Idle])('F1: rejects stale runtime errors after newer healthy %s', async (phase) => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Model, 5, { active_run_id: 'run-a' }));
    let rejectOld!: (error: Error) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
    const pending = store.refreshSessionRuntime().catch(() => null);
    await vi.waitFor(() => expect(rejectOld).toBeDefined());
    announce(runtime(phase, 6));
    rejectOld(new Error('Obsolete request failed'));
    await pending;
    expect(store.activeSessionRuntime).toMatchObject({ phase, observation: { availability: 'live', revision: 6 } });
    expect(store.activeRunBusy).toBe(phase === SessionRuntimePhase.Tools);
    if (phase === SessionRuntimePhase.Tools) expect(store.activeSession.runId).toBe('run-b');
  });

  it.each(['connection', 'epoch'] as const)('F1: ignores an old error across %s replacement', async (boundary) => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Model, 5, { active_run_id: 'run-a' }));
    let rejectOld!: (error: Error) => void;
    const replacement = runtime(SessionRuntimePhase.Tools, 1, { observation: { availability: 'live', epoch: 'actor-2', revision: 1 } });
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValue(replacement);
    const pending = store.refreshSessionRuntime().catch(() => null);
    await vi.waitFor(() => expect(rejectOld).toBeDefined());
    if (boundary === 'connection') await store.connectAgent('agent-1', true);
    announce(replacement);
    rejectOld(new Error('Old owner read failed'));
    await pending;
    await vi.waitFor(() => expect(store.activeSessionRuntime?.observation?.epoch).toBe('actor-2'));
    expect(store.activeSessionRuntime).toMatchObject({ phase: SessionRuntimePhase.Tools, observation: { availability: 'live' } });
    expect(store.activeRunBusy).toBe(true);
  });

  it('F3: automatically verifies a nonselected changed incarnation and fences an old E1 response', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Idle, 9));
    await store.loadSession('agent-1', 'other-session');
    mockClient.getSessionRuntimeStatus.mockClear();
    let finishOld!: (value: SessionRuntimeStatus) => void;
    let verify!: (value: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { verify = resolve; }));
    const oldRead = store.refreshSessionRuntime('agent-1', 'session-1');
    await vi.waitFor(() => expect(finishOld).toBeDefined());
    const changed = runtime(SessionRuntimePhase.Tools, 1, { observation: { availability: 'live', epoch: 'actor-2', revision: 1 } });
    const listed = (sessionId: string, runtimeStatus: SessionRuntimeStatus) => ({ sessionId, cwd: '/tmp/work', _meta: {
      messageCount: 2, userMessageCount: 1, hasErrors: false, runtimeStatus
    } });
    mockClient.listSessions.mockResolvedValue({ sessions: [listed('session-1', changed),
      ...Array.from({ length: 20 }, (_, index) => listed(`uncached-${index}`, runtime(SessionRuntimePhase.Idle, 1)))] });
    await store.refreshSessionsForAgent('agent-1');
    await vi.waitFor(() => expect(verify).toBeDefined());
    const summary = () => store.sessionsByAgent['agent-1'].find((item) => item.sessionId === 'session-1');
    expect(summary()?.status).toBe('unknown');
    await store.refreshSessionsForAgent('agent-1');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [listed('session-1', runtime(SessionRuntimePhase.Idle, 10))] });
    await store.refreshSessionsForAgent('agent-1');
    expect(summary()?.status).toBe('unknown');
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenNthCalledWith(1, 'session-1');
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenNthCalledWith(2, 'session-1');
    finishOld(runtime(SessionRuntimePhase.Idle, 10));
    expect(await oldRead).toBeNull();
    expect(summary()?.status).toBe('unknown');
    expect(store.sessionRuntimeBySession['agent-1:session-1']?.observation?.availability).toBe('unavailable');
    verify(changed);
    await vi.waitFor(() => expect(summary()?.status).toBe('thinking'));
    expect(store.sessionRuntimeBySession['agent-1:session-1']).toMatchObject({ phase: SessionRuntimePhase.Tools,
      observation: { availability: 'live', epoch: 'actor-2', revision: 1 } });
    expect(store.activeSessionId).toBe('other-session');
    await store.refreshSessionsForAgent('agent-1');
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(mockClient.loadSession).toHaveBeenCalledTimes(1);
  });

  it('F3: caps changed-incarnation verification at two cached sessions per list', async () => {
    const store = await selectedStore();
    await store.loadSession('agent-1', 'other-session');
    store.sessionRuntimeBySession = Object.fromEntries(Array.from({ length: 5 }, (_, index) =>
      [`agent-1:cached-${index}`, runtime(SessionRuntimePhase.Idle, 9)]));
    mockClient.getSessionRuntimeStatus.mockClear();
    mockClient.getSessionRuntimeStatus.mockImplementation(() => new Promise(() => {}));
    mockClient.listSessions.mockResolvedValue({ sessions: Array.from({ length: 5 }, (_, index) => ({
      sessionId: `cached-${index}`, cwd: '/tmp/work', _meta: { runtimeStatus: runtime(SessionRuntimePhase.Tools, 1,
        { observation: { availability: 'live', epoch: 'actor-2', revision: 1 } }) }
    })) });
    await store.refreshSessionsForAgent('agent-1');
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenNthCalledWith(1, 'cached-0');
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenNthCalledWith(2, 'cached-1');
    expect(store.sessionsByAgent['agent-1'].filter((item) => item.sessionId.startsWith('cached-')).map((item) => item.status))
      .toEqual(Array(5).fill('unknown'));
  });

  it.each([
    { delivery: 'queue', boundary: 'selection', failure: false },
    { delivery: 'steer', boundary: 'connection', failure: false },
    { delivery: 'queue', boundary: 'selection', failure: true },
    { delivery: 'steer', boundary: 'connection', failure: true }
  ] as const)('F4: fences $delivery visible effects after $boundary replacement (failure=$failure) but retains receipts', async ({ delivery, boundary, failure }) => {
    const store = await selectedStore();
    mockClient.supportsQuerymtFeature.mockImplementation((feature) => feature === 'steering');
    store.setActiveComposerInputDelivery(delivery);
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Model, 1));
    let resolve!: (result: SubmitInputResult) => void;
    let reject!: (error: Error) => void;
    const deferred = new Promise<SubmitInputResult>((yes, no) => { resolve = yes; reject = no; });
    if (delivery === 'queue') mockClient.queueSession.mockImplementationOnce(() => deferred);
    else mockClient.steerSession.mockImplementationOnce(() => deferred);
    const submitting = store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(store.activePendingInputs).toHaveLength(1));
    const inputId = store.activePendingInputs[0].inputId;
    const acceptedBeforeFailure = delivery === 'steer' && failure;
    if (acceptedBeforeFailure) mockClient.emitExtensionNotification({ method: 'querymt/session/inputState', params: {
      version: 1, session_id: 'session-1', input_id: inputId, delivery: SessionInputDelivery.Steer,
      state: SessionInputState.Accepted, run_id: 'run-b'
    } });
    if (boundary === 'selection') {
      mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Idle, 3));
      await store.loadSession('agent-1', 'other-session');
      await store.loadSession('agent-1', 'session-1');
    } else {
      await store.connectAgent('agent-1', true);
      announce(runtime(SessionRuntimePhase.Idle, 3));
    }
    const draft = store.composerPrompt;
    store.error = 'Latest view error';
    store.activeSession.lastError = 'Latest execution detail';
    if (failure) reject(new Error('Obsolete submission failure'));
    else resolve(delivery === 'queue' ? { status: 'queued', data: { input_id: inputId, position: 1 } }
      : { status: 'steered', data: { input_id: inputId, run_id: 'run-b', position: 1 } });
    await submitting;
    expect(store.composerPrompt).toBe(draft);
    expect(store.error).toBe('Latest view error');
    expect(store.activeSession.runState).toBe('completed');
    expect(store.activeSession.lastError).toBe('Latest execution detail');
    expect(store.pendingInputsBySession['agent-1:session-1'].find((item) => item.inputId === inputId)?.state)
      .toBe(acceptedBeforeFailure ? 'accepted' : failure ? 'failed' : delivery === 'queue' ? 'queued' : 'accepted');
  });

  it('F5: fails closed on unavailable Send without silently queueing or losing the draft', async () => {
    const store = await selectedStore();
    mockClient.supportsQuerymtFeature.mockImplementation((feature) => feature === 'steering');
    const draft = store.composerPrompt;
    const attachments = [{ id: 'notes', name: 'notes.txt', mimeType: 'text/plain', size: 1, data: 'eA==' }];
    store.promptAttachments = attachments;
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Unknown, 1, {
      active_run_id: null, steerable: false, observation: { availability: 'unavailable' }
    }));
    await store.sendPromptToActiveSession();
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(mockClient.steerSession).not.toHaveBeenCalled();
    expect(mockClient.queueSession).not.toHaveBeenCalled();
    expect(store.composerPrompt).toBe(draft);
    expect(store.promptAttachments).toEqual(attachments);
    expect(store.activeSession.transcript).toHaveLength(0);
    expect(store.error).toMatch(/status unavailable/i);
  });

  it('retains a same-run initiating cancellation outcome with versioned runtime', async () => {
    const store = await selectedStore();
    let finish!: (response: PromptResponse) => void;
    mockClient.sendPrompt.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const sending = store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(finish).toBeDefined());
    announce(runtime(SessionRuntimePhase.Model, 1, { active_run_id: 'run-a' }));
    announce(runtime(SessionRuntimePhase.Idle, 2));
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Idle, 2));
    finish({ stopReason: 'cancelled' });
    await sending;
    expect(store.activeSession).toMatchObject({ runId: 'run-a', runState: 'completed', lastStopReason: 'cancelled',
      lastRunOutcome: { runId: 'run-a', outcome: 'cancelled' }, activityLabel: 'Turn cancelled.' });
  });
  function runtime(phase: SessionRuntimePhase, revision: number, extra: Partial<SessionRuntimeStatus> = {}): SessionRuntimeStatus {
    return { phase, active_run_id: phase === SessionRuntimePhase.Idle ? undefined : 'run-b',
      steerable: phase !== SessionRuntimePhase.Closing, pending_steering_count: 0, queued_input_count: 0,
      observation: { availability: 'live', epoch: 'actor-1', revision }, delegation_activity: [], ...extra };
  }

  async function selectedStore() {
    const store = createStore();
    await store.connectAgent('agent-1', true);
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    return store;
  }

  function announce(value: SessionRuntimeStatus) {
    mockClient.emitExtensionNotification({ method: 'querymt/session/runtimeChanged',
      params: { version: 1, session_id: 'session-1', runtime: value } });
  }

  const verifier = { version: 1, sessionId: 'session-1', delegationId: 'delegate-1',
    state: DelegationUpdateState.Forked, targetAgentId: 'coder', objective: '', requestedAt: 1, updatedAt: 2,
    stage: 'verifying', activity: 'live', sourceEpoch: 'workflow-1', sessionSeq: 10 } as const;

  it('merges independently ordered stages and empty authoritative activity at equal self revision', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Idle, 5, { delegation_activity: [verifier] }));
    expect(store.activeRunBusy).toBe(false);
    expect(store.activeSession.dependencyLabel).toBe('Verifying delegate result');
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Idle, 5, {
      delegation_activity: [{ ...verifier, stage: 'finalizing', sessionSeq: 11 }]
    }));
    await store.refreshSessionRuntime();
    expect(store.activeSession.dependencyLabel).toBe('Finalizing delegate result');
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Idle, 5));
    await store.refreshSessionRuntime();
    expect(store.activeSession.dependencyLabel).toBeNull();
    // An old live observation cannot resurrect a workflow removed by a newer query.
    announce(runtime(SessionRuntimePhase.Idle, 5, { delegation_activity: [verifier] }));
    expect(store.activeSession.dependencyLabel).toBeNull();
  });

  it('retains a live verifier through unavailable empty runtime and same-sequence recovery until healthy cleanup', async () => {
    const store = await selectedStore();
    const liveVerifier = { ...verifier, delegationId: 'verifier-b', sessionSeq: 17 };
    announce(runtime(SessionRuntimePhase.Idle, 5, { delegation_activity: [liveVerifier] }));
    expect(store.activeRunBusy).toBe(false);
    expect(store.activeSession.dependencyLabel).toBe('Verifying delegate result');

    mockClient.getSessionRuntimeStatus.mockResolvedValueOnce(runtime(SessionRuntimePhase.Unknown, 0, {
      active_run_id: null, steerable: false, observation: { availability: 'unavailable', reason: 'owner_unavailable' }
    }));
    await store.refreshSessionRuntime();
    expect(store.activeSessionRuntime).toMatchObject({ phase: SessionRuntimePhase.Unknown,
      observation: { availability: 'unavailable' } });
    expect(store.activeSession.runState).toBe('unknown');
    expect.soft(store.activeSession.delegations).toContainEqual(liveVerifier);
    expect.soft(store.activeSession.dependencyLabel).toBe('Verifying delegate result');

    mockClient.getSessionRuntimeStatus.mockResolvedValueOnce(runtime(SessionRuntimePhase.Idle, 5, {
      delegation_activity: [liveVerifier]
    }));
    await store.refreshSessionRuntime();
    expect(store.activeSessionRuntime?.phase).toBe(SessionRuntimePhase.Idle);
    expect(store.activeRunBusy).toBe(false);
    expect(store.activeSession.delegations).toContainEqual(liveVerifier);
    expect(store.activeSession.dependencyLabel).toBe('Verifying delegate result');

    mockClient.getSessionRuntimeStatus.mockResolvedValueOnce(runtime(SessionRuntimePhase.Idle, 5));
    await store.refreshSessionRuntime();
    expect(store.activeSession.dependencyLabel).toBeNull();
    expect(store.activeSession.delegations).toContainEqual({ ...liveVerifier, activity: 'historical' });
    expect(store.activeSessionRuntime?.delegation_activity).toEqual([]);
  });

  it('does not erase a newer live workflow with an older in-flight empty activity response', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Idle, 5));
    let finish!: (value: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = store.refreshSessionRuntime();
    await vi.waitFor(() => expect(finish).toBeDefined());
    mockClient.emitExtensionNotification({ method: 'querymt/session/delegationUpdate', params: verifier });
    expect(store.activeSession.dependencyLabel).toBe('Verifying delegate result');
    finish(runtime(SessionRuntimePhase.Idle, 5));
    await pending;
    expect(store.activeSession.dependencyLabel).toBe('Verifying delegate result');
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Idle, 5));
    await store.refreshSessionRuntime();
    expect(store.activeSession.dependencyLabel).toBeNull();
  });

  it('accepts newer list run B instead of blindly preferring cached idle A', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Idle, 1));
    mockClient.listSessions.mockResolvedValue({ sessions: [{ sessionId: 'session-1', cwd: '/tmp/work', _meta: {
      messageCount: 2, userMessageCount: 1, hasErrors: false, runtimeStatus: runtime(SessionRuntimePhase.Tools, 2)
    } }] });
    await store.refreshSessionsForAgent('agent-1');
    expect(store.activeSessionRuntime?.active_run_id).toBe('run-b');
    expect(store.activeRunBusy).toBe(true);
    expect(store.sessionsByAgent['agent-1'][0].status).toBe('thinking');
    mockClient.listSessions.mockResolvedValue({ sessions: [{ sessionId: 'session-1', cwd: '/tmp/work', _meta: {
      messageCount: 2, userMessageCount: 1, hasErrors: false, runtimeStatus: runtime(SessionRuntimePhase.Idle, 1)
    } }] });
    await store.refreshSessionsForAgent('agent-1');
    expect(store.activeSessionRuntime?.active_run_id).toBe('run-b');
  });

  it('converges observer-only start/completion and ignores equal/older execution revisions', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Tools, 2));
    expect(store.activeRunBusy).toBe(true);
    store.activeSession.activityLabel = 'Detail retained';
    announce(runtime(SessionRuntimePhase.Tools, 2));
    expect(store.activeSession.activityLabel).toBe('Detail retained');
    announce(runtime(SessionRuntimePhase.Idle, 1));
    expect(store.activeRunBusy).toBe(true);
    announce(runtime(SessionRuntimePhase.Idle, 3));
    expect(store.activeRunBusy).toBe(false);
    expect(store.activeSession.runState).toBe('completed');
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
  });

  it.each(['tool_call', 'tool_call_update'] as const)('does not let completed snapshot A clobber captured live shell run B (%s)', async (captureKind) => {
    const store = await selectedStore();
    mockClient.loadSession.mockImplementationOnce(async () => {
      announce(runtime(SessionRuntimePhase.Tools, 3));
      return { response: { configOptions: [], _meta: { 'querymt/sessionLoadSnapshot.v1': {
        runtimeStatus: runtime(SessionRuntimePhase.Idle, 2), audit: { events: [
          { seq: 1, kind: { type: 'run_started', data: { run_id: 'run-a' } } },
          { seq: 2, kind: { type: 'assistant_message_stored', data: { message_id: 'answer-a', content: 'Done A' } } },
          { seq: 3, kind: { type: 'run_completed', data: { run_id: 'run-a', outcome: 'completed' } } }
        ] }
      } } }, replay: [{ sessionId: 'session-1', update: {
        sessionUpdate: captureKind, toolCallId: 'shell-b', title: 'Long shell B', status: 'in_progress'
      } }] };
    });
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Tools, 3));
    await store.loadSession('agent-1', 'session-1');
    expect(store.activeSession).toMatchObject({ runId: 'run-b', runState: 'tool-running', activeToolCallId: 'shell-b' });
    expect(store.activeSession.toolCalls[0].status).toBe('in_progress');
    render(SessionActivityBar, { session: store.activeSession });
    expect(screen.getByRole('status')).toHaveTextContent(/Long shell B/i);
    cleanup();
  });

  it('accepts the actual tool result when runtime idle arrives ahead of the terminal tool update', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Tools, 1));
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'tool_call', toolCallId: 'late-shell', title: 'Shell', status: 'in_progress'
    } });
    announce(runtime(SessionRuntimePhase.Idle, 2));
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'tool_call_update', toolCallId: 'late-shell', status: 'completed', rawOutput: 'Actual result'
    } });
    expect(store.activeSession.toolCalls[0]).toMatchObject({ status: 'completed', result: 'Actual result' });
    expect(store.activeSession.toolCalls[0].isError).not.toBe(true);
    expect(store.activeRunBusy).toBe(false);
  });

  it('does not let a run A Stop failure erase newer healthy run B', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Tools, 1, { active_run_id: 'run-a' }));
    let rejectCancel!: (error: Error) => void;
    mockClient.cancelSession.mockImplementationOnce(() => new Promise((_, reject) => { rejectCancel = reject; }));
    const stopping = store.cancelActiveSession();
    await vi.waitFor(() => expect(rejectCancel).toBeDefined());
    announce(runtime(SessionRuntimePhase.Tools, 3));
    store.error = 'Latest view error';
    rejectCancel(new Error('Old cancel send failed'));
    await stopping;
    expect(store.activeSession).toMatchObject({ runId: 'run-b', runState: 'tool-running' });
    expect(store.activeRunBusy).toBe(true);
    expect(store.error).toBe('Latest view error');
  });

  it('distinguishes native waiting self execution from own-idle managed verification and historical rows', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Waiting, 1, { delegation_activity: [{ ...verifier, stage: 'executing' }] }));
    expect(store.activeRunBusy).toBe(true);
    const view = render(SessionActivityBar, { session: store.activeSession });
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for delegates');
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.CancelRequested, 2));
    await store.cancelActiveSession();
    expect(mockClient.cancelSession).toHaveBeenCalledWith('session-1');
    expect(mockClient.discardQueuedInput).not.toHaveBeenCalled();
    announce(runtime(SessionRuntimePhase.Idle, 3, { delegation_activity: [{ ...verifier, sessionSeq: 11 }] }));
    expect(store.activeRunBusy).toBe(false);
    await view.rerender({ session: store.activeSession });
    expect(screen.getByRole('status')).toHaveTextContent('Own turn idle - Verifying delegate result');
    expect(screen.getByRole('status')).not.toHaveTextContent('Double Esc');
    await store.cancelActiveSession();
    expect(mockClient.cancelSession).toHaveBeenCalledTimes(1);
    mockClient.emitExtensionNotification({ method: 'querymt/session/delegationUpdate', params: {
      ...verifier, state: DelegationUpdateState.Completed, stage: undefined, activity: 'historical', sessionSeq: 12
    } });
    expect(store.activeSession.dependencyLabel).toBeNull();
    mockClient.emitExtensionNotification({ method: 'querymt/session/delegationUpdate', params: {
      ...verifier, activity: 'historical', sourceEpoch: 'old-source', sessionSeq: 999
    } });
    expect(store.activeSession.dependencyLabel).toBeNull();
    cleanup();
  });

  it.each([false, true])('does not let run A prompt completion erase new queued run B (B completed=%s)', async (bCompleted) => {
    const store = await selectedStore();
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Idle, 0));
    let finish!: (value: PromptResponse) => void;
    mockClient.sendPrompt.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const sending = store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(finish).toBeDefined());
    announce(runtime(SessionRuntimePhase.Model, 1, { active_run_id: 'run-a' }));
    announce(runtime(SessionRuntimePhase.Tools, 3));
    store.pendingInputsBySession = { 'agent-1:session-1': [{ inputId: 'queued-c', delivery: 'queue', state: 'queued',
      prompt: 'Next', attachments: [], createdAt: 1 }] };
    if (bCompleted) announce(runtime(SessionRuntimePhase.Idle, 4));
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(bCompleted ? SessionRuntimePhase.Idle : SessionRuntimePhase.Tools, bCompleted ? 4 : 3));
    finish({ stopReason: 'cancelled' });
    await sending;
    expect(store.activeSession).toMatchObject({ runId: 'run-b', runState: bCompleted ? 'completed' : 'tool-running', lastStopReason: null });
    expect(store.activeSession.activityLabel).not.toContain('cancelled');
    expect(store.activePendingInputs.map((item) => item.inputId)).toEqual(['queued-c']);
    expect(mockClient.discardQueuedInput).not.toHaveBeenCalled();
  });

  it('rejects a pre-selection A read across A -> B -> A and restores the new A execution', async () => {
    const store = await selectedStore();
    let finishOld!: (value: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(runtime(SessionRuntimePhase.Idle, 1))
      .mockResolvedValueOnce(runtime(SessionRuntimePhase.Tools, 5));
    const oldRead = store.refreshSessionRuntime();
    await vi.waitFor(() => expect(finishOld).toBeDefined());
    await store.loadSession('agent-1', 'session-other');
    const returning = store.loadSession('agent-1', 'session-1');
    finishOld(runtime(SessionRuntimePhase.Idle, 2));
    expect(await oldRead).toBeNull();
    await returning;
    expect(store.activeSession).toMatchObject({ sessionId: 'session-1', runId: 'run-b', runState: 'tool-running' });
  });

  it('requires a fresh read for an incarnation change and rejects a pre-change response', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Tools, 5));
    let finishOld!: (value: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce(runtime(SessionRuntimePhase.Waiting, 1, { observation: { availability: 'live', epoch: 'actor-2', revision: 1 } }));
    const oldRead = store.refreshSessionRuntime();
    await vi.waitFor(() => expect(finishOld).toBeDefined());
    announce(runtime(SessionRuntimePhase.Waiting, 1, { observation: { availability: 'live', epoch: 'actor-2', revision: 1 } }));
    finishOld(runtime(SessionRuntimePhase.Idle, 6));
    expect(await oldRead).toBeNull();
    await vi.waitFor(() => expect(store.activeSessionRuntime?.observation?.epoch).toBe('actor-2'));
    expect(store.activeSession.activityLabel).toBe('Waiting for delegates');
    expect(store.activeRunBusy).toBe(true);
  });

  it.each(['idle', 'tools'] as const)('reconciles %s runtime into the visible execution view', async (phase) => {
    const store = createStore();
    await store.connectAgent('agent-1', true);
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.activeSession.runState = phase === 'idle' ? 'thinking' : 'completed';
    store.activeSession.activityLabel = phase === 'idle' ? 'Cancelling turn...' : 'Turn completed.';
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: phase === 'idle' ? SessionRuntimePhase.Idle : SessionRuntimePhase.Tools,
      active_run_id: phase === 'tools' ? 'run-b' : undefined,
      steerable: phase === 'tools', pending_steering_count: 0, queued_input_count: 0
    });
    await store.refreshSessionRuntime();
    expect(store.activeSession.runState).toBe(phase === 'idle' ? 'completed' : 'tool-running');
    if (phase === 'idle') expect(store.activeSession.activityLabel).not.toContain('Cancelling');
    else {
      await store.cancelActiveSession();
      expect(mockClient.cancelSession).toHaveBeenCalledWith('session-1');
    }
  });

  it('restores legacy replay-only tools and does not promote historical delegate rows to live work', async () => {
    const store = await selectedStore();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      'querymt/sessionLoadSnapshot.v1': { delegationUpdates: [{ ...verifier, activity: 'historical' }] }
    } }, replay: [{ sessionId: 'session-1', update: {
      sessionUpdate: 'tool_call', toolCallId: 'legacy-shell', title: 'Legacy shell', status: 'in_progress'
    } }] });
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Tools, 1));
    await store.loadSession('agent-1', 'session-1');
    expect(store.activeSession).toMatchObject({ runState: 'tool-running', activeToolCallId: 'legacy-shell', dependencyLabel: null });
    expect(store.activeSession.toolCalls[0].status).toBe('in_progress');
    expect(store.activeSession.delegations?.[0].activity).toBe('historical');
  });

  it('keeps closing active, visible and non-steerable while unknown is not idle', async () => {
    const store = await selectedStore();
    announce(runtime(SessionRuntimePhase.Closing, 1));
    expect(store.activeRunBusy).toBe(true);
    expect(store.activeInputDelivery).toBe('queue');
    const view = render(SessionActivityBar, { session: store.activeSession });
    expect(screen.getByRole('status')).toHaveTextContent('Finishing turn');
    mockClient.getSessionRuntimeStatus.mockResolvedValue(runtime(SessionRuntimePhase.Unknown, 2, {
      active_run_id: undefined, observation: { availability: 'unavailable', epoch: 'actor-1', revision: 2 }
    }));
    await store.refreshSessionRuntime();
    await view.rerender({ session: store.activeSession });
    expect(store.activeSession.runState).toBe('unknown');
    expect(store.activeRunBusy).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('Execution status unavailable');
    expect(screen.getByRole('status')).not.toHaveTextContent('Double Esc');
  });

  it('preserves a running shell through the real load path', async () => {
    const store = createStore();
    mockClient.loadSession.mockResolvedValue({ response: { configOptions: [], _meta: {
      'querymt/sessionLoadSnapshot.v1': { audit: { events: [
        { seq: 1, kind: { type: 'run_started', data: { run_id: 'run-b' } } },
        { seq: 2, kind: { type: 'tool_call_start', data: { tool_call_id: 'shell', tool_name: 'shell' } } }
      ] } }
    } }, replay: [] });
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools, active_run_id: 'run-b', steerable: true,
      pending_steering_count: 0, queued_input_count: 0, run_started_at_ms: 1
    });
    const loadingAt = Date.now();
    await store.loadSession('agent-1', 'session-1');
    expect(store.activeSession.toolCalls[0]).toMatchObject({ id: 'shell', status: 'in_progress' });
    expect(store.activeSession.runState).toBe('tool-running');
    expect(store.activeSession.activeToolCallId).toBe('shell');
    expect(store.activeSession.usage.activeWorkStartedAt).toBeGreaterThanOrEqual(loadingAt);
  });
});

describe('AgentsStore prompt session start', () => {
  it.each(['capture', 'live', 'drain'] as const)('keeps one first prompt when navigation overlaps a snapshot with its %s echo', async (delivery) => {
    const store = createStore();
    let finishPrompt!: (response: PromptResponse) => void;
    mockClient.sendPrompt.mockImplementationOnce(() => new Promise((resolve) => { finishPrompt = resolve; }));
    const prompt = 'Check whether this project uses the requested shader';
    store.composerPrompt = prompt;
    const sessionId = await store.startSessionWithPrompt('agent-1');
    expect(sessionId).toBe('session-1');
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    const clientPromptId = mockClient.sendPrompt.mock.calls[0][3]?.clientPromptId;
    const response = { configOptions: [] as SessionConfigOption[], _meta: {
      'querymt/sessionLoadSnapshot.v1': { audit: { events: [
        { seq: 1, kind: { type: 'prompt_received', data: { message_id: 'user-1', content: prompt } } },
        { seq: 2, kind: { type: 'assistant_message_stored', data: { message_id: 'assistant-1', content: 'I will inspect the project.' } } },
        { seq: 3, kind: { type: 'tool_call_start', data: { tool_call_id: 'inspect-1', tool_name: 'read_file', arguments: '{}' } } }
      ] } }
    } };
    // The route loads history while the first prompt is running. Capture begins
    // before the snapshot is read, so these are both live updates AND history.
    const browser = new BrowserClient();
    browser.onSessionUpdate((notification) => mockClient.emitSessionUpdate(notification));
    const echo: SessionNotification = { sessionId: 'session-1', update: {
      sessionUpdate: 'user_message_chunk', messageId: 'user-1', content: { type: 'text', text: prompt },
      _meta: { querymt: { client_prompt_id: clientPromptId } }
    } };
    mockClient.loadSession.mockImplementationOnce(async () => {
      const capture = browser.beginSessionReplay('session-1');
      if (delivery === 'capture') await browser.sessionUpdate(echo);
      if (delivery === 'drain') mockDrainAgentSessionUpdates.mockResolvedValueOnce([echo]);
      return { response, replay: capture.notifications, finishReplay: () => browser.completeSessionReplay(capture) };
    });
    try {
      // First call: the route's own load of the just-created session. It is skipped, so it neither
      // bumps the selection generation (which would drop the in-flight prompt) nor races it.
      await store.loadSession('agent-1', 'session-1');
      expect(mockClient.loadSession).not.toHaveBeenCalled();
      // A refresh while the prompt is still running loads history over the optimistic turn.
      await store.loadSession('agent-1', 'session-1');
      if (delivery === 'live') await browser.sessionUpdate(echo);
      expect(store.activeSession.toolCalls).toHaveLength(1);
      expect(store.activeSession.transcript.filter((item) => item.kind === 'agent_message_chunk').map((item) => item.text))
        .toEqual(['I will inspect the project.']);
      const afterNavigation = buildSessionConversation(store.activeSession).map((turn) => turn.user?.text);
      // A manual refresh has no overlapping echo, matching the issue's second image.
      mockClient.loadSession.mockResolvedValueOnce({ response, replay: [] });
      await store.loadSession('agent-1', 'session-1');
      const afterRefresh = buildSessionConversation(store.activeSession).map((turn) => turn.user?.text);
      expect(afterRefresh).toEqual([prompt]);
      expect(afterNavigation).toEqual(afterRefresh);
      expect(mockClient.sendPrompt).toHaveBeenCalledOnce();
    } finally {
      finishPrompt({ stopReason: 'end_turn' });
    }
  });

  it('keeps complete snapshot attachments once while preserving new captured prompt blocks with identical text', async () => {
    const store = createStore();
    const blocks: SessionNotification['update'][] = [
      { sessionUpdate: 'user_message_chunk', messageId: 'user-old', content: { type: 'text', text: 'Repeat this' } },
      { sessionUpdate: 'user_message_chunk', messageId: 'user-old', content: { type: 'image', data: 'aW1n', mimeType: 'image/png' } },
      { sessionUpdate: 'user_message_chunk', messageId: 'user-old', content: { type: 'resource', resource: { uri: 'file:///notes.txt', text: 'Notes', mimeType: 'text/plain' } } },
      { sessionUpdate: 'user_message_chunk', messageId: 'user-new', content: { type: 'text', text: 'Repeat this' } },
      { sessionUpdate: 'user_message_chunk', messageId: 'user-new', content: { type: 'image', data: 'bmV3', mimeType: 'image/png' } }
    ];
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      'querymt/sessionLoadSnapshot.v1': {
        user_prompts: [{ message_id: 'user-old', blocks: blocks.slice(0, 3).map((update) => 'content' in update ? update.content : null) }],
        audit: { events: [
          { seq: 1, kind: { type: 'prompt_received', data: { message_id: 'user-old', content: 'Repeat this' } } },
          { seq: 2, kind: { type: 'assistant_message_stored', data: { message_id: 'answer', content: 'First reply' } } }
        ] }
      }
    } }, replay: blocks.map((update) => ({ sessionId: 'session-1', update })) });
    await store.loadSession('agent-1', 'session-1');
    const turns = buildSessionConversation(store.activeSession);
    expect(turns.map((turn) => turn.user?.text)).toEqual(['Repeat this', 'Repeat this']);
    expect(turns[0].user?.blocks?.map((block) => block.type)).toEqual(['text', 'image', 'resource']);
    expect(turns[1].user?.blocks?.map((block) => block.type)).toEqual(['text', 'image']);
    expect(turns[0].content[0]).toMatchObject({ type: 'assistant', text: 'First reply' });
  });

  it('does not drop uncorrelated user chunks or a genuinely new live message after snapshot hydration', async () => {
    const store = createStore();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      'querymt/sessionLoadSnapshot.v1': { audit: { events: [
        { seq: 1, kind: { type: 'prompt_received', data: { message_id: 'old', content: 'Same text' } } }
      ] } }
    } }, replay: [{ sessionId: 'session-1', update: {
      sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'No ID' }
    } }] });
    await store.loadSession('agent-1', 'session-1');
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'user_message_chunk', messageId: 'new', content: { type: 'text', text: 'Same text' }
    } });
    expect(buildSessionConversation(store.activeSession).map((turn) => turn.user?.text))
      .toEqual(['Same text', 'No ID', 'Same text']);
  });

  it('does not carry snapshot message identities into a different session or an undo reload', async () => {
    const store = createStore();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: {
      'querymt/sessionLoadSnapshot.v1': { audit: { events: [
        { seq: 1, kind: { type: 'prompt_received', data: { message_id: 'shared-id', content: 'First' } } }
      ] } }
    } }, replay: [] });
    await store.loadSession('agent-1', 'session-1');
    await store.loadSession('agent-1', 'session-2');
    mockClient.emitSessionUpdate({ sessionId: 'session-2', update: {
      sessionUpdate: 'user_message_chunk', messageId: 'shared-id', content: { type: 'text', text: 'Second' }
    } });
    expect(store.activeSession.transcript.map((item) => item.text)).toEqual(['Second']);
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [] }, replay: [{ sessionId: 'session-2', update: {
      sessionUpdate: 'user_message_chunk', messageId: 'shared-id', content: { type: 'text', text: 'Second' }
    } }] });
    await store.loadSession('agent-1', 'session-2', 'undo');
    expect(store.activeSession.transcript.map((item) => item.text)).toEqual(['Second']);
  });

  it('ignores late snapshot-covered user echoes after remote attach', async () => {
    const store = createStore();
    await store.attachRemoteSession('agent-1', 'node-1', 'remote-session-1');
    const before = buildSessionConversation(store.activeSession).map((turn) => turn.user?.text);
    mockClient.emitSessionUpdate({ sessionId: 'remote-session-1', update: {
      sessionUpdate: 'user_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Review deployment' }
    } });
    expect(buildSessionConversation(store.activeSession).map((turn) => turn.user?.text)).toEqual(before);
  });

  it('does not redirect an input when the selected session changes during runtime refresh', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    let resolveRuntime!: (runtime: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus.mockReturnValueOnce(
      new Promise<SessionRuntimeStatus>((resolve) => { resolveRuntime = resolve; })
    );
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    store.composerPrompt = 'Keep this with session one';
    await store.connectAgent('agent-1');

    const send = store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledWith('session-1'));
    store.activeSessionId = 'session-2';
    store.activeSession.sessionId = 'session-2';
    resolveRuntime({
      phase: SessionRuntimePhase.Model,
      active_run_id: 'run-1',
      steerable: true,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    await send;

    expect(mockClient.steerSession).not.toHaveBeenCalled();
    expect(mockClient.queueSession).not.toHaveBeenCalled();
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
  });

  it('shows queue delivery when an active runtime lacks an active run id', async () => {
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Continue the task';
    store.composerInputDeliveryBySession = { 'agent-1:session-1': 'steer' };
    store.sessionRuntimeBySession = {
      'agent-1:session-1': {
        phase: SessionRuntimePhase.Model,
        active_run_id: undefined,
        steerable: true,
        pending_steering_count: 0,
        queued_input_count: 0,
        run_started_at_ms: 1
      }
    };

    expect(store.activeInputDelivery).toBe('queue');
  });

  it('keeps the replacement-client runtime when an older generation resolves out of order', async () => {
    let resolveOlder!: (runtime: SessionRuntimeStatus) => void;
    let resolveNewer!: (runtime: SessionRuntimeStatus) => void;
    mockClient.getSessionRuntimeStatus
      .mockImplementationOnce(() => new Promise<SessionRuntimeStatus>((resolve) => { resolveOlder = resolve; }))
      .mockImplementationOnce(() => new Promise<SessionRuntimeStatus>((resolve) => { resolveNewer = resolve; }));
    const store = createStore();
    await store.connectAgent('agent-1');

    const older = store.refreshSessionRuntime('agent-1', 'session-1');
    await vi.waitFor(() => expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(1));
    await store.connectAgent('agent-1', true);
    const newer = store.refreshSessionRuntime('agent-1', 'session-1');
    await vi.waitFor(() => expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledTimes(2));
    const authoritative: SessionRuntimeStatus = {
      phase: SessionRuntimePhase.Idle,
      active_run_id: undefined,
      steerable: false,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: undefined
    };
    resolveNewer(authoritative);
    await expect(newer).resolves.toEqual(authoritative);
    resolveOlder({
      phase: SessionRuntimePhase.Model,
      active_run_id: 'stale-run',
      steerable: true,
      pending_steering_count: 1,
      queued_input_count: 0,
      run_started_at_ms: 1
    });

    await expect(older).resolves.toBeNull();
    expect(store.sessionRuntimeBySession['agent-1:session-1']).toEqual(authoritative);
  });

  it('restores a snapshot-only queued message with attachments and allows discarding it', async () => {
    mockClient.loadSession.mockResolvedValueOnce({
      response: {
        configOptions: [],
        _meta: {
          'querymt/sessionLoadSnapshot.v1': {
            audit: {
              events: [{
                seq: 1,
                timestamp: 10,
                kind: {
                  type: 'input_queued',
                  data: {
                    input_id: 'queue-restored',
                    position: 1,
                    accepted_at_ms: 1234,
                    blocks: [
                      { type: 'text', text: 'Continue after this run' },
                      {
                        type: 'resource',
                        resource: {
                          uri: 'attachment:///file-1/notes.txt',
                          blob: 'dGV4dA==',
                          mimeType: 'text/plain'
                        },
                        _meta: { querymt: { attachment_id: 'file-1', filename: 'notes.txt', size: 4 } }
                      }
                    ]
                  }
                }
              }]
            }
          }
        }
      },
      replay: []
    });
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1',
        agentName: 'QMTCODE',
        sessionId: 'session-1',
        title: 'Queued work',
        cwd: '/tmp/work',
        updatedAt: '2026-09-20T00:00:00Z',
        runtimeId: 'agent-1',
        runtimeName: 'QMTCODE',
        source: 'acp',
        status: 'idle'
      }]
    };
    await store.connectAgent('agent-1');

    await store.loadSession('agent-1', 'session-1');

    expect(store.activePendingInputs).toEqual([expect.objectContaining({
      inputId: 'queue-restored',
      delivery: 'queue',
      state: 'queued',
      prompt: 'Continue after this run',
      createdAt: 1234,
      attachments: [expect.objectContaining({ id: 'file-1', name: 'notes.txt', data: 'dGV4dA==' })]
    })]);

    await store.discardQueuedInput('queue-restored');

    expect(mockClient.discardQueuedInput).toHaveBeenCalledWith('session-1', 'queue-restored');
    expect(store.activePendingInputs).toEqual([]);
  });

  it('preserves explicit snapshot run lifecycle state over replay content during load', async () => {
    mockClient.loadSession.mockResolvedValueOnce({
      response: {
        configOptions: [],
        _meta: {
          'querymt/sessionLoadSnapshot.v1': {
            audit: {
              events: [
                { seq: 1, kind: { type: 'run_completed', data: { run_id: 'run-1', outcome: 'failed' } } },
                { seq: 2, kind: { type: 'assistant_message_stored', data: { message_id: 'a1', content: 'Partial response' } } }
              ]
            }
          }
        }
      },
      replay: [{
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Replay response' },
          messageId: 'a1'
        }
      } as SessionNotification]
    });
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-1', title: 'Failed run',
        cwd: '/tmp/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    await store.connectAgent('agent-1');

    await store.loadSession('agent-1', 'session-1');

    expect(store.activeSession.runState).toBe('failed');
    expect(store.activeSession.activityLabel).toBe('Turn failed.');
  });

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

  it('uses the canonical user chunk for applied steering instead of the lifecycle notification', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Model,
      active_run_id: 'run-1',
      steerable: true,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Use the smaller implementation';
    await store.connectAgent('agent-1');

    await store.sendPromptToActiveSession();

    expect(mockClient.steerSession).toHaveBeenCalledWith(
      'session-1',
      'Use the smaller implementation',
      [],
      expect.any(String),
      'run-1',
      'image'
    );
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(store.composerPrompt).toBe('');
    expect(store.activePendingInputs[0]).toEqual(expect.objectContaining({
      delivery: 'steer',
      state: 'accepted',
      runId: 'run-1'
    }));

    const inputId = store.activePendingInputs[0].inputId;
    const params: SessionInputStateNotification = {
      version: 1,
      session_id: 'session-1',
      input_id: inputId,
      delivery: SessionInputDelivery.Steer,
      state: SessionInputState.Applied,
      run_id: 'run-1',
      boundary: 'after_tools',
      latency_ms: 12
    };
    mockClient.emitExtensionNotification({ method: 'querymt/session/inputState', params });

    expect(store.activePendingInputs[0]).toEqual(expect.objectContaining({
      state: 'applied',
      boundary: 'after_tools',
      latencyMs: 12
    }));
    expect(store.activeSession.transcript).toEqual([]);

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Use the smaller implementation' },
        messageId: 'steering-message-1',
        _meta: { querymt: { client_prompt_id: inputId } }
      }
    } as SessionNotification);

    expect(store.activeSession.transcript).toEqual([
      expect.objectContaining({
        text: 'Use the smaller implementation',
        messageId: 'steering-message-1',
        clientPromptId: inputId
      })
    ]);
  });

  it.each([
    { delivery: 'steer' as const, notificationState: SessionInputState.Applied },
    { delivery: 'queue' as const, notificationState: SessionInputState.Started }
  ])('does not regress $delivery state when a lifecycle notification precedes the submit response', async ({ delivery, notificationState }) => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools,
      active_run_id: 'run-1',
      steerable: delivery === 'steer',
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    let resolveSubmit!: (result: SubmitInputResult) => void;
    const submit = new Promise<SubmitInputResult>((resolve) => { resolveSubmit = resolve; });
    const submitMock = delivery === 'steer' ? mockClient.steerSession : mockClient.queueSession;
    submitMock.mockReturnValueOnce(submit);
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Continue with the fix';
    await store.connectAgent('agent-1');
    store.setActiveComposerInputDelivery(delivery);

    const send = store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const clientInputId = submitMock.mock.calls[0][3] as string;
    mockClient.emitExtensionNotification({
      method: 'querymt/session/inputState',
      params: {
        version: 1,
        session_id: 'session-1',
        input_id: clientInputId,
        delivery: delivery === 'steer' ? SessionInputDelivery.Steer : SessionInputDelivery.Queue,
        state: notificationState,
        run_id: 'run-1'
      } satisfies SessionInputStateNotification
    });

    resolveSubmit(delivery === 'steer'
      ? { status: 'steered', data: { run_id: 'run-1', input_id: clientInputId, position: 1 } }
      : { status: 'queued', data: { input_id: clientInputId, position: 1 } });
    await send;

    if (delivery === 'steer') {
      expect(store.activePendingInputs).toEqual([expect.objectContaining({
        inputId: clientInputId,
        state: 'applied'
      })]);
    } else {
      expect(store.activePendingInputs).toEqual([]);
    }
  });

  it('does not resurrect a rekeyed queue item finalized before the submit response', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools,
      active_run_id: 'run-1',
      steerable: false,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    let resolveSubmit!: (result: SubmitInputResult) => void;
    mockClient.queueSession.mockReturnValueOnce(new Promise<SubmitInputResult>((resolve) => {
      resolveSubmit = resolve;
    }));
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Run tests next';
    await store.connectAgent('agent-1');
    store.setActiveComposerInputDelivery('queue');

    const send = store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(mockClient.queueSession).toHaveBeenCalledTimes(1));
    const clientInputId = mockClient.queueSession.mock.calls[0][3] as string;
    mockClient.emitExtensionNotification({
      method: 'querymt/session/inputState',
      params: {
        version: 1,
        session_id: 'session-1',
        input_id: 'server-input',
        delivery: SessionInputDelivery.Queue,
        state: SessionInputState.Started,
        run_id: 'run-2'
      } satisfies SessionInputStateNotification
    });

    resolveSubmit({ status: 'queued', data: { input_id: 'server-input', position: 1 } });
    await send;

    expect(clientInputId).not.toBe('server-input');
    expect(store.activePendingInputs).toEqual([]);
  });

  it('removes queued input through the backend and clears local pending state', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools,
      active_run_id: 'run-1',
      steerable: false,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Run tests next';
    await store.connectAgent('agent-1');
    store.setActiveComposerInputDelivery('queue');

    await store.sendPromptToActiveSession();
    const inputId = store.activePendingInputs[0].inputId;

    await store.discardQueuedInput(inputId);

    expect(mockClient.discardQueuedInput).toHaveBeenCalledWith('session-1', inputId);
    expect(store.activePendingInputs).toEqual([]);
  });

  it('does not surface a failed discard after switching sessions', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools,
      active_run_id: 'run-1',
      steerable: false,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    let rejectDiscard!: (error: Error) => void;
    mockClient.discardQueuedInput.mockReturnValueOnce(new Promise<DiscardQueuedInputResult>((_resolve, reject) => {
      rejectDiscard = reject;
    }));
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Run tests next';
    await store.connectAgent('agent-1');
    store.setActiveComposerInputDelivery('queue');
    await store.sendPromptToActiveSession();
    const inputId = store.activePendingInputs[0].inputId;

    const discard = store.discardQueuedInput(inputId);
    await vi.waitFor(() => expect(mockClient.discardQueuedInput).toHaveBeenCalledWith('session-1', inputId));
    store.activeSessionId = 'session-2';
    rejectDiscard(new Error('discard failed'));
    await discard;

    expect(store.error).toBeNull();
    expect(store.pendingInputsBySession['agent-1:session-1']).toEqual([
      expect.objectContaining({ inputId, discardPending: false })
    ]);
  });

  it('reconciles an already-started queue item as no longer pending', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools,
      active_run_id: 'run-1',
      steerable: false,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    mockClient.discardQueuedInput.mockResolvedValueOnce({
      status: 'not_pending',
      data: { input_id: 'ignored' }
    });
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Run tests next';
    await store.connectAgent('agent-1');
    store.setActiveComposerInputDelivery('queue');

    await store.sendPromptToActiveSession();
    const inputId = store.activePendingInputs[0].inputId;
    await store.discardQueuedInput(inputId);

    expect(store.activePendingInputs).toEqual([]);
  });

  it('rekeys queued input when the server returns a different input id', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools,
      active_run_id: 'run-1',
      steerable: false,
      pending_steering_count: 0,
      queued_input_count: 1,
      run_started_at_ms: 1
    });
    mockClient.queueSession.mockImplementationOnce(async (
      _sessionId: string,
      _prompt: string,
      _attachments: PromptAttachment[]
    ): Promise<SubmitInputResult> => ({
      status: 'queued',
      data: { input_id: 'server-input', position: 1 }
    }));
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Run tests next';
    store.promptAttachments = [{
      id: 'file-1',
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 4,
      data: 'dGV4dA=='
    }];
    await store.connectAgent('agent-1');
    store.setActiveComposerInputDelivery('queue');

    await store.sendPromptToActiveSession();

    expect(store.activePendingInputs).toEqual([expect.objectContaining({
      inputId: 'server-input',
      state: 'queued',
      prompt: 'Run tests next',
      attachments: [expect.objectContaining({ id: 'file-1' })],
      createdAt: expect.any(Number)
    })]);

    mockClient.emitExtensionNotification({
      method: 'querymt/session/inputState',
      params: {
        version: 1,
        session_id: 'session-1',
        input_id: 'server-input',
        delivery: SessionInputDelivery.Queue,
        state: SessionInputState.Discarded,
        reason: 'removed_by_user'
      } satisfies SessionInputStateNotification
    });

    expect(store.activePendingInputs).toEqual([]);
  });

  it.each([
    { name: 'started', state: SessionInputState.Started },
    { name: 'discarded', state: SessionInputState.Discarded }
  ])('removes queued input when its $name lifecycle notification arrives', async ({ state }) => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools,
      active_run_id: 'run-1',
      steerable: false,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = 'Run tests next';
    await store.connectAgent('agent-1');
    store.setActiveComposerInputDelivery('queue');

    await store.sendPromptToActiveSession();
    const inputId = store.activePendingInputs[0].inputId;
    mockClient.emitExtensionNotification({
      method: 'querymt/session/inputState',
      params: {
        version: 1,
        session_id: 'session-1',
        input_id: inputId,
        delivery: SessionInputDelivery.Queue,
        state,
        reason: state === SessionInputState.Discarded ? 'removed_by_user' : undefined
      } satisfies SessionInputStateNotification
    });

    expect(store.activePendingInputs).toEqual([]);
  });

  it('queues slash commands instead of steering an active run', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature: string) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockResolvedValue({
      phase: SessionRuntimePhase.Tools,
      active_run_id: 'run-1',
      steerable: true,
      pending_steering_count: 0,
      queued_input_count: 0,
      run_started_at_ms: 1
    });
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.composerPrompt = '/compact';
    await store.connectAgent('agent-1');

    await store.sendPromptToActiveSession();

    expect(mockClient.queueSession).toHaveBeenCalledWith(
      'session-1',
      '/compact',
      [],
      expect.any(String),
      'image'
    );
    expect(mockClient.steerSession).not.toHaveBeenCalled();
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

  it('reports a remote node upgrade-required prompt failure as a non-retryable upgrade message', async () => {
    mockClient.sendPrompt.mockRejectedValueOnce(
      new RequestError(-32603, "remote node 'nas' must be upgraded: it does not support session interactions", {
        category: 'remote_upgrade_required',
        node: 'nas',
        message: "remote node 'nas' must be upgraded: it does not support session interactions"
      })
    );
    const store = createStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';

    await store.sendPromptToActiveSession();

    expect(store.promptFailure).toEqual(
      expect.objectContaining({
        kind: 'remote_upgrade_required',
        title: 'Remote node must be upgraded',
        retryable: false,
        provider: null
      })
    );
    expect(store.promptFailure?.message).toContain('Remote node "nas" must be upgraded');
    expect(store.promptFailure?.details).toContain('remote_upgrade_required');
    expect(store.activeSession.activityLabel).toBe('Remote node must be upgraded');
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
            mimeType: 'image/png',
            blob: 'Y2hhcnQ='
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

    expect(store.activeSession.activityLabel).toBe('Turn completed.');
    expect(store.activeSession.runState).toBe('completed');
    expect(mockClient.getSessionRuntimeStatus).toHaveBeenCalledWith('session-1');
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
    expect(mockClient.loadSession).toHaveBeenCalledWith('session-1', '');
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
    expect(mockClient.loadSession).toHaveBeenCalledWith('session-1', '');
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
    expect(store.configs.find((config) => config.id === 'remote-agent')).toMatchObject({
      websocketUrl: '127.0.0.1:4040',
      websocketSecure: false
    });

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
            runtimeStatus: { phase: 'model', steerable: true, pending_steering_count: 0, queued_input_count: 0 }
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
            runtimeStatus: { phase: 'idle', steerable: false, pending_steering_count: 0, queued_input_count: 0 }
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
            runtimeStatus: { phase: 'model', steerable: true, pending_steering_count: 0, queued_input_count: 0 }
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
            runtimeStatus: { phase: 'idle', steerable: false, pending_steering_count: 0, queued_input_count: 0 }
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

  describe('elicitation recovery on reconnect', () => {
    function websocketStore() {
      const store = createStore();
      store.configs = [
        {
          id: 'agent-1',
          name: 'QMTCODE',
          transport: 'websocket',
          commandLine: '',
          websocketUrl: '127.0.0.1:3030',
          enabled: true,
          autoStart: true
        }
      ];
      return store;
    }

    function recoveryElicitation(sessionId: string, elicitationId: string) {
      return {
        mode: 'form' as const,
        sessionId,
        message: `Choose a target (${elicitationId})`,
        _meta: { querymt: { elicitation_id: elicitationId, source: 'builtin:question' } },
        requestedSchema: {
          type: 'object',
          title: 'Target',
          properties: {
            selection: {
              type: 'string',
              title: 'Target',
              oneOf: [{ const: 'prod', title: 'Production' }]
            }
          },
          required: ['selection']
        }
      };
    }

    async function seedOfflineCards(sessionId: string, elicitationIds: string[]) {
      const firstClient = createDistinctMockClient();
      vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
        return firstClient as never;
      });
      const store = websocketStore();
      await store.connectAgent('agent-1');

      const deliveries = elicitationIds.map((elicitationId) =>
        firstClient.elicit(recoveryElicitation(sessionId, elicitationId)) as Promise<unknown>
      );
      const settled = deliveries.map(() => ({ resolved: false }));
      deliveries.forEach((delivery, index) => {
        void delivery.then(() => {
          settled[index].resolved = true;
        });
      });
      return { store, firstClient, settled };
    }

    it('recovers an offline question after reconnect and answers on the new request', async () => {
      vi.useFakeTimers();
      try {
        const sessionId = 'recover-session-1';
        const { store, firstClient, settled } = await seedOfflineCards(sessionId, ['elicit-keep-1']);
        const card = inboxStore.pendingElicitationsForSession('agent-1', sessionId)[0];
        inboxStore.updateField(card.id, 'selection', 'prod');

        firstClient.emitConnectionLoss('WebSocket closed (code 1006).');
        expect(inboxStore.items.find((item) => item.id === card.id)?.offline).toBe(true);

        const reconnected = createDistinctMockClient();
        reconnected.supportsElicitationRecovery = vi.fn(() => true);
        reconnected.recoverPendingElicitations = vi.fn(async () => [
          { sessionId, elicitationIds: ['elicit-keep-1'] }
        ]);
        vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
          return reconnected as never;
        });
        await store.connectAgent('agent-1');

        expect(reconnected.recoverPendingElicitations).toHaveBeenCalledTimes(1);
        expect(inboxStore.items.find((item) => item.id === card.id)?.status).toBe('pending');

        const redelivered = reconnected.elicit(recoveryElicitation(sessionId, 'elicit-keep-1'));
        const rebound = inboxStore.pendingElicitationsForSession('agent-1', sessionId);
        expect(rebound).toHaveLength(1);
        expect(rebound[0].id).toBe(card.id);
        expect(rebound[0].offline).toBe(false);
        expect(rebound[0].formFields?.find((field) => field.key === 'selection')?.value).toBe('prod');

        await inboxStore.handleAction(card.id, 'accept');
        await expect(redelivered).resolves.toEqual({ action: 'accept', content: { selection: 'prod' } });
        await Promise.resolve();
        expect(settled[0].resolved).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('resolves stale offline cards against the authoritative snapshot without fabricating answers', async () => {
      vi.useFakeTimers();
      try {
        const sessionId = 'stale-session-1';
        const { store, firstClient, settled } = await seedOfflineCards(sessionId, [
          'elicit-still-pending',
          'elicit-gone'
        ]);
        firstClient.emitConnectionLoss('WebSocket closed (code 1006).');

        const reconnected = createDistinctMockClient();
        reconnected.supportsElicitationRecovery = vi.fn(() => true);
        reconnected.recoverPendingElicitations = vi.fn(async () => [
          { sessionId, elicitationIds: ['elicit-still-pending'] }
        ]);
        vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
          return reconnected as never;
        });
        await store.connectAgent('agent-1');

        const kept = inboxStore.items.find(
          (item) => item.sessionId === sessionId && item.detail.includes('elicit-still-pending')
        );
        const stale = inboxStore.items.find(
          (item) => item.sessionId === sessionId && item.detail.includes('elicit-gone')
        );
        expect(kept?.status).toBe('pending');
        expect(stale?.status).toBe('resolved');
        expect(stale?.actions).toEqual([]);
        expect(stale?.resolution).toBe('No longer pending');
        expect(settled.every((delivery) => !delivery.resolved)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reconciles background sessions without activating them or starting a run', async () => {
      vi.useFakeTimers();
      try {
        const sessionId = 'background-session-1';
        const { store, firstClient } = await seedOfflineCards(sessionId, ['elicit-background']);
        const activeSessionBefore = store.activeSessionId;
        firstClient.emitConnectionLoss('WebSocket closed (code 1006).');

        const reconnected = createDistinctMockClient();
        reconnected.supportsElicitationRecovery = vi.fn(() => true);
        reconnected.recoverPendingElicitations = vi.fn(async () => [
          { sessionId, elicitationIds: [] }
        ]);
        vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
          return reconnected as never;
        });
        await store.connectAgent('agent-1');

        const card = inboxStore.items.find((item) => item.sessionId === sessionId);
        expect(card?.status).toBe('resolved');
        expect(card?.resolution).toBe('No longer pending');
        expect(store.activeSessionId).toBe(activeSessionBefore);
        expect(store.activeSession?.sessionId ?? null).not.toBe(sessionId);
        expect(store.sessionsByAgent['agent-1'] ?? []).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('recovers pending elicitations after a UI refresh with no retained cards', async () => {
      vi.useFakeTimers();
      try {
        const sessionId = 'refresh-session-1';
        // A refreshed UI is a new store with an empty inbox; only the agent
        // and its pending question persist across the reload.
        const store = websocketStore();
        const reconnected = createDistinctMockClient();
        reconnected.supportsElicitationRecovery = vi.fn(() => true);
        reconnected.recoverPendingElicitations = vi.fn(async () => [
          { sessionId, elicitationIds: ['elicit-refresh-1'] }
        ]);
        vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
          return reconnected as never;
        });
        await store.connectAgent('agent-1');

        expect(reconnected.recoverPendingElicitations).toHaveBeenCalledTimes(1);

        // The agent re-delivers the question on the fresh connection; a
        // fresh actionable card appears in the previously empty inbox.
        const redelivered = reconnected.elicit(recoveryElicitation(sessionId, 'elicit-refresh-1'));
        const cards = inboxStore.pendingElicitationsForSession('agent-1', sessionId);
        expect(cards).toHaveLength(1);
        expect(cards[0].status).toBe('pending');
        expect(cards[0].offline).toBeUndefined();

        inboxStore.updateField(cards[0].id, 'selection', 'prod');
        await inboxStore.handleAction(cards[0].id, 'accept');
        await expect(redelivered).resolves.toEqual({ action: 'accept', content: { selection: 'prod' } });
      } finally {
        vi.useRealTimers();
      }
    });

    function recoveryPermission(sessionId: string, interactionId: string) {
      return {
        sessionId,
        _meta: { querymt: { interaction_id: interactionId } },
        toolCall: { toolCallId: `call-${interactionId}`, title: 'Run shell', kind: 'execute' as const },
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
          { optionId: 'reject_once', name: 'Reject once', kind: 'reject_once' as const }
        ]
      };
    }

    async function seedOfflinePermissions(sessionId: string, interactionIds: string[]) {
      const firstClient = createDistinctMockClient();
      vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
        return firstClient as never;
      });
      const store = websocketStore();
      await store.connectAgent('agent-1');
      const settled = interactionIds.map(() => ({ resolved: false }));
      interactionIds.forEach((interactionId, index) => {
        void (firstClient.permission(recoveryPermission(sessionId, interactionId)) as Promise<unknown>).then(() => {
          settled[index].resolved = true;
        });
      });
      return { store, firstClient, settled };
    }

    it('keeps a still-pending permission and retires one answered elsewhere after reconnect', async () => {
      vi.useFakeTimers();
      try {
        const sessionId = 'perm-session-1';
        const { store, firstClient, settled } = await seedOfflinePermissions(sessionId, ['perm-keep', 'perm-gone']);
        firstClient.emitConnectionLoss('WebSocket closed (code 1006).');
        expect(
          inboxStore.items.filter((item) => item.type === 'permission' && item.offline === true)
        ).toHaveLength(2);

        const reconnected = createDistinctMockClient();
        reconnected.supportsElicitationRecovery = vi.fn(() => true);
        reconnected.recoverPendingElicitations = vi.fn(async () => [
          { sessionId, elicitationIds: ['perm-keep'] }
        ]);
        vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
          return reconnected as never;
        });
        await store.connectAgent('agent-1');

        const permissions = inboxStore.items.filter((item) => item.type === 'permission');
        expect(permissions.filter((item) => item.status === 'resolved')).toHaveLength(1);
        expect(permissions.find((item) => item.status === 'resolved')?.resolution).toBe('No longer pending');

        const redelivered = reconnected.permission(recoveryPermission(sessionId, 'perm-keep'));
        const kept = inboxStore.items.filter((item) => item.type === 'permission' && item.status === 'pending');
        expect(kept).toHaveLength(1);
        expect(kept[0].offline).toBe(false);
        await inboxStore.handleAction(kept[0].id, 'allow_once');
        await expect(redelivered).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow_once' } });
        await Promise.resolve();
        expect(settled.every((delivery) => !delivery.resolved)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('retires an offline permission when the agent reports an empty pending set (run cancelled)', async () => {
      vi.useFakeTimers();
      try {
        const sessionId = 'perm-session-2';
        const { store, firstClient, settled } = await seedOfflinePermissions(sessionId, ['perm-cancelled']);
        firstClient.emitConnectionLoss('WebSocket closed (code 1006).');

        const reconnected = createDistinctMockClient();
        reconnected.supportsElicitationRecovery = vi.fn(() => true);
        reconnected.recoverPendingElicitations = vi.fn(async () => [{ sessionId, elicitationIds: [] }]);
        vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
          return reconnected as never;
        });
        await store.connectAgent('agent-1');

        const card = inboxStore.items.find((item) => item.sessionId === sessionId);
        expect(card?.status).toBe('resolved');
        expect(card?.actions).toEqual([]);
        expect(settled.every((delivery) => !delivery.resolved)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows a remote-hosted, permission-only pending request after a UI refresh', async () => {
      vi.useFakeTimers();
      try {
        const sessionId = 'remote-perm-session';
        // A refreshed UI has an empty inbox; the agent keeps the permission pending
        // and reports it through the same recovery flow as for a local session.
        const store = websocketStore();
        const reconnected = createDistinctMockClient();
        reconnected.supportsElicitationRecovery = vi.fn(() => true);
        reconnected.recoverPendingElicitations = vi.fn(async () => [
          { sessionId, elicitationIds: ['perm-remote'] }
        ]);
        vi.mocked(DesktopAcpClient).mockImplementationOnce(function () {
          return reconnected as never;
        });
        await store.connectAgent('agent-1');
        expect(reconnected.recoverPendingElicitations).toHaveBeenCalledTimes(1);

        const response = reconnected.permission(recoveryPermission(sessionId, 'perm-remote'));
        const cards = inboxStore.items.filter((item) => item.type === 'permission' && item.status === 'pending');
        expect(cards).toHaveLength(1);
        expect(cards[0].sessionId).toBe(sessionId);
        expect(cards[0].actions?.map((action) => action.id)).toEqual(['allow_once', 'reject_once']);

        await inboxStore.handleAction(cards[0].id, 'reject_once');
        await expect(response).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'reject_once' } });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('AgentsStore agent-scoped launch model defaults', () => {
  const sol: ModelEntry = { id: 'codex/gpt-5.6-sol', provider: 'codex', model: 'gpt-5.6-sol', label: 'Sol' };
  const grok: ModelEntry = { id: 'xai/grok-4.6', provider: 'xai', model: 'grok-4.6', label: 'Grok' };
  const glm: ModelEntry = { id: 'zai/glm-5.3-flash', provider: 'zai', model: 'glm-5.3-flash', label: 'GLM' };

  function setup() {
    localStorage.clear();
    const store = createStore();
    store.composerModeId = 'build';
    store.composerReasoningId = 'auto';
    store.sessionsByAgent = {
      'agent-1': [{
        agentId: 'agent-1', agentName: 'QMTCODE', sessionId: 'session-a', title: 'session-a', cwd: '/tmp/work',
        updatedAt: '2026-09-07T20:00:00Z', runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', status: 'idle'
      }]
    };
    return store;
  }

  it('scopes launch model selections per agent without leaking across agents', async () => {
    const store = setup();
    store.configs = [
      ...store.configs,
      {
        id: 'agent-2',
        name: 'SECOND',
        transport: 'stdio',
        commandLine: '/usr/local/bin/qmtcode --acp',
        enabled: true,
        autoStart: true
      }
    ];
    store.recentModelsByAgent = { 'agent-1': [grok.id], 'agent-2': [glm.id] };
    mockClient.refreshAndListModels.mockImplementation(async () => [sol, grok, glm]);

    await store.refreshModelsForAgent('agent-1');
    await store.refreshModelsForAgent('agent-2');

    expect(store.getLaunchModelId('agent-1')).toBe(grok.id);
    expect(store.getLaunchModelId('agent-2')).toBe(glm.id);

    store.setLaunchModel('agent-1', sol.id);
    expect(store.getLaunchModelId('agent-1')).toBe(sol.id);
    expect(store.getLaunchModelId('agent-2')).toBe(glm.id);
    expect(store.getLaunchModelId(null)).toBe('');
  });

  it('initializes from the first available recent entry and falls back to the catalog default', async () => {
    const store = setup();
    store.recentModelsByAgent = { 'agent-1': [grok.id] };
    mockClient.refreshAndListModels.mockResolvedValueOnce([sol, grok, glm]);
    await store.refreshModelsForAgent('agent-1');
    expect(store.getLaunchModelId('agent-1')).toBe(grok.id);

    // Stale recent history falls back to the catalog default.
    const store2 = setup();
    store2.recentModelsByAgent = { 'agent-1': [getModelSelectionKey({ ...grok, node_id: 'offline-node' })] };
    mockClient.refreshAndListModels.mockResolvedValueOnce([sol, grok, glm]);
    await store2.refreshModelsForAgent('agent-1');
    expect(store2.getLaunchModelId('agent-1')).toBe(sol.id);

    // An empty catalog leaves the selection unset.
    const store3 = setup();
    store3.recentModelsByAgent = { 'agent-1': [grok.id] };
    await store3.refreshModelsForAgent('agent-1');
    expect(store3.getLaunchModelId('agent-1')).toBe('');
  });

  it('keeps an explicit selection while available and revalidates on catalog refresh', async () => {
    const store = setup();
    store.recentModelsByAgent = { 'agent-1': [glm.id] };
    mockClient.refreshAndListModels.mockResolvedValueOnce([sol, grok, glm]);
    await store.refreshModelsForAgent('agent-1');
    store.setLaunchModel('agent-1', grok.id);

    // Refresh where the explicit selection is still available: kept.
    await store.refreshModelsForAgent('agent-1');
    expect(store.getLaunchModelId('agent-1')).toBe(grok.id);

    // Refresh where it disappeared: re-resolve through recent history.
    mockClient.refreshAndListModels.mockResolvedValueOnce([sol, glm]);
    await store.refreshModelsForAgent('agent-1');
    expect(store.getLaunchModelId('agent-1')).toBe(glm.id);
  });

  it('saves the confirmed launch preference after a successful session creation', async () => {
    const store = setup();
    store.recentModelsByAgent = { 'agent-1': [grok.id] };
    mockClient.refreshAndListModels.mockResolvedValueOnce([sol, grok, glm]);
    await store.refreshModelsForAgent('agent-1');
    store.setComposerMode('plan');
    store.setComposerReasoning('high');
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-b', configOptions: [] });
    mockClient.setSessionConfigOption.mockResolvedValue([]);

    const sessionId = await store.createSession('agent-1');
    expect(sessionId).toBe('session-b');

    expect(store.getSessionModePreference('agent-1', 'session-b', 'plan')).toEqual({
      modelId: grok.id,
      reasoningId: 'high'
    });
    // The explicit launch model write also updated recency.
    expect(store.recentModelsByAgent['agent-1'][0]).toBe(grok.id);
  });

  it('does not save launch preferences when the model write is rejected', async () => {
    const store = setup();
    store.recentModelsByAgent = { 'agent-1': [grok.id] };
    mockClient.refreshAndListModels.mockResolvedValueOnce([sol, grok, glm]);
    await store.refreshModelsForAgent('agent-1');
    store.setComposerMode('plan');
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-b', configOptions: [] });
    mockClient.setSessionConfigOption.mockRejectedValue(new Error('Model rejected'));

    expect(await store.createSession('agent-1')).toBeNull();
    expect(store.getSessionModePreference('agent-1', 'session-b', 'plan')).toBeUndefined();
    expect(store.error).toBe('Model rejected');
  });

  it('does not reorder recent models when a mode transition restores a saved preference', async () => {
    const store = setup();
    store.recentModelsByAgent = { 'agent-1': [grok.id, sol.id] };
    store.modelsByAgent = { 'agent-1': [sol, grok, glm] };
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-a';
    store.activeSession.sessionId = 'session-a';
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: [
        { id: 'mode', name: 'Mode', type: 'select', currentValue: 'build', options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }] },
        { id: 'model', name: 'Model', type: 'select', currentValue: sol.id, options: [sol, grok, glm].map((model) => ({ value: model.id, name: model.label ?? model.model })) }
      ] },
      replay: []
    });
    await store.loadSession('agent-1', 'session-a');
    mockClient.setSessionConfigOption
      .mockResolvedValueOnce({ id: 'mode', name: 'Mode', type: 'select', currentValue: 'plan', options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }] } as never)
      .mockResolvedValueOnce({ id: 'model', name: 'Model', type: 'select', currentValue: grok.id, options: [sol, grok, glm].map((model) => ({ value: model.id, name: model.label ?? model.model })) } as never);

    // Saved plan preference restores grok; recency must keep grok first
    // because restore writes are not explicit user selections.
    await store.setSessionMode('agent-1', 'session-a', 'plan');

    expect(store.recentModelsByAgent['agent-1']).toEqual([grok.id, sol.id]);
  });
});

describe('session header freshness and context usage', () => {
  function summary(updatedAt: string | null) {
    return {
      agentId: 'agent-1',
      agentName: 'QMTCODE',
      sessionId: 'session-1',
      title: 'Live',
      cwd: '/tmp/work',
      updatedAt,
      runtimeId: 'agent-1',
      runtimeName: 'QMTCODE',
      source: 'acp' as const,
      status: 'idle' as const
    };
  }

  it('keeps live activity timestamps when a stale session list refresh lands', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [summary('2020-01-01T00:00:00Z')] };
    await store.connectAgent('agent-1');

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'live-1',
        content: { type: 'text', text: 'Working' }
      }
    });

    const liveStamp = store.sessionsByAgent['agent-1'].find((entry) => entry.sessionId === 'session-1')!.updatedAt;
    expect(liveStamp).not.toBe('2020-01-01T00:00:00Z');

    mockClient.listSessions.mockResolvedValueOnce({
      sessions: [{ sessionId: 'session-1', title: 'Live', cwd: '/tmp/work', updatedAt: '2020-01-01T00:00:00Z' }]
    });
    await store.refreshSessionsForAgent('agent-1');

    expect(store.sessionsByAgent['agent-1'].find((entry) => entry.sessionId === 'session-1')!.updatedAt).toBe(liveStamp);
  });

  it('coalesces a burst into one summary pass and skips activity-only bumps inside the throttle window', async () => {
    vi.useFakeTimers();
    const store = createStore();
    await store.connectAgent('agent-1');
    store.sessionsByAgent = { 'agent-1': Array.from({ length: 7000 }, (_, index) => ({ ...summary('2026-01-01T00:00:00Z'), sessionId: `session-${index}` })) };
    store.sessionCatalog = store.sessionsByAgent['agent-1'].slice();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'session-1';
    store.activeSession.sessionId = 'session-1';
    const summaries = vi.spyOn(store as unknown as { upsertWorkspaceSessions(agentId: string, sessions: DesktopSessionSummary[]): void }, 'upsertWorkspaceSessions');
    for (let index = 0; index < 100; index++) {
      mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
        sessionUpdate: index % 2 ? 'agent_thought_chunk' : 'agent_message_chunk',
        messageId: `chunk-${index}`, content: { type: 'text', text: `delta-${index}` }
      } });
    }
    expect(summaries).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20);
    // The batched pass only bumps updatedAt (status/title unchanged) within the throttle window,
    // so it must not rebuild the session lists again.
    expect(summaries).toHaveBeenCalledOnce();
    expect(store.activeSession.transcript).toHaveLength(100);
    expect(store.sessionCatalog.find((session) => session.sessionId === 'session-1')?.status).toBe('thinking');
    expect(store.sessionCatalog.find((session) => session.sessionId === 'session-2')?.status).toBe('idle');
    expect(mockClient.listSessions).not.toHaveBeenCalled();
    summaries.mockRestore();
  });

  it('caches the derived session lists until their inputs change', async () => {
    const store = createStore();
    store.sessionsByAgent = {
      'agent-1': Array.from({ length: 500 }, (_, index) => ({ ...summary('2026-01-01T00:00:00Z'), sessionId: `session-${index}` }))
    };
    const first = store.sessions;
    expect(first).toHaveLength(500);
    // Repeated reads (layout, rail, pinned list) must not rebuild the list.
    expect(store.sessions).toBe(first);
    expect(store.pinnedSessions).toBe(store.pinnedSessions);

    store.sessionsByAgent = { 'agent-1': store.sessionsByAgent['agent-1'].slice(0, 10) };
    expect(store.sessions).not.toBe(first);
    expect(store.sessions).toHaveLength(10);
  });

  it('applies an activity-only updatedAt bump again once the throttle window has elapsed', async () => {
    vi.useFakeTimers();
    const store = createStore();
    await store.connectAgent('agent-1');
    store.sessionsByAgent = { 'agent-1': [summary('2020-01-01T00:00:00Z')] };
    const emit = (id: string) => mockClient.emitSessionUpdate({ sessionId: 'session-1', update: {
      sessionUpdate: 'agent_message_chunk', messageId: id, content: { type: 'text', text: id }
    } });
    emit('a');
    await vi.advanceTimersByTimeAsync(20);
    const first = store.sessionsByAgent['agent-1'].find((s) => s.sessionId === 'session-1')!.updatedAt;
    await vi.advanceTimersByTimeAsync(300);
    emit('b');
    await vi.advanceTimersByTimeAsync(20);
    expect(store.sessionsByAgent['agent-1'].find((s) => s.sessionId === 'session-1')!.updatedAt).toBe(first);
    await vi.advanceTimersByTimeAsync(1500);
    emit('c');
    await vi.advanceTimersByTimeAsync(20);
    expect(store.sessionsByAgent['agent-1'].find((s) => s.sessionId === 'session-1')!.updatedAt).not.toBe(first);
  });

  it('flushes queued chunks before metadata updates and drops batches owned by replaced clients', async () => {
    vi.useFakeTimers();
    const store = createStore();
    await store.connectAgent('agent-1');
    store.sessionsByAgent = { 'agent-1': [summary('2026-01-01T00:00:00Z'), { ...summary(null), sessionId: 'other' }] };
    for (const sessionId of ['session-1', 'other', 'session-1']) {
      mockClient.emitSessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', messageId: sessionId, content: { type: 'text', text: sessionId } } });
    }
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: { sessionUpdate: 'session_info_update', title: 'After chunks' } });
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'other')?.status).toBe('thinking');
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'session-1')).toMatchObject({ status: 'thinking', title: 'After chunks' });
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', messageId: 'old', content: { type: 'text', text: 'old' } } });
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', messageId: 'queued-old', content: { type: 'text', text: 'queued-old' } } });
    await store.connectAgent('agent-1', true);
    store.sessionsByAgent = { 'agent-1': [summary(null)] };
    await vi.advanceTimersByTimeAsync(20);
    expect(store.sessionsByAgent['agent-1'][0].status).toBe('idle');
    expect(store.sessionsByAgent['agent-1'][0].updatedAt).toBeNull();
  });

  it('preserves the title on timestamp-only session info updates', async () => {
    const store = createStore();
    await store.connectAgent('agent-1');
    store.sessionsByAgent = { 'agent-1': [summary('2026-01-01T00:00:00Z')] };
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: { sessionUpdate: 'session_info_update', updatedAt: '2026-02-01T00:00:00Z' } });
    expect(store.sessionsByAgent['agent-1'][0]).toMatchObject({ title: 'Live', updatedAt: '2026-02-01T00:00:00Z' });
  });

  it('keeps a title-only session info update from erasing the activity stamp', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [summary('2026-01-01T00:00:00Z')] };
    await store.connectAgent('agent-1');

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: { sessionUpdate: 'session_info_update', title: 'Renamed' }
    });

    const updated = store.sessionsByAgent['agent-1'].find((entry) => entry.sessionId === 'session-1')!;
    expect(updated.title).toBe('Renamed');
    expect(updated.updatedAt).toBe('2026-01-01T00:00:00Z');

    // Newer authoritative stamps still move forward.
    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: { sessionUpdate: 'session_info_update', title: 'Renamed again', updatedAt: '2026-02-01T00:00:00Z' }
    });
    expect(store.sessionsByAgent['agent-1'].find((entry) => entry.sessionId === 'session-1')!.updatedAt).toBe(
      '2026-02-01T00:00:00Z'
    );
  });

  function storeAccounting(session: Record<string, unknown> = {}) {
    return { version: 1, cycle: null, session: {
      knownSubtotalUsd: 0.1, completeTotalUsd: 0.1, complete: true, billing: 'metered', reasons: [],
      pricedAttempts: 1, excludedAttempts: 0, unresolvedAttempts: 0, incompleteAttempts: 0, unaccountedGenerations: 0,
      ...session
    } };
  }

  function loadSessionWithSnapshotUsage() {
    mockClient.loadSession.mockResolvedValueOnce({
      response: {
        configOptions: [],
        _meta: {
          'querymt/sessionLoadSnapshot.v1': {
            accounting: storeAccounting({ knownSubtotalUsd: 0.5, completeTotalUsd: 0.5 }),
            audit: {
              events: [
                { seq: 1, timestamp: 1_000, kind: { type: 'llm_request_start', data: {} } },
                {
                  seq: 2,
                  timestamp: 2_000,
                  kind: { type: 'llm_request_end', data: { context_tokens: 42_000, cumulative_cost_usd: 0.5 } }
                },
                { seq: 3, kind: { type: 'provider_changed', data: { context_limit: 200_000 } } }
              ]
            }
          }
        }
      },
      replay: [{
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'user_message_chunk',
          messageId: 'm1',
          content: { type: 'text', text: 'Hello' }
        }
      }]
    });
  }

  it('preserves snapshot context metrics when replay history wins the load selection', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [summary('2026-07-18T17:00:00Z')] };
    await store.connectAgent('agent-1');
    loadSessionWithSnapshotUsage();

    await store.loadSession('agent-1', 'session-1');

    expect(store.activeSession.transcript.some((item) => item.messageId === 'm1')).toBe(true);
    expect(store.activeSession.usage).toMatchObject({ contextUsed: 42_000, contextLimit: 200_000 });
    expect(store.activeSession.usage.accounting?.session.completeTotalUsd).toBe(0.5);
  });

  it('keeps the snapshot as the history baseline and merges one captured live update into it', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [summary('2026-07-18T17:00:00Z')] };
    await store.connectAgent('agent-1');
    mockClient.loadSession.mockResolvedValueOnce({
      response: {
        configOptions: [],
        _meta: {
          'querymt/sessionLoadSnapshot.v1': {
            audit: {
              events: [
                { seq: 1, timestamp: 1_000, kind: { type: 'prompt_received', data: { content: 'Plan the work' } } },
                {
                  seq: 2,
                  timestamp: 2_000,
                  kind: { type: 'assistant_message_stored', data: { message_id: 'm1', content: 'Here is the plan' } }
                }
              ]
            }
          }
        }
      },
      replay: [{
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'm2',
          content: { type: 'text', text: 'Streaming answer' }
        }
      }]
    });

    await store.loadSession('agent-1', 'session-1');

    // The full snapshot stays the baseline; the captured live update is merged
    // into it exactly once instead of replacing the snapshot history.
    expect(store.activeSession.transcript.map((item) => item.text)).toEqual([
      'Plan the work',
      'Here is the plan',
      'Streaming answer'
    ]);
  });

  it('lets live usage updates override the hydrated snapshot baseline', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [summary('2026-07-18T17:00:00Z')] };
    await store.connectAgent('agent-1');
    loadSessionWithSnapshotUsage();
    await store.loadSession('agent-1', 'session-1');

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'usage_update',
        used: 61_500,
        size: 200_000,
        cost: { amount: 0.75, currency: 'USD' },
        _meta: { querymt: { accounting: storeAccounting({ knownSubtotalUsd: 0.75, completeTotalUsd: 0.75 }) } }
      }
    });

    expect(store.activeSession.usage).toMatchObject({ contextUsed: 61_500, contextLimit: 200_000 });
    expect(store.activeSession.usage.accounting?.session.completeTotalUsd).toBe(0.75);
  });

  it('lets a newer cleared total win over the older snapshot complete total', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [summary('2026-07-18T17:00:00Z')] };
    await store.connectAgent('agent-1');
    loadSessionWithSnapshotUsage();
    await store.loadSession('agent-1', 'session-1');

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: { sessionUpdate: 'session_info_update', _meta: { querymt: { accounting: storeAccounting({
        knownSubtotalUsd: 0.6, completeTotalUsd: null, complete: false, incompleteAttempts: 1,
        reasons: [{ kind: 'valuation', reason: { kind: 'missing_rate', category: 'cache_read' } }] }) } } }
    });

    expect(store.activeSession.usage.accounting?.session).toMatchObject({ completeTotalUsd: null, knownSubtotalUsd: 0.6 });
  });

  it('shows standard ACP cost for agents without load snapshots or accounting', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [summary('2026-07-18T17:00:00Z')] };
    await store.connectAgent('agent-1');
    mockClient.loadSession.mockResolvedValueOnce({
      response: { configOptions: [] },
      replay: [{ sessionId: 'session-1', update: { sessionUpdate: 'usage_update', used: 100, size: 1000, cost: { amount: 0.3, currency: 'USD' } } }]
    });
    await store.loadSession('agent-1', 'session-1');
    expect(store.activeSession.usage).toMatchObject({ contextUsed: 100, standardCostUsd: 0.3 });
    expect(store.activeSession.usage.accounting).toBeUndefined();

    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: { sessionUpdate: 'usage_update', used: 200, size: 1000 } });
    expect(store.activeSession.usage).toMatchObject({ contextUsed: 200, standardCostUsd: 0.3 });
  });

  it('does not refresh the catalog for accounting-only session info updates', async () => {
    const store = createStore();
    store.sessionsByAgent = { 'agent-1': [summary('2026-01-01T00:00:00Z')] };
    await store.connectAgent('agent-1');
    const before = store.sessionsByAgent['agent-1'];
    const refresh = vi.spyOn(store as unknown as { scheduleSessionRefresh: (agentId: string) => void }, 'scheduleSessionRefresh');

    mockClient.emitSessionUpdate({
      sessionId: 'session-1',
      update: { sessionUpdate: 'session_info_update', _meta: { querymt: { accounting: storeAccounting() } } }
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(store.sessionsByAgent['agent-1']).toBe(before);
    mockClient.emitSessionUpdate({ sessionId: 'session-1', update: { sessionUpdate: 'session_info_update', title: 'Renamed' } });
    expect(refresh).toHaveBeenCalledWith('agent-1');
  });
});

describe('AgentsStore worktree sessions', () => {
  const capability = { supported: true, defaultBaseline: null, sourceSession: true, handoff: true, handoffSummary: true };

  function source(sessionId = 's1'): DesktopSessionSummary {
    return {
      agentId: 'agent-1', agentName: 'QMTCODE', sessionId, title: 'Source', cwd: '/tmp/work', updatedAt: '2026-10-01T00:00:00Z',
      runtimeId: 'agent-1', runtimeName: 'QMTCODE', source: 'acp', location: 'local', status: 'idle', relationshipKnown: true
    };
  }

  function info(sessionId: string, meta: Record<string, unknown> = {}, cwd = '/tmp/work'): SessionInfo {
    return { sessionId, title: sessionId, cwd, _meta: meta } as SessionInfo;
  }

  async function connectedStore() {
    const store = createStore();
    mockClient.getWorkspaceCapability.mockReturnValue(capability);
    await store.connectAgent('agent-1');
    store.setComposerAgent('agent-1');
    store.sessionsByAgent = { 'agent-1': [source()] };
    return store;
  }

  it('groups a worktree session under its source cwd while keeping the execution path', async () => {
    const store = createStore();
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('wt', {
      forkOrigin: 'worktree', parentSessionId: 's1',
      querymt: { workspace: { workspaceId: 'ws_1', branch: 'qmt/ws_1', checkoutPath: '/w/ws_1', sourceCwd: '/p/app' } }
    }, '/w/ws_1')] });
    await store.refreshSessionsForAgent('agent-1');

    expect(store.workspaceSessionSources['agent-1']['/p/app']?.sessions.map((session) => session.sessionId)).toEqual(['wt']);
    expect(store.workspaceSessionSources['agent-1']['/w/ws_1']).toBeUndefined();
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'wt')?.cwd).toBe('/w/ws_1');
  });

  it('keeps worktree metadata when a later list omits it', async () => {
    const store = createStore();
    const meta = { querymt: { workspace: { workspaceId: 'ws_1', branch: 'b', sourceCwd: '/p/app' } } };
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('wt', meta, '/w/ws_1')] });
    await store.refreshSessionsForAgent('agent-1');
    mockClient.listSessions.mockResolvedValueOnce({ sessions: [info('wt', {}, '/w/ws_1')] });
    await store.refreshSessionsForAgent('agent-1');
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'wt')?.workspace?.branch).toBe('b');
  });

  it('sends session workspace metadata only for a worktree choice on a capable local target', async () => {
    const store = await connectedStore();
    await store.createSession('agent-1');
    expect(mockClient.createSession).toHaveBeenLastCalledWith('/tmp/work', null);

    store.setComposerWorkspaceMode('worktree_local_changes');
    await store.createSession('agent-1');
    expect(mockClient.createSession).toHaveBeenLastCalledWith('/tmp/work', null, { execution: 'worktree', includeLocalChanges: true });

    store.setComposerWorkspaceMode('worktree');
    await store.createSession('agent-1');
    expect(mockClient.createSession).toHaveBeenLastCalledWith('/tmp/work', null, { execution: 'worktree' });
  });

  it('resets the workspace choice for remote targets and agents that cannot isolate', async () => {
    const store = await connectedStore();
    store.setComposerWorkspaceMode('worktree');
    expect(store.composerWorkspaceMode).toBe('worktree');
    store.setComposerTarget('node-1');
    expect(store.composerWorkspaceMode).toBe('local');
    store.setComposerTarget('local');
    mockClient.getWorkspaceCapability.mockReturnValue(null);
    store.setComposerWorkspaceMode('worktree');
    expect(store.composerWorkspaceMode).toBe('local');
    expect(store.canCreateWorktree('agent-1')).toBe(false);
  });

  it('creates a worktree session from a source and inserts an optimistic child', async () => {
    const store = await connectedStore();
    mockClient.createWorktreeSession.mockResolvedValueOnce({
      sessionId: 'wt-1', workspaceId: 'ws_1', branch: 'qmt/ws_1', checkoutPath: '/w/ws_1', sessionCwd: '/w/ws_1'
    });

    expect(await store.createWorktreeSessionFrom('agent-1', 's1', { name: 'feat' })).toBe('wt-1');
    expect(mockClient.createWorktreeSession).toHaveBeenCalledWith('/tmp/work', 's1', { name: 'feat' });
    const child = store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'wt-1');
    expect(child).toMatchObject({ parentSessionId: 's1', forkOrigin: 'worktree', cwd: '/w/ws_1', workspace: { branch: 'qmt/ws_1', sourceCwd: '/tmp/work' } });
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 's1')).toMatchObject({ hasChildren: true, title: 'Source' });
    expect(store.workspaceSessionSources['agent-1']['/tmp/work'].sessions.map((session) => session.sessionId)).toContain('wt-1');
    expect(store.error).toBeNull();
  });

  it('rejects conflicting create options and surfaces agent errors', async () => {
    const store = await connectedStore();
    expect(await store.createWorktreeSessionFrom('agent-1', 's1', { baseRef: 'main', includeLocalChanges: true })).toBeNull();
    expect(store.error).toContain('not both');
    expect(mockClient.createWorktreeSession).not.toHaveBeenCalled();

    mockClient.createWorktreeSession.mockRejectedValueOnce(new RequestError(-32602, 'x', { code: 'workspace_missing' }));
    expect(await store.createWorktreeSessionFrom('agent-1', 's1')).toBeNull();
    expect(store.error).toContain('missing');
    expect(store.worktreePending).toBe(false);
  });

  it('hands off a worktree, defaults to a clean handoff, and keeps the dialog error on refusal', async () => {
    const store = await connectedStore();
    store.sessionsByAgent = { 'agent-1': [{ ...source(), workspace: {
      workspaceId: 'ws_1', branch: 'b', checkoutPath: '/w', sourceCwd: '/tmp/work', baselineMode: null, lifecycle: 'ready', ownerSessionId: 's1', handedOffTo: null
    } }] };

    mockClient.handoffWorktreeSession.mockRejectedValueOnce(new RequestError(-32602, 'x', { code: 'owner_active' }));
    expect(await store.handoffWorktreeSession('agent-1', 's1')).toBeNull();
    expect(store.error).toContain('Stop the running turn');

    mockClient.handoffWorktreeSession.mockResolvedValueOnce({ sessionId: 'next', workspaceId: 'ws_1', branch: 'b', checkoutPath: '/w', sessionCwd: '/w' });
    expect(await store.handoffWorktreeSession('agent-1', 's1')).toBe('next');
    expect(mockClient.handoffWorktreeSession).toHaveBeenLastCalledWith('s1', {});
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 'next')?.parentSessionId).toBe('s1');
    expect(store.sessionsByAgent['agent-1'].find((session) => session.sessionId === 's1')?.workspace?.handedOffTo).toBe('next');
  });

  it('loads children per parent, caches them, and drops rows with another parent or delegates', async () => {
    const store = await connectedStore();
    mockClient.listSessionChildren.mockResolvedValueOnce({ sessions: [
      info('fork', { parentSessionId: 's1', forkOrigin: 'user' }),
      info('wt', { parentSessionId: 's1', forkOrigin: 'worktree' }),
      info('other', { parentSessionId: 'zzz', forkOrigin: 'user' }),
      info('delegate', { parentSessionId: 's1', forkOrigin: 'delegation' }),
      info('rootish')
    ] });
    const children = await store.loadSessionChildren('agent-1', 's1');
    expect(children.map((session) => session.sessionId).sort()).toEqual(['fork', 'wt']);
    const known = store.sessionsByAgent['agent-1'].map((session) => session.sessionId);
    expect(known).toEqual(expect.arrayContaining(['fork', 'wt']));
    expect(known).not.toContain('other');
    expect(known).not.toContain('delegate');
    expect(store.workspaceSessionSources['agent-1']?.['/tmp/work']?.sessions.map((session) => session.sessionId) ?? []).not.toContain('fork');
    await store.loadSessionChildren('agent-1', 's1');
    expect(mockClient.listSessionChildren).toHaveBeenCalledTimes(1);
    await store.loadSessionChildren('agent-1', 's1', true);
    expect(mockClient.listSessionChildren).toHaveBeenCalledTimes(2);
  });

  it('records read-only access from the load response and clears it on the next session', async () => {
    const store = await connectedStore();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: { querymt: {
      sessionAccess: { mode: 'read_only', reason: 'owner_transferred', ownerSessionId: 'next' }
    } } }, replay: [] });
    await store.loadSession('agent-1', 's1');
    expect(store.activeSessionAccess).toEqual({ mode: 'read_only', reason: 'owner_transferred', ownerSessionId: 'next' });
    expect(store.isSessionReadOnly('agent-1', 's1')).toBe(true);

    await store.loadSession('agent-1', 's2');
    expect(store.activeSessionAccess).toBeNull();
  });

  it('switches to read-only when a prompt is rejected with owner_transferred', async () => {
    mockClient.sendPrompt.mockRejectedValueOnce(new RequestError(-32602, 'x', { code: 'owner_transferred' }));
    const store = await connectedStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 's1';
    await store.sendPromptToActiveSession();
    expect(store.activeSessionAccess).toMatchObject({ mode: 'read_only', reason: 'owner_transferred' });
    expect(store.promptFailure).toBeNull();
    expect(store.activeSession.runState).not.toBe('failed');
  });

  it('records archived read-only access from the load response', async () => {
    const store = await connectedStore();
    mockClient.loadSession.mockResolvedValueOnce({ response: { configOptions: [], _meta: { querymt: {
      sessionAccess: { mode: 'read_only', reason: 'workspace_archived', workspaceId: 'ws_1' }
    } } }, replay: [] });
    await store.loadSession('agent-1', 's1');
    expect(store.activeSessionAccess).toEqual({ mode: 'read_only', reason: 'workspace_archived', ownerSessionId: null });
    expect(store.isSessionReadOnly('agent-1', 's1')).toBe(true);
  });

  it('switches to read-only without an owner when a prompt is rejected with workspace_archived', async () => {
    mockClient.sendPrompt.mockRejectedValueOnce(new RequestError(-32600, 'x', { code: 'workspace_archived' }));
    const store = await connectedStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 's1';
    store.composerPrompt = 'keep me';
    await store.sendPromptToActiveSession();
    expect(store.activeSessionAccess).toEqual({ mode: 'read_only', reason: 'workspace_archived', ownerSessionId: null });
    expect(store.promptFailure).toBeNull();
    expect(store.activeSession.runState).not.toBe('failed');
    expect(store.composerPrompt).toBe('keep me');
  });

  it('applies the workspace choice for the launcher agent even when no composer agent is set', async () => {
    const store = await connectedStore();
    store.setComposerAgent(null);
    store.setComposerWorkspaceMode('worktree');
    expect(store.composerWorkspaceMode).toBe('local');
    store.setComposerWorkspaceMode('worktree', 'agent-1');
    expect(store.composerWorkspaceMode).toBe('worktree');
  });

  it('resets the workspace choice when switching to an agent that cannot isolate', async () => {
    const store = await connectedStore();
    store.setComposerWorkspaceMode('worktree');
    mockClient.getWorkspaceCapability.mockReturnValue(null);
    store.setComposerAgent('agent-1');
    expect(store.composerWorkspaceMode).toBe('local');
  });

  it('refuses to prompt a read-only session', async () => {
    const store = await connectedStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 's1';
    store.activeSessionAccess = { mode: 'read_only', reason: 'owner_transferred', ownerSessionId: 'next' };
    store.composerPrompt = 'hello';
    mockClient.sendPrompt.mockClear();
    await store.sendPromptToActiveSession();
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(store.error).toBe('This session is read-only.');
  });

  it('restores the rejected prompt and learns the owner after owner_transferred', async () => {
    mockClient.sendPrompt.mockRejectedValueOnce(new RequestError(-32602, 'x', { code: 'owner_transferred' }));
    const store = await connectedStore();
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 's1';
    store.composerPrompt = 'keep me';
    mockClient.listSessions.mockResolvedValue({ sessions: [info('s1', {
      querymt: { workspace: { workspaceId: 'ws_1', branch: 'b', sourceCwd: '/tmp/work', handedOffTo: 'next' } }
    })] });
    await store.sendPromptToActiveSession();
    await vi.waitFor(() => expect(store.activeSessionAccess?.ownerSessionId).toBe('next'));
    expect(store.composerPrompt).toBe('keep me');
  });

  it('drops cached session children when the catalog is invalidated', async () => {
    const store = await connectedStore();
    store.sessionChildrenByParent = { 'agent-1:s1': [] };
    (store as unknown as { invalidateSessionCatalogCache(): void }).invalidateSessionCatalogCache();
    expect(store.sessionChildrenByParent).toEqual({});
  });
});

describe('AgentsStore pending launches', () => {
  it('sends only one session/new while a launch is creating, for prompt and blank starts', async () => {
    const store = createStore();
    let finish!: (response: { sessionId: string; configOptions: SessionConfigOption[] }) => void;
    mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

    const first = store.beginLaunch('agent-1');
    const second = store.beginLaunch('agent-1');
    store.composerPrompt = '';
    const blank = store.beginLaunch('agent-1');

    expect(first).toMatch(/^pending-launch-/);
    expect(second).toBe(first);
    expect(blank).toBe(first);
    expect(store.launching).toBe(true);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(mockClient.createSession).toHaveBeenCalledOnce();
    finish({ sessionId: 'session-1', configOptions: [] });
    await vi.waitFor(() => expect(store.launching).toBe(false));
  });

  it('shows the prompt and progress at once and clears the composer', async () => {
    const store = createStore();
    mockClient.createSession.mockImplementationOnce(() => new Promise(() => {}));

    const launchId = store.beginLaunch('agent-1')!;

    expect(store.composerPrompt).toBe('');
    expect(store.activeSessionId).toBe(launchId);
    expect(store.activeSession.transcript.map((item) => item.text)).toEqual(['Fix the failing tests']);
    expect(store.activeSession.activityLabel).toBe('Creating session…');
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
  });

  it.each(['local', 'remote'] as const)('still sends the first prompt when the route loads the %s session while setup is in flight', async (kind) => {
    const store = createStore();
    let finishConfig!: () => void;
    let finishPrompt!: (response: PromptResponse) => void;
    store.setComposerMode('plan');
    if (kind === 'remote') {
      store.setComposerTarget('node-1');
      mockClient.createRemoteSession.mockResolvedValueOnce({ session_id: 'remote-1', node_id: 'node-1', attached: true, config_options: modeOnly('build'), snapshot: { audit: { events: [] } } });
    } else {
      mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-1', configOptions: modeOnly('build') });
    }
    const sessionId = kind === 'remote' ? 'remote-1' : 'session-1';
    mockClient.setSessionConfigOption.mockImplementationOnce(() => new Promise((resolve) => {
      finishConfig = () => resolve(modeOnly('plan'));
    }));
    mockClient.sendPrompt.mockImplementationOnce(() => new Promise((resolve) => { finishPrompt = resolve; }));
    const launchId = store.beginLaunch('agent-1')!;
    // Setup is provably still running: the config write is pending and nothing was sent.
    await vi.waitFor(() => expect(finishConfig).toBeTypeOf('function'));
    expect(store.pendingLaunches[launchId].sessionId).toBe(sessionId);
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();

    // What the session route does as soon as the URL carries the real id.
    await store.loadSession('agent-1', sessionId);
    finishConfig();

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.sendPrompt.mock.calls[0][0]).toBe(sessionId);
    expect(mockClient.sendPrompt.mock.calls[0][1]).toBe('Fix the failing tests');
    expect(mockClient.loadSession).not.toHaveBeenCalled();
    expect(store.promptFailure).toBeNull();
    finishPrompt({ stopReason: 'end_turn' });
  });

  it('keeps creating and sends the prompt after the user navigates away', async () => {
    const store = createStore();
    let finish!: (response: { sessionId: string; configOptions: SessionConfigOption[] }) => void;
    mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    store.beginLaunch('agent-1');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));

    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'other-session';
    finish({ sessionId: 'session-1', configOptions: [] });

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.sendPrompt).toHaveBeenCalledWith('session-1', 'Fix the failing tests', [], expect.anything());
    expect(store.activeSessionId).toBe('other-session');
    expect(store.launching).toBe(false);
  });

  it('ignores later composer edits and uses the settings captured at click time', async () => {
    const store = createStore();
    let finish!: (response: { sessionId: string; configOptions: SessionConfigOption[] }) => void;
    mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    store.setComposerProfile('coding');
    store.beginLaunch('agent-1');
    store.setComposerProfile('other');
    store.setComposerPrompt('Something else');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish({ sessionId: 'session-1', configOptions: [] });

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.createSession).toHaveBeenCalledWith('/tmp/work', 'coding');
    expect(mockClient.sendPrompt.mock.calls[0][1]).toBe('Fix the failing tests');
    expect(store.composerPrompt).toBe('Something else');
  });

  it('keeps a failed launch on screen for retry, then hands the input back on discard', async () => {
    const store = createStore();
    mockClient.createSession.mockRejectedValueOnce(new Error('node unreachable'));

    const launchId = store.beginLaunch('agent-1')!;
    await vi.waitFor(() => expect(store.pendingLaunches[launchId]?.status).toBe('failed'));

    expect(store.pendingLaunches[launchId].error).toBe('node unreachable');
    expect(store.launching).toBe(false);
    expect(store.composerPrompt).toBe('');

    store.retryLaunch(launchId);
    expect(store.pendingLaunches[launchId].status).toBe('creating');
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.createSession).toHaveBeenCalledTimes(2);

    mockClient.createSession.mockRejectedValueOnce(new Error('again'));
    store.composerPrompt = 'Next';
    const second = store.beginLaunch('agent-1')!;
    await vi.waitFor(() => expect(store.pendingLaunches[second]?.status).toBe('failed'));
    store.discardLaunch(second);
    expect(store.composerPrompt).toBe('Next');
    expect(store.pendingLaunches[second]).toBeUndefined();
  });

  const modeOnly = (mode: string): SessionConfigOption[] => [{
    id: 'mode', name: 'Mode', type: 'select', currentValue: mode,
    options: [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]
  }];

  it('sends the first prompt even when the runtime status read fails or the user leaves mid-send', async () => {
    mockClient.supportsQuerymtFeature.mockImplementation((feature) => feature === 'steering');
    mockClient.getSessionRuntimeStatus.mockRejectedValue(new Error('runtime unavailable'));
    const store = createStore();

    store.beginLaunch('agent-1');

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.sendPrompt.mock.calls[0][1]).toBe('Fix the failing tests');
    expect(store.promptFailure).toBeNull();
  });

  it('delivers the first prompt in the background when the user leaves while the agent connects', async () => {
    const store = createStore();
    let finishConfig!: () => void;
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-1', configOptions: modeOnly('build') });
    store.setComposerMode('plan');
    mockClient.setSessionConfigOption.mockImplementationOnce(() => new Promise((resolve) => {
      finishConfig = () => resolve(modeOnly('plan'));
    }));
    const launchId = store.beginLaunch('agent-1')!;
    await vi.waitFor(() => expect(finishConfig).toBeTypeOf('function'));

    // Mid-setup the user opens another session.
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'other-session';
    finishConfig();

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.sendPrompt.mock.calls[0][0]).toBe('session-1');
    expect(store.activeSessionId).toBe('other-session');
    await vi.waitFor(() => expect(store.pendingLaunches[launchId].status).toBe('ready'));
    expect(store.pendingLaunches[launchId].attachments).toEqual([]);
  });

  it('blocks sends and cancel on the new session until the first prompt has left', async () => {
    const store = createStore();
    let finishConfig!: () => void;
    store.setComposerMode('plan');
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-1', configOptions: modeOnly('build') });
    mockClient.setSessionConfigOption.mockImplementationOnce(() => new Promise((resolve) => {
      finishConfig = () => resolve(modeOnly('plan'));
    }));
    const launchId = store.beginLaunch('agent-1')!;
    await vi.waitFor(() => expect(finishConfig).toBeTypeOf('function'));

    // The URL already carries the real id, but the first prompt has not left.
    expect(store.activeSessionId).toBe('session-1');
    expect(store.isLaunchSettingUp('agent-1', 'session-1')).toBe(true);
    expect(store.isLaunchSettingUp('agent-1', launchId)).toBe(true);
    store.composerPrompt = 'Second message';
    await store.sendPromptToActiveSession();
    await store.cancelActiveSession();
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(mockClient.cancelSession).not.toHaveBeenCalled();
    expect(store.composerPrompt).toBe('Second message');

    finishConfig();
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.sendPrompt.mock.calls[0][1]).toBe('Fix the failing tests');
    expect(store.isLaunchSettingUp('agent-1', 'session-1')).toBe(false);
  });

  it('keeps a background launch failure away from the composer and error of the session on screen', async () => {
    const store = createStore();
    let fail!: (error: Error) => void;
    mockClient.createSession.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const launchId = store.beginLaunch('agent-1')!;
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'));

    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'other-session';
    store.composerPrompt = 'Draft for the other session';
    store.error = null;
    fail(new Error('node unreachable'));

    await vi.waitFor(() => expect(store.pendingLaunches[launchId]?.status).toBe('failed'));
    expect(store.composerPrompt).toBe('Draft for the other session');
    expect(store.error).toBeNull();
    expect(store.abandonedLaunches.map((launch) => launch.id)).toEqual([launchId]);

    store.discardLaunch(launchId);
    expect(store.composerPrompt).toContain('Fix the failing tests');
    expect(store.composerPrompt).toContain('Draft for the other session');
    expect(store.abandonedLaunches).toEqual([]);
  });

  it('does not clear the error shown to the user when a background launch starts or fails', async () => {
    const store = createStore();
    mockClient.createSession.mockRejectedValueOnce(new Error('boom'));
    store.error = 'Something the user is reading';
    // beginLaunch itself resets the launcher error; a later background failure must not set it.
    const launchId = store.beginLaunch('agent-1')!;
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'other-session';
    await vi.waitFor(() => expect(store.pendingLaunches[launchId]?.status).toBe('failed'));
    expect(store.error).toBeNull();
  });

  it('fails the launch instead of sending the prompt to a replaced agent endpoint', async () => {
    const store = createStore();
    let finish!: (response: { sessionId: string; configOptions: SessionConfigOption[] }) => void;
    mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const launchId = store.beginLaunch('agent-1')!;
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));

    store.updateConfig('agent-1', { commandLine: 'other-agent' });
    finish({ sessionId: 'old-session', configOptions: [] });

    await vi.waitFor(() => expect(store.pendingLaunches[launchId]?.status).toBe('failed'));
    expect(mockClient.sendPrompt).not.toHaveBeenCalled();
    expect(store.pendingLaunches[launchId].error).toContain('connection changed');
    expect(store.pendingLaunches[launchId].prompt).toBe('Fix the failing tests');
  });

  it('retrying after an endpoint change creates a new session on the new endpoint', async () => {
    const store = createStore();
    let finish!: (response: { sessionId: string; configOptions: SessionConfigOption[] }) => void;
    mockClient.createSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const launchId = store.beginLaunch('agent-1')!;
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    store.updateConfig('agent-1', { commandLine: 'other-agent' });
    finish({ sessionId: 'old-session', configOptions: [] });
    await vi.waitFor(() => expect(store.pendingLaunches[launchId]?.status).toBe('failed'));

    store.retryLaunch(launchId);

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.createSession).toHaveBeenCalledTimes(2);
    expect(mockClient.sendPrompt.mock.calls[0][0]).toBe('session-1');
  });

  it('retrying a launch whose session exists resends only the prompt, never a second session/new', async () => {
    const store = createStore();
    mockClient.sendPrompt.mockRejectedValueOnce(new Error('send failed'));
    const launchId = store.beginLaunch('agent-1')!;
    // The user leaves right away, so the first prompt is delivered without the session view.
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'other-session';
    await vi.waitFor(() => expect(store.pendingLaunches[launchId]?.status).toBe('failed'));
    expect(store.pendingLaunches[launchId].sessionId).toBe('session-1');
    expect(store.pendingLaunches[launchId].prompt).toBe('Fix the failing tests');
    mockClient.createSession.mockClear();

    store.retryLaunch(launchId);

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledTimes(2));
    expect(mockClient.createSession).not.toHaveBeenCalled();
    expect(mockClient.sendPrompt.mock.calls[1][0]).toBe('session-1');
    await vi.waitFor(() => expect(store.pendingLaunches[launchId].status).toBe('ready'));
  });

  it('publishes a remote launch session even when the user left before it was created', async () => {
    const store = createStore();
    store.setComposerTarget('node-1');
    let confirm!: () => void;
    mockClient.createRemoteSession.mockImplementationOnce(() => new Promise((resolve) => {
      confirm = () => resolve({ session_id: 'remote-1', node_id: 'node-1', attached: true, config_options: [], snapshot: { audit: { events: [] } } });
    }));
    store.beginLaunch('agent-1');
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    store.activeAgentId = 'agent-1';
    store.activeSessionId = 'other-session';
    store.activeSession.sessionId = 'other-session';
    confirm();

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.sendPrompt.mock.calls[0][0]).toBe('remote-1');
    expect(store.activeSessionId).toBe('other-session');
    expect(store.sessionsByAgent['agent-1']?.some((session) => session.sessionId === 'remote-1' && session.location === 'remote')).toBe(true);
  });

  it('drops attachment payloads once the prompt has been handed to the session', async () => {
    const store = createStore();
    store.promptAttachments = [{ id: 'a1', name: 'note.txt', mimeType: 'text/plain', size: 3, data: 'YWJj' }];
    const launchId = store.beginLaunch('agent-1')!;
    expect(store.pendingLaunches[launchId].attachments).toHaveLength(1);

    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    expect(mockClient.sendPrompt.mock.calls[0][2]).toHaveLength(1);
    await vi.waitFor(() => expect(store.pendingLaunches[launchId].attachments).toEqual([]));
    expect(store.pendingLaunches[launchId].status).toBe('ready');
  });

  it('shows the setup state as submitting so it is never mistaken for a finished turn', async () => {
    const store = createStore();
    let finishConfig!: () => void;
    let finishPrompt!: (response: PromptResponse) => void;
    mockClient.supportsQuerymtFeature.mockImplementation((feature) => feature === 'steering');
    store.setComposerMode('plan');
    mockClient.createSession.mockResolvedValueOnce({ sessionId: 'session-1', configOptions: modeOnly('build') });
    mockClient.setSessionConfigOption.mockImplementationOnce(() => new Promise((resolve) => {
      finishConfig = () => resolve(modeOnly('plan'));
    }));
    mockClient.sendPrompt.mockImplementationOnce(() => new Promise((resolve) => { finishPrompt = resolve; }));
    store.beginLaunch('agent-1');
    await vi.waitFor(() => expect(finishConfig).toBeTypeOf('function'));

    expect(store.activeSession.runState).toBe('submitting');
    expect(store.activeSession.activityLabel).toBe('Setting up session…');
    finishConfig();
    await vi.waitFor(() => expect(mockClient.sendPrompt).toHaveBeenCalledOnce());
    // No "Turn completed." flash between setup and the running turn, and no runtime read to cause it.
    expect(store.activeSession.runState).toBe('thinking');
    expect(mockClient.getSessionRuntimeStatus).not.toHaveBeenCalled();
    finishPrompt({ stopReason: 'end_turn' });
  });

  it('never queries the server for a placeholder session', async () => {
    const store = createStore();
    mockClient.createSession.mockImplementationOnce(() => new Promise(() => {}));
    const launchId = store.beginLaunch('agent-1')!;

    await store.loadSession('agent-1', launchId);
    expect(await store.refreshSessionRuntime('agent-1', launchId)).toBeNull();
    await store.cancelActiveSession();

    expect(mockClient.loadSession).not.toHaveBeenCalled();
  });
});
