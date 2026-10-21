import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListSessionsRequest, ListSessionsResponse } from '@agentclientprotocol/sdk';
import type { AgentsStore } from './agents.svelte';
import { SESSION_CATALOG_STORAGE_KEY } from './session-catalog-cache';
import { EMBEDDED_AGENT_ID } from '$lib/platform/embedded-agent';
import { isEmbedded } from '$lib/platform/runtime';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] })),
  listSessions: vi.fn(async (_request?: ListSessionsRequest): Promise<ListSessionsResponse> => ({ sessions: [] })),
  runtime: vi.fn(async () => ({ phase: 'idle', steerable: false, pending_steering_count: 0, queued_input_count: 0 })),
  setLifecycle: vi.fn(async (session_id: string, patch: { resolved?: boolean; archived?: boolean }) => ({ session_id, resolved: patch.resolved ?? false, archived: patch.archived ?? false, resolved_at: null, archived_at: null })),
  setPinned: vi.fn(async (session_id: string, pinned: boolean) => ({ session_id, pinned, pinned_at: pinned ? '2026-10-20T20:00:00Z' : null })),
  pins: false,
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
      supportsSessionLifecycle: () => true,
      supportsSessionPins: () => mocks.pins,
      setSessionLifecycle: mocks.setLifecycle,
      setSessionPinned: mocks.setPinned,
      getSessionRuntimeStatus: mocks.runtime,
      listProfiles: mocks.listProfiles,
      listModels: mocks.listModels,
      getModelInfo: vi.fn(async () => ({})),
      listAuthProviders: vi.fn(async () => []),
      getControlCapabilities: vi.fn(() => ({
        methods: ['querymt/profiles'],
        features: { auth: false, mesh: false }
      })),
      getControlHealth: vi.fn(() => ({ state: 'ready', summary: 'ready', missingMethods: [], missingFeatures: [] })),
      supportsQuerymtMethod: vi.fn((method: string) => method === 'querymt/profiles' || method === 'querymt/session/runtimeState'),
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
  mocks.pins = false;
  mocks.listSessions.mockReset().mockResolvedValue({ sessions: [] });
});
const created: AgentsStore[] = [];
afterEach(() => { for (const store of created.splice(0)) store.dispose(); delete (document as { hidden?: boolean }).hidden; vi.unstubAllGlobals(); vi.useRealTimers(); });

function channels() {
  const ports = new Set<FakeChannel>();
  class FakeChannel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(_name: string) { ports.add(this); }
    postMessage(data: unknown) { for (const port of ports) if (port !== this) queueMicrotask(() => port.onmessage?.({ data })); }
    close() { ports.delete(this); }
  }
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  return ports;
}
function listed(sessionId: string, pinned = false) {
  return { sessionId, title: sessionId, cwd: '/work', _meta: { querymt: {
    lifecycle: { session_id: sessionId, resolved: false, archived: false, resolved_at: null, archived_at: null },
    pin: { pinned, pinned_at: pinned ? '2026-10-20T20:00:00Z' : null }
  } } };
}
async function twoTabs() {
  const { AgentsStore } = await import('./agents.svelte');
  const a = new AgentsStore(), b = new AgentsStore(); created.push(a, b);
  const startup = Promise.all([a.initialize(), b.initialize()]);
  await vi.advanceTimersByTimeAsync(5_000); await startup;
  return [a, b] as const;
}

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
    store.dispose();
  }, 10_000);

  it('coalesces full catalog and pinned pagination in two real stores while preserving warm persistence', async () => {
    vi.useFakeTimers(); channels();
    const [a, b] = await twoTabs();
    mocks.listSessions.mockClear();
    mocks.listSessions.mockImplementation(async (request) => {
      const pinned = !!(request?._meta?.querymt as { sessionFilters?: { pinned?: boolean } })?.sessionFilters?.pinned;
      return { sessions: [listed(request?.cursor ? 'two' : 'one', pinned)], nextCursor: request?.cursor ? undefined : 'next' };
    });
    const catalogs = Promise.all([a.refreshSessionCatalog(), b.refreshSessionCatalog()]);
    await vi.advanceTimersByTimeAsync(400); await catalogs;
    expect(mocks.listSessions).toHaveBeenCalledTimes(2);
    expect(a.sessionCatalog.map((row) => row.sessionId).sort()).toEqual(['one', 'two']);
    expect(b.sessionCatalog).toEqual(a.sessionCatalog);
    expect(window.localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)).toContain('two');
    const { AgentsStore } = await import('./agents.svelte');
    const late = new AgentsStore(); created.push(late);
    const joined = late.initialize(); await vi.advanceTimersByTimeAsync(5_000); await joined;
    mocks.listSessions.mockClear();
    await late.ensureSessionCatalog();
    expect(late.sessionCatalog).toHaveLength(2);
    expect(mocks.listSessions).not.toHaveBeenCalled();
    mocks.pins = true; mocks.listSessions.mockClear();
    const pins = Promise.all([a.ensurePinnedSessions(true), b.ensurePinnedSessions(true)]);
    await vi.advanceTimersByTimeAsync(400); await pins;
    expect(mocks.listSessions).toHaveBeenCalledTimes(2);
    expect(a.pinnedSessions).toHaveLength(2); expect(b.pinnedSessions).toEqual(a.pinnedSessions);
    a.activeAgentId = b.activeAgentId = EMBEDDED_AGENT_ID;
    a.activeSessionId = b.activeSessionId = 'one';
    await Promise.all([a.refreshSessionRuntime(), b.refreshSessionRuntime()]);
    expect(mocks.runtime).toHaveBeenCalledTimes(2);
  });

  it('keeps explicit full-discovery refresh fresh through every cursor page', async () => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs();
    let title = 'Old';
    mocks.listSessions.mockImplementation(async (request) => ({ sessions: [{ ...listed(request?.cursor ? 'two' : 'one'), title }], nextCursor: request?.cursor ? undefined : 'next' }));
    const first = a.refreshSessionsForAgent(EMBEDDED_AGENT_ID, true); await vi.advanceTimersByTimeAsync(300); await first;
    title = 'New'; mocks.listSessions.mockClear();
    const fresh = a.refreshSessionsForAgent(EMBEDDED_AGENT_ID, true); await vi.advanceTimersByTimeAsync(300); await fresh;
    expect(mocks.listSessions).toHaveBeenCalledTimes(2);
    expect(a.sessions.filter((row) => row.sessionId === 'two')[0].title).toBe('New');
  });

  it.each(['lifecycle', 'pin'] as const)('rejects late shared pages around an authoritative local %s mutation', async (mutation) => {
    vi.useFakeTimers(); channels(); const [a, b] = await twoTabs();
    mocks.listSessions.mockResolvedValue({ sessions: [listed('one')] });
    const seed = Promise.all([a.refreshSessionCatalog(), b.refreshSessionCatalog()]); await vi.advanceTimersByTimeAsync(200); await seed;
    let release!: (page: ListSessionsResponse) => void;
    mocks.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const late = Promise.all([a.refreshSessionCatalog(), b.refreshSessionCatalog()]); await vi.advanceTimersByTimeAsync(100);
    mocks.pins = true;
    const write = mutation === 'lifecycle' ? a.setSessionLifecycle(EMBEDDED_AGENT_ID, 'one', { resolved: true }) : a.setSessionPinned(a.sessions.find((row) => row.sessionId === 'one')!, true);
    await write;
    const committed = listed('one', mutation === 'pin');
    committed._meta.querymt.lifecycle.resolved = mutation === 'lifecycle';
    mocks.listSessions.mockResolvedValue({ sessions: [committed] });
    await vi.advanceTimersByTimeAsync(200);
    release({ sessions: [listed('one')] }); await late; await vi.advanceTimersByTimeAsync(100);
    const current = a.sessions.find((row) => row.sessionId === 'one')!;
    if (mutation === 'lifecycle') expect(current.lifecycle?.resolved).toBe(true);
    else expect(current.pin?.pinned).toBe(true);
    expect(a.sessionCatalogLoading).toBe(false); expect(b.sessionCatalogLoading).toBe(false);
    expect(a.sessionCatalogError).toBeNull(); expect(b.sessionCatalogError).toBeNull();
    expect(a.connectionStates[EMBEDDED_AGENT_ID]).toBe('initialized');
    expect(b.connectionStates[EMBEDDED_AGENT_ID]).toBe('initialized');
    expect(a.agentErrors[EMBEDDED_AGENT_ID]).toBeNull(); expect(b.agentErrors[EMBEDDED_AGENT_ID]).toBeNull();
    expect(a.error).toBeNull(); expect(b.error).toBeNull();
  });

  it.each(['local-pin', 'peer-lifecycle', 'profile'] as const)('supersedes a pending summary without losing the agent after %s and retries promptly', async (change) => {
    vi.useFakeTimers(); channels(); const [a, b] = await twoTabs();
    mocks.listSessions.mockResolvedValue({ sessions: [listed('one')] });
    const seed = Promise.all([a.refreshSessionCatalog(), b.refreshSessionCatalog()]); await vi.advanceTimersByTimeAsync(200); await seed;
    let release!: (page: ListSessionsResponse) => void;
    mocks.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = a.refreshSessionsForAgent(EMBEDDED_AGENT_ID); await vi.advanceTimersByTimeAsync(100);
    if (change === 'local-pin') { mocks.pins = true; await a.setSessionPinned(a.sessions[0], true); }
    else if (change === 'peer-lifecycle') await b.setSessionLifecycle(EMBEDDED_AGENT_ID, 'one', { resolved: true });
    else a.setComposerProfile('other-profile');
    release({ sessions: [listed('obsolete')] }); await pending; await vi.advanceTimersByTimeAsync(0);
    expect(a.connectionStates[EMBEDDED_AGENT_ID]).toBe('initialized');
    expect(a.connectedAgents).toHaveLength(1);
    expect(a.agentErrors[EMBEDDED_AGENT_ID]).toBeNull(); expect(a.error).toBeNull();
    const count = mocks.listSessions.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.listSessions.mock.calls.length).toBeGreaterThan(count);
    expect(a.sessions.some((row) => row.sessionId === 'obsolete')).toBe(false);
  });

  it('does not mark a superseded filtered-existence probe complete or wait 30s to retry', async () => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs();
    mocks.listSessions.mockResolvedValueOnce({ sessions: [] });
    let release!: (page: ListSessionsResponse) => void;
    mocks.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const read = a.refreshSessionCatalog(); await vi.advanceTimersByTimeAsync(200);
    a.setComposerProfile('new-profile'); release({ sessions: [] }); await read;
    expect(a.sessionCatalogLoading).toBe(false); expect(a.sessionCatalogError).toBeNull();
    const persisted = localStorage.getItem(SESSION_CATALOG_STORAGE_KEY);
    expect(persisted == null || !JSON.parse(persisted).entries.some((entry: { complete: boolean }) => entry.complete)).toBe(true);
    mocks.listSessions.mockResolvedValue({ sessions: [listed('new-profile-row')] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.sessionCatalog.some((row) => row.sessionId === 'new-profile-row')).toBe(true);
  });

  it('clears pin loading/error on a profile cancellation and retries the correct scope', async () => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs(); mocks.pins = true;
    let release!: (page: ListSessionsResponse) => void;
    mocks.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const read = a.ensurePinnedSessions(true); await vi.advanceTimersByTimeAsync(100);
    a.setComposerProfile('new-profile'); release({ sessions: [listed('obsolete', true)] }); await read;
    expect(a.pinnedSessionsLoading[EMBEDDED_AGENT_ID]).toBe(false);
    expect(a.pinnedSessionsErrors[EMBEDDED_AGENT_ID]).toBeNull();
    mocks.listSessions.mockResolvedValue({ sessions: [listed('current-pin', true)] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.pinnedSessions.map((row) => row.sessionId)).toEqual(['current-pin']);
  });

  it.each(['open', 'workspace'] as const)('rolls back a canceled %s page cursor and retries without a false error', async (kind) => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs();
    await a.setSessionLifecycle(EMBEDDED_AGENT_ID, 'one', { resolved: false });
    mocks.listSessions.mockResolvedValueOnce({ sessions: [listed('one')], nextCursor: 'next' });
    const seed = a.refreshSessionsForAgent(EMBEDDED_AGENT_ID); await vi.advanceTimersByTimeAsync(100); await seed;
    a.workspaceSessionSources = { [EMBEDDED_AGENT_ID]: { '/work': {
      agentId: EMBEDDED_AGENT_ID, agentName: 'QMTCODE', cwd: '/work', sessions: [], latestActivity: null,
      nextCursor: 'next', initialized: true, loading: false, error: null
    } } };
    let release!: (page: ListSessionsResponse) => void;
    mocks.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const load = kind === 'open' ? a.loadMoreOpenSessions() : a.loadWorkspaceSessions('/work');
    await vi.advanceTimersByTimeAsync(100);
    a.setComposerProfile('new-profile'); release({ sessions: [listed('obsolete')] }); await load;
    expect(a.openSessionsLoadError).toBeNull(); expect(a.openSessionsLoading).toBe(false);
    expect(a.workspaceSessionSources[EMBEDDED_AGENT_ID]['/work'].error).toBeNull();
    expect(a.workspaceSessionSources[EMBEDDED_AGENT_ID]['/work'].loading).toBe(false);
    mocks.listSessions.mockResolvedValue({ sessions: [listed('current')] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.sessions.some((row) => row.sessionId === 'current')).toBe(true);
    expect(a.sessions.some((row) => row.sessionId === 'obsolete')).toBe(false);
    expect(mocks.listSessions.mock.lastCall?.[0]?.cursor).toBe('next');
    expect(a.workspaceSessionSources[EMBEDDED_AGENT_ID]['/work'].error).toBeNull();
  });

  it('does not turn an old-profile transport rejection into a current agent failure', async () => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs();
    let reject!: (error: Error) => void;
    mocks.listSessions.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const read = a.refreshSessionsForAgent(EMBEDDED_AGENT_ID); await vi.advanceTimersByTimeAsync(100);
    a.setComposerProfile('new-profile'); reject(new Error('Old profile failure')); await read;
    expect(a.connectionStates[EMBEDDED_AGENT_ID]).toBe('initialized');
    expect(a.agentErrors[EMBEDDED_AGENT_ID]).toBeNull(); expect(a.error).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.listSessions.mock.calls.length).toBeGreaterThan(1);
  });

  it('defers and coalesces superseded reads while hidden, with at most one automatic retry per wave', async () => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs();
    const releases: Array<(page: ListSessionsResponse) => void> = [];
    mocks.listSessions.mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));
    const first = a.refreshSessionsForAgent(EMBEDDED_AGENT_ID); await vi.advanceTimersByTimeAsync(100);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    a.setComposerProfile('new-profile'); releases.shift()!({ sessions: [] }); await first;
    mocks.listSessions.mockClear(); await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.listSessions).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
    a.setComposerProfile('newer-profile'); releases.shift()!({ sessions: [] });
    await vi.advanceTimersByTimeAsync(1_000);
    // The visibility request and retry share the serialized list flight; they cannot replay unboundedly.
    expect(mocks.listSessions.mock.calls.length).toBeLessThanOrEqual(2);
    while (releases.length) { releases.shift()!({ sessions: [] }); await vi.advanceTimersByTimeAsync(0); }
    delete (document as { hidden?: boolean }).hidden;
  });

  it.each(['disconnect', 'dispose'] as const)('does not reconnect or retry after superseded pending work on %s', async (change) => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs();
    let release!: (page: ListSessionsResponse) => void;
    mocks.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const read = a.refreshSessionCatalog(); await vi.advanceTimersByTimeAsync(100);
    if (change === 'dispose') a.dispose(); else await a.stopConfiguredAgent(EMBEDDED_AGENT_ID);
    release({ sessions: [listed('obsolete')] }); await read;
    const calls = mocks.listSessions.mock.calls.length, connects = mocks.connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.listSessions).toHaveBeenCalledTimes(calls); expect(mocks.connect).toHaveBeenCalledTimes(connects);
    expect(a.sessionCatalogError).toBeNull(); expect(a.sessionCatalog.some((row) => row.sessionId === 'obsolete')).toBe(false);
  });

  it('still exposes genuine list, catalog, pin and page RPC failures', async () => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs();
    await a.setSessionLifecycle(EMBEDDED_AGENT_ID, 'one', { resolved: false });
    mocks.listSessions.mockRejectedValue(new Error('Real list failure'));
    const catalog = a.refreshSessionCatalog(); await vi.advanceTimersByTimeAsync(100); await catalog;
    expect(a.sessionCatalogError).toContain('Real list failure');
    mocks.pins = true;
    const pins = a.ensurePinnedSessions(true); await vi.advanceTimersByTimeAsync(100); await pins;
    expect(a.pinnedSessionsErrors[EMBEDDED_AGENT_ID]).toContain('Real list failure');
    const more = a.loadMoreOpenSessions(); await vi.advanceTimersByTimeAsync(100); await more;
    expect(a.openSessionsLoadError).toContain('Real list failure');
    const refresh = a.refreshSessionsForAgent(EMBEDDED_AGENT_ID); await vi.advanceTimersByTimeAsync(100); await refresh;
    expect(a.connectionStates[EMBEDDED_AGENT_ID]).toBe('failed');
    expect(a.agentErrors[EMBEDDED_AGENT_ID]).toBe('Real list failure');
    expect(a.error).toBe('Real list failure');
  });

  it.each(['replace', 'profile', 'dispose'] as const)('does not apply a page from an obsolete embedded source after %s', async (change) => {
    vi.useFakeTimers(); channels(); const [a] = await twoTabs();
    let release!: (page: ListSessionsResponse) => void;
    mocks.listSessions.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const read = a.refreshSessionCatalog(); await vi.advanceTimersByTimeAsync(100);
    if (change === 'replace') await a.connectAgent(EMBEDDED_AGENT_ID, true);
    else if (change === 'profile') a.setComposerProfile('other-profile');
    else a.dispose();
    release({ sessions: [listed('obsolete')] }); await read; await vi.advanceTimersByTimeAsync(100);
    expect(a.sessionCatalog.some((row) => row.sessionId === 'obsolete')).toBe(false);
  });
});
