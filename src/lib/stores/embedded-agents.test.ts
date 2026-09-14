import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDED_AGENT_ID } from '$lib/platform/embedded-agent';
import { isEmbedded } from '$lib/platform/runtime';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] })),
  listSessions: vi.fn(async () => ({ sessions: [] })),
  listProfiles: vi.fn(async () => ({ profiles: [{ id: 'review', name: 'Review', description: 'Review changes.' }] })),
  listModels: vi.fn(async () => [{ id: 'test/model', provider: 'test', model: 'model' }]),
  startAgent: vi.fn(),
  listenAgentLogs: vi.fn()
}));

vi.mock('$lib/querymt/acp-client', () => ({
  DesktopAcpClient: vi.fn(function () {
    return {
      connect: mocks.connect,
      disconnect: vi.fn(async () => undefined),
      listSessions: mocks.listSessions,
      listProfiles: mocks.listProfiles,
      listModels: mocks.listModels,
      listAuthProviders: vi.fn(async () => []),
      getControlCapabilities: vi.fn(() => ({
        methods: ['querymt/profiles'],
        features: { auth: false, mesh: false }
      })),
      getControlHealth: vi.fn(() => ({ state: 'ready', summary: 'ready', missingMethods: [], missingFeatures: [] })),
      supportsQuerymtMethod: vi.fn((method: string) => method === 'querymt/profiles'),
      supportsQuerymtFeature: vi.fn(() => false),
      onConnectionLost: vi.fn(() => vi.fn()),
      onSessionUpdate: vi.fn(() => vi.fn()),
      onExtensionNotification: vi.fn(() => vi.fn()),
      onPermissionRequest: vi.fn(() => vi.fn()),
      onElicitationRequest: vi.fn(() => vi.fn())
    };
  })
}));

vi.mock('$native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$native')>()),
  getAgentLogs: vi.fn(async () => []),
  getAgentStatus: vi.fn(),
  listenAgentLogs: mocks.listenAgentLogs,
  restartAgent: vi.fn(),
  startAgent: mocks.startAgent,
  stopAgent: vi.fn(),
  validateWorkspaceDirectory: vi.fn(),
  drainAgentSessionUpdates: vi.fn(async () => [])
}));

beforeEach(() => {
  window.history.replaceState({}, '', 'http://localhost:3000/');
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe.runIf(isEmbedded)('AgentsStore embedded startup', () => {
  it('uses only the host-managed same-origin ACP agent and server profiles', async () => {
    const { AgentsStore } = await import('./agents.svelte');
    const store = new AgentsStore();

    await store.initialize();

    expect(store.configs).toEqual([
      expect.objectContaining({
        id: EMBEDDED_AGENT_ID,
        transport: 'websocket',
        websocketUrl: 'ws://localhost:3000/acp/ws'
      })
    ]);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.listSessions).toHaveBeenCalled();
    expect(mocks.listProfiles).toHaveBeenCalledOnce();
    expect(store.getProfileOptions()).toContainEqual({ id: 'review', label: 'Review', description: 'Review changes.' });
    expect(mocks.startAgent).not.toHaveBeenCalled();
    expect(mocks.listenAgentLogs).not.toHaveBeenCalled();
  }, 10_000);
});
