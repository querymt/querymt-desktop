import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsStore } from './agents.svelte';

const mockClient = vi.hoisted(() => ({
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
  sendPrompt: vi.fn(async () => ({ stopReason: null })),
  getInitializeResponse: vi.fn(() => ({
    protocolVersion: 1,
    agentCapabilities: {},
    authMethods: []
  })),
  getControlCapabilities: vi.fn(() => null),
  getControlHealth: vi.fn(() => ({ state: 'unknown', summary: 'unknown', missingMethods: [], missingFeatures: [] })),
  listModels: vi.fn(async () => []),
  getModelInfo: vi.fn(async () => ({})),
  onSessionUpdate: vi.fn(() => undefined),
  onExtensionNotification: vi.fn(() => undefined),
  onPermissionRequest: vi.fn(() => undefined),
  onElicitationRequest: vi.fn(() => undefined),
  setSessionConfigOption: vi.fn(async () => [])
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
});

describe('AgentsStore prompt session start', () => {
  it('opens a new active session with the user prompt rendered while the agent reply is pending', async () => {
    let resolvePrompt!: () => void;
    mockClient.sendPrompt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrompt = () => resolve({ stopReason: null });
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
});
