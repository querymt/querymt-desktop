import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionListCoordinator, type SessionListChannel } from './session-list-coordination';

class Channels {
  ports = new Set<SessionListChannel>();
  messages: unknown[] = [];
  paused = false;
  deliveries: Array<() => void> = [];
  flush() { this.paused = false; for (const deliver of this.deliveries.splice(0)) queueMicrotask(deliver); }
  open = (): SessionListChannel => {
    const port: SessionListChannel = {
      onmessage: null,
      postMessage: (data) => {
        this.messages.push(data);
        for (const target of this.ports) if (target !== port) {
          const deliver = () => target.onmessage?.({ data });
          if (this.paused) this.deliveries.push(deliver); else queueMicrotask(deliver);
        }
      },
      close: () => { this.ports.delete(port); }
    };
    this.ports.add(port);
    return port;
  };
  inject(data: unknown) { for (const port of this.ports) port.onmessage?.({ data }); }
}
const page = { sessions: [{ sessionId: 'one', cwd: '/work', title: 'Task', _meta: { querymt: { lifecycle: { session_id: 'one', resolved: false, archived: false } } } }] };
const stores: SessionListCoordinator[] = [];
let channels: Channels;
function tab(id: string, onInvalidate = vi.fn()) {
  let visible = true;
  const coordinator = new SessionListCoordinator({ id, createChannel: channels.open, visible: () => visible, onInvalidate });
  stores.push(coordinator);
  return { coordinator, onInvalidate, visible: (value: boolean) => { visible = value; coordinator.visibilityChanged(); } };
}
async function settle(ms = 100) { await vi.advanceTimersByTimeAsync(ms); }
beforeEach(() => { vi.useFakeTimers(); channels = new Channels(); });
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); vi.useRealTimers(); });

describe('SessionListCoordinator', () => {
  it('coalesces matching page scopes across three tabs and reuses warm snapshots for a late tab', async () => {
    const a = tab('a'), b = tab('b'), c = tab('c');
    const fetch = vi.fn(async () => page);
    const reads = [a, b, c].map(({ coordinator }) => coordinator.read('backend/profile/v1', 'root', fetch));
    await settle();
    expect(await Promise.all(reads)).toEqual([page, page, page]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const late = tab('d').coordinator.read('backend/profile/v1', 'root', fetch);
    await settle(); await expect(late).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shares all pages of catalog and pin enumeration, but never mixes filters or identities', async () => {
    const a = tab('a'), b = tab('b');
    const fetch = vi.fn(async () => page);
    const enumerate = async (coordinator: SessionListCoordinator, pinned: boolean) => {
      await coordinator.read('backend/profile/v1', JSON.stringify({ pinned, cursor: null }), fetch);
      return coordinator.read('backend/profile/v1', JSON.stringify({ pinned, cursor: 'next' }), fetch);
    };
    const reads = [enumerate(a.coordinator, false), enumerate(b.coordinator, false), enumerate(a.coordinator, true), enumerate(b.coordinator, true)];
    await settle(300); await Promise.all(reads);
    expect(fetch).toHaveBeenCalledTimes(4);
    const others = [
      b.coordinator.read('other-backend/profile/v1', 'root', fetch),
      a.coordinator.read('backend/other-profile/v1', 'root', fetch),
      b.coordinator.read('backend/profile/v2', 'root', fetch),
      a.coordinator.read('backend/profile/v1', 'remote:peer-2', fetch)
    ];
    await settle(); await Promise.all(others);
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it('coalesces concurrent manual requests but bypasses completed warm snapshots', async () => {
    const a = tab('a'), b = tab('b');
    const fetch = vi.fn(async () => page);
    const first = a.coordinator.read('source', 'root', fetch); await settle(); await first;
    const changed = { sessions: [{ ...page.sessions[0], title: 'New' }] };
    fetch.mockResolvedValue(changed);
    const manual = [a, b].map(({ coordinator }) => coordinator.read('source', 'root', fetch, { fresh: true }));
    await settle(); expect(await Promise.all(manual)).toEqual([changed, changed]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidates peers once without loops and rejects snapshots in flight before a mutation', async () => {
    const a = tab('a'), b = tab('b');
    let release!: (value: typeof page) => void;
    const fetch = vi.fn(() => new Promise<typeof page>((resolve) => { release = resolve; }));
    const reads = [a, b].map(({ coordinator }) => coordinator.read('source', 'root', fetch).catch(() => null));
    await settle(); a.coordinator.invalidate('source'); await settle();
    release(page); await settle();
    expect(await Promise.all(reads)).toEqual([null, null]);
    expect(b.onInvalidate).toHaveBeenCalledExactlyOnceWith('source');
    expect(a.onInvalidate).not.toHaveBeenCalled();
    const count = channels.messages.length; await settle(20_000);
    expect(channels.messages).toHaveLength(count);
    fetch.mockImplementation(async () => page);
    const fresh = b.coordinator.read('source', 'root', fetch); await settle(); await fresh;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['hide', 'close', 'fail', 'hang'] as const)('takes over when a page owner becomes %s', async (failure) => {
    const a = tab('a'), b = tab('b');
    let reject!: (error: Error) => void;
    const ownerFetch = vi.fn(() => new Promise<typeof page>((_resolve, rejectFetch) => { reject = rejectFetch; }));
    const owner = a.coordinator.read('source', 'root', ownerFetch).catch(() => null);
    await settle();
    const followerFetch = vi.fn(async () => page);
    const follower = b.coordinator.read('source', 'root', followerFetch);
    await settle(); expect(followerFetch).not.toHaveBeenCalled();
    if (failure === 'hide') a.visible(false);
    if (failure === 'close') a.coordinator.dispose();
    if (failure === 'fail') reject(new Error('Owner unavailable'));
    await settle(failure === 'hang' ? 6_500 : 200);
    await expect(follower).resolves.toEqual(page);
    expect(followerFetch).toHaveBeenCalledTimes(1);
    a.coordinator.dispose(); await owner;
  });

  it('pauses all-hidden requests and resumes matching visible demand once', async () => {
    const a = tab('a'), b = tab('b'); a.visible(false); b.visible(false);
    const fetch = vi.fn(async () => page);
    const reads = [a, b].map(({ coordinator }) => coordinator.read('source', 'root', fetch));
    await settle(20_000); expect(fetch).not.toHaveBeenCalled();
    a.visible(true); b.visible(true); a.visible(true); b.visible(true);
    await settle(); expect(await Promise.all(reads)).toEqual([page, page]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'construct', 'post'] as const)('falls back to independent reads when channel API is %s', async (failure) => {
    const fetch = vi.fn(async () => page);
    const coordinator = new SessionListCoordinator({ id: failure, createChannel: () => {
      if (failure === 'construct') throw new Error('Blocked');
      if (failure === 'missing') return null;
      const channel = channels.open(); channel.postMessage = () => { throw new Error('Closed'); }; return channel;
    } });
    stores.push(coordinator);
    const read = coordinator.read('source', 'root', fetch); await settle(); await expect(read).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(coordinator.available).toBe(false);
  });

  it('ignores unversioned, wrong-source, oversized and malformed snapshots', async () => {
    const a = tab('a'); const fetch = vi.fn(async () => page);
    const read = a.coordinator.read('source', 'root', fetch);
    channels.inject({ version: 9, type: 'snapshot', source: 'source', key: 'root', page });
    channels.inject('x'.repeat(600_000));
    channels.inject({ version: 1, type: 'snapshot', source: 'different', key: 'root', page });
    channels.inject({ version: 1, type: 'snapshot', source: 'source', key: 'root', page: { sessions: [{ sessionId: 2 }] } });
    await settle(); await expect(read).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retires snapshots for both concurrent mutation events even when the later-delivered epoch sorts lower', async () => {
    const a = tab('a'), b = tab('b');
    channels.paused = true;
    a.coordinator.invalidate('source'); b.coordinator.invalidate('source');
    const fetch = vi.fn(async () => page);
    const beforeOtherCommit = b.coordinator.read('source', 'root', fetch);
    await settle(); await beforeOtherCommit;
    expect(fetch).toHaveBeenCalledTimes(1);
    channels.flush(); await settle();
    const changed = { sessions: [{ ...page.sessions[0], title: 'Both commits completed' }] };
    fetch.mockResolvedValue(changed);
    const reads = [a, b].map(({ coordinator }) => coordinator.read('source', 'root', fetch));
    await settle(); expect(await Promise.all(reads)).toEqual([changed, changed]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const count = channels.messages.length; await settle(20_000);
    expect(channels.messages).toHaveLength(count);
  });

  it.each(['invalid', 'too-many-rows', 'oversized'] as const)('releases followers before lease expiry for an unshareable %s result', async (kind) => {
    const a = tab('a'), b = tab('b');
    const result = kind === 'invalid' ? { sessions: [{ ...page.sessions[0], updatedAt: 3 }] } :
      kind === 'too-many-rows' ? { sessions: Array.from({ length: 2001 }, () => page.sessions[0]) } :
        { sessions: [{ ...page.sessions[0], title: 'x'.repeat(500_000) }] };
    const ownerFetch = vi.fn(async () => result as unknown as typeof page);
    const followerFetch = vi.fn(async () => page);
    const owner = a.coordinator.read('source', 'root', ownerFetch);
    const follower = b.coordinator.read('source', 'root', followerFetch);
    await settle(300);
    await expect(owner).resolves.toEqual(result);
    expect(followerFetch).toHaveBeenCalledTimes(1);
    await expect(follower).resolves.toEqual(page);
    expect(channels.messages.filter((data) => typeof data === 'string' && JSON.parse(data).type === 'yield')).not.toHaveLength(0);
  });

  it('falls back promptly when a cached page fits locally but its reply envelope is oversized', async () => {
    const a = tab('a'), b = tab('b');
    const source = 'source'.repeat(300);
    const large = { sessions: [{ ...page.sessions[0], title: 'x'.repeat(499_000) }] };
    const first = a.coordinator.read(source, 'root', async () => large); await settle(); await first;
    const fetch = vi.fn(async () => page);
    const follower = b.coordinator.read(source, 'root', fetch); await settle(300);
    await expect(follower).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not deadlock or fetch twice when snapshot posting throws during completion', async () => {
    const port = channels.open();
    const post = port.postMessage;
    port.postMessage = (data) => {
      if (typeof data === 'string' && JSON.parse(data).type === 'snapshot') throw new Error('Channel closed');
      post(data);
    };
    const a = new SessionListCoordinator({ id: 'a', createChannel: () => port }); stores.push(a);
    const fetch = vi.fn(async () => page);
    const read = a.read('source', 'root', fetch); await settle();
    await expect(read).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a.available).toBe(false);
  });

  it('does not replace the local transport deadline with the ownership lease', async () => {
    const a = tab('a'); let release!: (value: typeof page) => void;
    const read = a.coordinator.read('source', 'root', () => new Promise<typeof page>((resolve) => { release = resolve; }));
    await settle(12_000);
    release(page); await expect(read).resolves.toEqual(page);
  });

  it('ignores an older request error after initial epoch sync starts a newer read', async () => {
    const a = tab('a');
    let rejectOld!: (error: Error) => void;
    let releaseNew!: (value: typeof page) => void;
    const fetch = vi.fn<() => Promise<typeof page>>()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseNew = resolve; }));
    const read = a.coordinator.read('source', 'root', fetch, { fresh: true });
    await settle();
    channels.inject(JSON.stringify({ version: 1, type: 'epoch', peer: 'b', source: 'source', key: 'root', revision: { clock: 1, peer: 'b' } }));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    rejectOld(new Error('Obsolete transport failure')); await settle();
    releaseNew(page); await expect(read).resolves.toEqual(page);
  });

  it('syncs the initial epoch of a late tab after an earlier invalidation', async () => {
    const a = tab('a'); a.coordinator.invalidate('source');
    const fetch = vi.fn(async () => page);
    const first = a.coordinator.read('source', 'root', fetch); await settle(); await first;
    const late = tab('b');
    const read = late.coordinator.read('source', 'root', fetch); await settle();
    await expect(read).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(late.onInvalidate).not.toHaveBeenCalled();
  });

  it('ignores unknown and malformed message types before any revision side effect', async () => {
    const a = tab('a'); const fetch = vi.fn(async () => page);
    const read = a.coordinator.read('source', 'root', fetch);
    const envelope = { version: 1, peer: 'b', source: 'source', key: 'root', revision: { clock: 999, peer: 'b' } };
    channels.inject(JSON.stringify({ ...envelope, type: 'unknown' }));
    channels.inject(JSON.stringify({ ...envelope, type: 'snapshot', at: Date.now(), page: { sessions: 'bad' } }));
    channels.inject(JSON.stringify({ ...envelope, type: 'claim', until: 'bad' }));
    await settle(); await expect(read).resolves.toEqual(page);
    expect(a.onInvalidate).not.toHaveBeenCalled();
  });

  it('allows explicit hidden requests to use the local client without waiting for visible ownership', async () => {
    const a = tab('a'); a.visible(false);
    const fetch = vi.fn(async () => page);
    await expect(a.coordinator.read('source', 'root', fetch, { fresh: true, allowHidden: true })).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retires a disconnected source and does not resurrect after dispose or late completion', async () => {
    const a = tab('a'); let release!: (value: typeof page) => void;
    const read = a.coordinator.read('source', 'root', () => new Promise<typeof page>((resolve) => { release = resolve; })).catch(() => null);
    await settle(); a.coordinator.drop('source'); release(page); await settle();
    expect(await read).toBeNull();
    a.coordinator.dispose();
    expect(channels.ports.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(a.coordinator.read('source', 'root', async () => page)).rejects.toThrow(/disposed/i);
  });
});
