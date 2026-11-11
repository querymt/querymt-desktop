import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { QuerymtWorkspaceFilesResponse, QuerymtWorkspaceIndexReadyNotification } from '$lib/querymt/querymt-extensions';
import type { MentionQuerySource, MentionTarget } from './mention-controller';
import { createMentionQuery, MENTION_POLL_INTERVAL_MS, MENTION_QUERY_DEBOUNCE_MS } from './mention-query.svelte';

const entry = (path: string) => ({ path, abs_path: `/repo/${path}`, uri: `file:///repo/${path}`, name: path, is_dir: false });
const ready = (...paths: string[]): QuerymtWorkspaceFilesResponse => ({
  status: 'ready', entries: paths.map(entry), truncated: false
});
const notReady = (): QuerymtWorkspaceFilesResponse => ({ status: 'not_ready', entries: [], truncated: false });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(initial: { target: MentionTarget | null; query: string | null }) {
  let indexReady: ((n: QuerymtWorkspaceIndexReadyNotification) => void) | null = null;
  const query = vi.fn<MentionQuerySource['query']>(async () => ready());
  const source: MentionQuerySource = {
    query,
    onIndexReady: (handler) => { indexReady = handler; return () => { indexReady = null; }; }
  };
  const state = $state({ target: initial.target, query: initial.query });
  let handle!: ReturnType<typeof createMentionQuery>;
  const cleanup = $effect.root(() => {
    handle = createMentionQuery({ source: () => source, target: () => state.target, query: () => state.query });
  });
  flushSync();
  return {
    state, query, handle, cleanup,
    emitReady: (n: QuerymtWorkspaceIndexReadyNotification) => indexReady?.(n),
    settle: async (ms = MENTION_QUERY_DEBOUNCE_MS + 1) => {
      flushSync();
      await vi.advanceTimersByTimeAsync(ms);
      flushSync();
    }
  };
}

describe('createMentionQuery', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('debounces and requests the target with the query and a bounded limit', async () => {
    const t = setup({ target: { session_id: 's1' }, query: null });
    t.query.mockResolvedValue(ready('src/a.ts'));
    t.state.query = 'a';
    t.state.query = 'ab';
    await t.settle();
    expect(t.query).toHaveBeenCalledTimes(1);
    expect(t.query).toHaveBeenCalledWith({ session_id: 's1', query: 'ab', limit: 50 });
    expect(t.handle.status).toBe('ready');
    expect(t.handle.entries.map((e) => e.path)).toEqual(['src/a.ts']);
    expect(t.handle.entries[0]).toMatchObject({ uri: 'file:///repo/src/a.ts', isDir: false });
    t.cleanup();
  });

  it('is idle and does not query while closed or without a target', async () => {
    const t = setup({ target: null, query: 'a' });
    await t.settle();
    expect(t.handle.status).toBe('idle');
    t.state.target = { session_id: 's1' };
    t.state.query = null;
    await t.settle();
    expect(t.query).not.toHaveBeenCalled();
    t.cleanup();
  });

  it('discards a stale response that resolves after a newer one', async () => {
    const t = setup({ target: { session_id: 's1' }, query: null });
    const slow = deferred<QuerymtWorkspaceFilesResponse>();
    const fast = deferred<QuerymtWorkspaceFilesResponse>();
    t.query.mockImplementation(async ({ query }) => (query === 'ab' ? slow.promise : fast.promise));

    t.state.query = 'ab';
    await t.settle();
    t.state.query = 'abc';
    await t.settle();

    fast.resolve(ready('abc.ts'));
    await t.settle(0);
    slow.resolve(ready('ab.ts'));
    await t.settle(0);

    expect(t.handle.entries.map((e) => e.path)).toEqual(['abc.ts']);
    t.cleanup();
  });

  it('never presents results of another query as current while loading', async () => {
    const t = setup({ target: { session_id: 's1' }, query: 'a' });
    t.query.mockResolvedValueOnce(ready('a.ts'));
    await t.settle();
    expect(t.handle.entries).toHaveLength(1);
    t.query.mockImplementation(() => new Promise(() => {}));
    t.state.query = 'ab';
    flushSync();
    expect(t.handle.entries).toEqual([]);
    expect(t.handle.status).toBe('loading');
    t.cleanup();
  });

  it('retries a not_ready session query on indexReady for the matching session only', async () => {
    const t = setup({ target: { session_id: 's1' }, query: 'a' });
    t.query.mockResolvedValueOnce(notReady());
    await t.settle();
    expect(t.handle.status).toBe('not_ready');
    expect(t.query).toHaveBeenCalledTimes(1);

    t.emitReady({ session_id: 'other', workspace_root: '/repo' });
    await t.settle();
    expect(t.query).toHaveBeenCalledTimes(1);

    t.query.mockResolvedValueOnce(ready('a.ts'));
    t.emitReady({ session_id: 's1', workspace_root: '/repo' });
    await t.settle();
    expect(t.query).toHaveBeenCalledTimes(2);
    expect(t.handle.status).toBe('ready');
    t.cleanup();
  });

  it('does not poll a session query while not_ready', async () => {
    const t = setup({ target: { session_id: 's1' }, query: 'a' });
    t.query.mockResolvedValue(notReady());
    await t.settle();
    await t.settle(MENTION_POLL_INTERVAL_MS * 3);
    expect(t.query).toHaveBeenCalledTimes(1);
    t.cleanup();
  });

  it('re-polls a cwd-only query at most once per second while not_ready, and stops when closed', async () => {
    const t = setup({ target: { cwd: '/repo' }, query: 'a' });
    t.query.mockResolvedValue(notReady());
    await t.settle();
    expect(t.query).toHaveBeenCalledTimes(1);

    await t.settle(MENTION_POLL_INTERVAL_MS + MENTION_QUERY_DEBOUNCE_MS + 1);
    const afterOne = t.query.mock.calls.length;
    expect(afterOne).toBe(2);

    t.state.query = null;
    await t.settle();
    await t.settle(MENTION_POLL_INTERVAL_MS * 3);
    expect(t.query.mock.calls.length).toBe(afterOne);
    t.cleanup();
  });

  it('stops polling once a cwd-only query becomes ready', async () => {
    const t = setup({ target: { cwd: '/repo' }, query: '' });
    t.query.mockResolvedValueOnce(notReady()).mockResolvedValue(ready('a.ts'));
    await t.settle();
    await t.settle(MENTION_POLL_INTERVAL_MS + MENTION_QUERY_DEBOUNCE_MS + 1);
    expect(t.handle.status).toBe('ready');
    const calls = t.query.mock.calls.length;
    await t.settle(MENTION_POLL_INTERVAL_MS * 3);
    expect(t.query.mock.calls.length).toBe(calls);
    t.cleanup();
  });
});
