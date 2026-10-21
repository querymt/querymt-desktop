import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionSearchIndex, type SessionSearchPatch } from './session-search';
import { SessionSearchClient } from './session-search-client';
import { groupSessionsByWorkspace } from './sessions';
import type { DesktopSessionSummary } from './types';
import type { SessionSearchRequest, SessionSearchResponse } from './session-search';

const session = (id: string, overrides: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary => ({
  agentId: 'agent', agentName: 'QueryMT', sessionId: id, title: `Task ${id}`, cwd: '/projects/Workspace',
  updatedAt: null, runtimeId: 'agent', runtimeName: 'QueryMT', source: 'acp', status: 'idle', ...overrides
});
const patch = (overrides: Partial<SessionSearchPatch> = {}): SessionSearchPatch => ({
  sessions: [{ key: 'agent:abc-123', title: 'Fix database', agentName: 'QueryMT', sessionId: 'abc-123', cwd: '/projects/Workspace' }],
  groups: [{ key: '/projects/Workspace', name: 'Workspace', path: '/projects/Workspace', special: false, sessionKeys: ['agent:abc-123'] }],
  removedSessions: [], removedGroups: [], order: ['/projects/Workspace'], ...overrides
});
class FakeWorker {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  postMessage = vi.fn<(request: SessionSearchRequest) => void>();
  terminate = vi.fn();
  respond(id: number, matches: SessionSearchResponse['matches']) {
    this.onmessage?.call(this as unknown as Worker, new MessageEvent('message', { data: { id, matches } }));
  }
  fail() {
    this.onerror?.call(this as unknown as Worker, new ErrorEvent('error', { cancelable: true }));
  }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('SessionSearchIndex', () => {
  it.each(['DATABASE', 'querymt', 'abc-123', 'abc-', 'workspace', '/projects', '  fix  ', ''])('matches %j with the existing substring semantics', (query) => {
    const index = new SessionSearchIndex();
    index.apply(patch());
    expect(index.search(query)).toEqual([{ key: '/projects/Workspace', sessionKeys: ['agent:abc-123'] }]);
  });

  it('does not combine different fields into a false substring match', () => {
    const index = new SessionSearchIndex();
    index.apply(patch());
    expect(index.search('database querymt')).toEqual([]);
  });

  it('searches special-group session workspaces without matching the synthetic group heading', () => {
    const index = new SessionSearchIndex();
    index.apply(patch({ groups: [{ key: 'recent', name: 'Recent sessions', path: '', special: true, sessionKeys: ['agent:abc-123'] }], order: ['recent'] }));
    expect(index.search('workspace')[0].key).toBe('recent');
    expect(index.search('recent sessions')).toEqual([]);
  });

  it('applies updates, removals, group moves, and source ordering without rebuilding unchanged documents', () => {
    const index = new SessionSearchIndex();
    index.apply(patch());
    index.apply(patch({ sessions: [{ key: 'agent:abc-123', title: 'Renamed task', agentName: 'QueryMT', sessionId: 'abc-123', cwd: '/moved' }],
      groups: [{ key: '/moved', name: 'moved', path: '/moved', special: false, sessionKeys: ['agent:abc-123'] }],
      removedGroups: ['/projects/Workspace'], order: ['/moved'] }));
    expect(index.search('database')).toEqual([]);
    expect(index.search('workspace')).toEqual([]);
    expect(index.search('renamed')).toEqual([{ key: '/moved', sessionKeys: ['agent:abc-123'] }]);
    index.apply(patch({ sessions: [], groups: [], removedSessions: ['agent:abc-123'], order: ['/moved'] }));
    expect(index.search('')).toEqual([]);
  });

  it('yields during fallback searches and cancels obsolete scans', async () => {
    vi.useFakeTimers();
    const index = new SessionSearchIndex();
    const documents = Array.from({ length: 7000 }, (_, id) => ({ key: String(id), title: 'Task', agentName: 'QueryMT', sessionId: String(id), cwd: '/work' }));
    index.apply(patch({ sessions: documents, groups: [{ key: '/work', name: 'work', path: '/work', special: false, sessionKeys: documents.map((doc) => doc.key) }], order: ['/work'] }));
    let cancelled = false;
    const result = index.searchYielding('task', () => cancelled);
    let settled = false;
    void result.then(() => settled = true);
    await Promise.resolve();
    expect(settled).toBe(false);
    cancelled = true;
    await vi.runAllTimersAsync();
    expect(await result).toBeNull();
  });
});

describe('SessionSearchClient', () => {
  it('creates the worker lazily, sends only changed documents, and avoids reindexing status-only updates', async () => {
    const worker = new FakeWorker();
    const create = vi.fn(() => worker);
    const client = new SessionSearchClient(create);
    const rows = [session('first'), session('second')];
    expect(client.update(groupSessionsByWorkspace(rows))).toBe(true);
    expect(create).not.toHaveBeenCalled();
    const result = client.search('task');
    expect(create).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ type: 'patch', patch: { sessions: expect.any(Array) } });
    expect(client.update(groupSessionsByWorkspace(rows.map((row) => ({ ...row, status: 'thinking' }))))).toBe(false);
    const request = worker.postMessage.mock.calls.map(([request]) => request).find((request) => request.type === 'search')!;
    worker.respond(request.id, [{ key: '/projects/Workspace', sessionKeys: ['agent:first'] }]);
    expect(await result).toEqual([{ key: '/projects/Workspace', sessionKeys: ['agent:first'] }]);
    worker.postMessage.mockClear();
    client.update(groupSessionsByWorkspace([{ ...rows[0], title: 'Renamed' }, rows[1]]));
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ type: 'patch', patch: { sessions: [{ key: 'agent:first', title: 'Renamed' }], removedSessions: [], groups: [] } });
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('uses the same canonical summary as rendered rows when pins or recents duplicate a catalog entry', async () => {
    const client = new SessionSearchClient(() => { throw new Error('No worker'); });
    const current = session('same', { title: 'Current catalog title' });
    client.update([
      { ...groupSessionsByWorkspace([session('same', { title: 'Stale pin title' })])[0], key: 'pins', kind: 'pinned' },
      ...groupSessionsByWorkspace([current])
    ]);
    expect(await client.search('current catalog')).toHaveLength(2);
    expect(await client.search('stale pin')).toEqual([]);
    client.dispose();
  });

  it('rejects stale responses after another query, index update, cancellation, or disposal', async () => {
    const worker = new FakeWorker();
    const client = new SessionSearchClient(() => worker);
    client.update(groupSessionsByWorkspace([session('first')]));
    const old = client.search('first');
    const latest = client.search('second');
    expect(await old).toBeNull();
    const requests = worker.postMessage.mock.calls.map(([request]) => request).filter((request) => request.type === 'search');
    worker.respond(requests[0].id, [{ key: 'stale', sessionKeys: [] }]);
    worker.respond(requests[1].id, []);
    expect(await latest).toEqual([]);
    const reading = client.search('first');
    client.update([]);
    expect(await reading).toBeNull();
    const cancelled = client.search('first');
    client.cancel();
    expect(await cancelled).toBeNull();
    const disposed = client.search('first');
    client.dispose();
    expect(await disposed).toBeNull();
    expect(await client.search('anything')).toBeNull();
  });

  it.each(['unavailable', 'crash', 'post-failure', 'timeout'] as const)('falls back safely when the worker has a %s', async (failure) => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    if (failure === 'post-failure') worker.postMessage.mockImplementation(() => { throw new Error('Clone failed'); });
    const client = new SessionSearchClient(() => {
      if (failure === 'unavailable') throw new Error('Worker blocked');
      return worker;
    });
    client.update(groupSessionsByWorkspace([session('first')]));
    const result = client.search('first');
    if (failure === 'crash') worker.fail();
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual([{ key: '/projects/Workspace', sessionKeys: ['agent:first'] }]);
    client.update(groupSessionsByWorkspace([session('first', { title: 'Changed title' })]));
    expect(await client.search('changed title')).toHaveLength(1);
    client.update([]);
    expect(await client.search('first')).toEqual([]);
    client.dispose();
  });

  it('runs the real worker message handler with patches before queries', async () => {
    const scope = { onmessage: null as ((event: MessageEvent<SessionSearchRequest>) => void) | null, postMessage: vi.fn() };
    vi.stubGlobal('self', scope);
    await import('./session-search.worker');
    scope.onmessage!(new MessageEvent('message', { data: { type: 'patch', patch: patch() } }));
    scope.onmessage!(new MessageEvent('message', { data: { type: 'search', id: 42, query: 'database' } }));
    expect(scope.postMessage).toHaveBeenCalledWith({ id: 42, matches: [{ key: '/projects/Workspace', sessionKeys: ['agent:abc-123'] }] });
  });
});
