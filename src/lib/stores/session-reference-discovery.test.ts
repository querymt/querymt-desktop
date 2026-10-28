import { describe, expect, it, vi } from 'vitest';
import { SessionReferenceDiscovery } from './session-reference-discovery';

interface Target { sessionId: string }
function setup() {
  let now = 0;
  let current = true;
  const fetchPage = vi.fn<(_: string | undefined) => Promise<{ sessions: Target[]; nextCursor?: string }>>()
    .mockResolvedValue({ sessions: [] });
  const publish = vi.fn();
  const discovery = new SessionReferenceDiscovery({ fetchPage, publish, isCurrent: () => current, now: () => now });
  return { discovery, fetchPage, publish, advance: (ms: number) => { now += ms; }, invalidate: () => { current = false; } };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('SessionReferenceDiscovery', () => {
  it('does no work until demanded, batches watchers, and stops once all candidates are found', async () => {
    const { discovery, fetchPage, publish } = setup();
    await settle();
    expect(fetchPage).not.toHaveBeenCalled();
    fetchPage.mockResolvedValueOnce({ sessions: [{ sessionId: 'first' }], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ sessions: [{ sessionId: 'second' }], nextCursor: 'page-3' });
    discovery.watch(['FIRST']);
    discovery.watch(['second', 'second']);
    expect(fetchPage).not.toHaveBeenCalled();
    await settle();
    expect(fetchPage.mock.calls).toEqual([[undefined], ['page-2']]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith([{ sessionId: 'first' }, { sessionId: 'second' }]);
    discovery.watch(['first', 'second']);
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('resumes a partial scan for later messages and caches all returned records', async () => {
    const { discovery, fetchPage, publish } = setup();
    fetchPage.mockResolvedValueOnce({ sessions: [{ sessionId: 'first' }, { sessionId: 'incidental' }], nextCursor: 'page-2' });
    const stop = discovery.watch(['first']);
    await settle();
    stop();
    discovery.watch(['incidental']);
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    fetchPage.mockResolvedValueOnce({ sessions: [{ sessionId: 'later' }] });
    discovery.watch(['later']);
    await settle();
    expect(fetchPage.mock.calls).toEqual([[undefined], ['page-2']]);
    expect(publish).toHaveBeenLastCalledWith([{ sessionId: 'first' }, { sessionId: 'incidental' }, { sessionId: 'later' }]);
  });

  it('adds references arriving during an in-flight request to the same scan', async () => {
    const { discovery, fetchPage } = setup();
    let release!: (page: { sessions: Target[]; nextCursor: string }) => void;
    fetchPage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    discovery.watch(['first']);
    await settle();
    discovery.watch(['second']);
    fetchPage.mockResolvedValueOnce({ sessions: [{ sessionId: 'second' }] });
    release({ sessions: [{ sessionId: 'first' }], nextCursor: 'page-2' });
    await settle();
    expect(fetchPage.mock.calls).toEqual([[undefined], ['page-2']]);
  });

  it('stops paging when messages unmount and does not fetch for an immediately cancelled watcher', async () => {
    const { discovery, fetchPage } = setup();
    discovery.watch(['cancelled'])();
    await settle();
    expect(fetchPage).not.toHaveBeenCalled();
    let release!: (page: { sessions: Target[]; nextCursor: string }) => void;
    fetchPage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const stop = discovery.watch(['missing']);
    await settle();
    stop();
    release({ sessions: [], nextCursor: 'page-2' });
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    discovery.watch(['missing']);
    await settle();
    expect(fetchPage).toHaveBeenLastCalledWith('page-2');
  });

  it('only caches misses after a complete scan and refreshes them on new demand after five minutes', async () => {
    const { discovery, fetchPage, advance } = setup();
    discovery.watch(['unknown']);
    await settle();
    discovery.watch(['another']);
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    advance(5 * 60_000);
    fetchPage.mockResolvedValueOnce({ sessions: [{ sessionId: 'another' }] });
    discovery.watch(['another']);
    await settle();
    expect(fetchPage.mock.calls).toEqual([[undefined], [undefined]]);
  });

  it('keeps partial successes after a failure, throttles retries, and resumes without declaring a miss', async () => {
    const { discovery, fetchPage, publish, advance } = setup();
    fetchPage.mockResolvedValueOnce({ sessions: [{ sessionId: 'first' }], nextCursor: 'page-2' })
      .mockRejectedValueOnce(new Error('Disconnected'));
    discovery.watch(['first', 'later']);
    await settle();
    expect(publish).toHaveBeenLastCalledWith([{ sessionId: 'first' }]);
    discovery.watch(['later']);
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    advance(30_000);
    fetchPage.mockResolvedValueOnce({ sessions: [{ sessionId: 'later' }] });
    discovery.watch(['later']);
    await settle();
    expect(fetchPage.mock.calls).toEqual([[undefined], ['page-2'], ['page-2']]);
  });

  it('publishes verified page matches while an unrelated unknown UUID keeps discovery running', async () => {
    const { discovery, fetchPage, publish } = setup();
    let release!: (page: { sessions: Target[] }) => void;
    fetchPage.mockResolvedValueOnce({ sessions: [{ sessionId: 'first' }], nextCursor: 'page-2' })
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    discovery.watch(['first', 'unknown']);
    await settle();
    expect(publish).toHaveBeenCalledExactlyOnceWith([{ sessionId: 'first' }]);
    release({ sessions: [] });
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('scans 1000 delegate summaries in ten pages and reuses them without refetching', async () => {
    const { discovery, fetchPage, publish } = setup();
    fetchPage.mockImplementation(async (cursor) => {
      const page = Number(cursor ?? 0);
      return { sessions: Array.from({ length: 100 }, (_, i) => ({ sessionId: `delegate-${page * 100 + i}` })),
        nextCursor: page < 9 ? String(page + 1) : undefined };
    });
    discovery.watch(['delegate-999']);
    for (let i = 0; i < 4; i++) await settle();
    expect(fetchPage).toHaveBeenCalledTimes(10);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][0]).toHaveLength(1000);
    for (let i = 0; i < 1000; i++) discovery.watch([`delegate-${i}`]);
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(10);
  });

  it('bounds repeated cursors instead of looping forever', async () => {
    const { discovery, fetchPage } = setup();
    fetchPage.mockResolvedValue({ sessions: [], nextCursor: 'same' });
    discovery.watch(['unknown']);
    await settle();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each(['dispose', 'invalidate'] as const)('ignores a late result after %s', async (operation) => {
    const { discovery, fetchPage, publish, invalidate } = setup();
    let release!: (page: { sessions: Target[]; nextCursor: string }) => void;
    fetchPage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    discovery.watch(['first']);
    await settle();
    if (operation === 'dispose') discovery.dispose(); else invalidate();
    release({ sessions: [{ sessionId: 'first' }], nextCursor: 'page-2' });
    await settle();
    expect(publish).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('never resurrects a session deleted while a scan is in flight', async () => {
    const { discovery, fetchPage, publish } = setup();
    let release!: (page: { sessions: Target[] }) => void;
    fetchPage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    discovery.watch(['deleted']);
    await settle();
    discovery.forget('deleted');
    release({ sessions: [{ sessionId: 'deleted' }] });
    await settle();
    expect(publish).not.toHaveBeenCalled();
  });
});
