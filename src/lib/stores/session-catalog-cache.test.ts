import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, DesktopSessionSummary } from '$lib/domain/types';
import { SessionCatalogCache, isCatalogFresh, sessionCatalogKey, SESSION_CATALOG_FRESH_MS, SESSION_CATALOG_STORAGE_KEY, type CachedSessionCatalog } from './session-catalog-cache';

const session: DesktopSessionSummary = {
  agentId: 'agent', agentName: 'Agent', sessionId: 'session', title: 'Task', cwd: '/work',
  updatedAt: '2026-10-18T00:00:00Z', runtimeId: 'agent', runtimeName: 'Agent',
  source: 'acp', status: 'thinking', location: 'local',
  lifecycle: { session_id: 'session', resolved: false, archived: false, resolved_at: null, archived_at: null }
};
const config: AgentConfig = { id: 'agent', name: 'Agent', transport: 'websocket', websocketUrl: 'host:3000', commandLine: '', enabled: true, autoStart: true };
const filter = { resolution: 'open', archive: 'excluded' } as const;
const entry = (overrides: Partial<CachedSessionCatalog> = {}): CachedSessionCatalog => ({ key: 'scope', sessions: [session], complete: true, checkedAt: Date.now(), hasSessions: true, ...overrides });

beforeEach(() => { localStorage.removeItem(SESSION_CATALOG_STORAGE_KEY); });
afterEach(() => vi.useRealTimers());

describe('SessionCatalogCache', () => {
  it('round trips summaries across instances without restoring live execution or remote availability', () => {
    const cache = new SessionCatalogCache();
    cache.set(entry({ sessions: [{ ...session, location: 'remote', remoteNodeId: 'peer', remoteConnectionState: 'available' }] }));
    cache.flush();
    const restored = new SessionCatalogCache().get('scope');
    expect(restored?.complete).toBe(true);
    expect(restored?.sessions[0]).toMatchObject({ title: 'Task', status: 'idle', remoteNodeId: 'peer', remoteConnectionState: 'disconnected', lifecycle: session.lifecycle });
  });

  it.each([false, true])('preserves relationship knowledge across persistence (known=%s)', (relationshipKnown) => {
    const cache = new SessionCatalogCache();
    cache.set(entry({ sessions: [{ ...session, relationshipKnown, parentSessionId: 'root', forkOrigin: 'delegation' }] }));
    cache.flush();
    expect(new SessionCatalogCache().get('scope')?.sessions[0])
      .toMatchObject({ relationshipKnown, parentSessionId: 'root', forkOrigin: 'delegation' });
  });

  it('round trips pin metadata and rejects malformed pin snapshots', () => {
    const pin = { session_id: session.sessionId, pinned: true, pinned_at: '2026-10-20T10:00:00Z' };
    const cache = new SessionCatalogCache();
    cache.set(entry({ sessions: [{ ...session, pin }] }));
    cache.flush();
    expect(new SessionCatalogCache().get('scope')?.sessions[0].pin).toEqual(pin);
    localStorage.setItem(SESSION_CATALOG_STORAGE_KEY, JSON.stringify({ version: 1, entries: [entry({ sessions: [{ ...session, pin: { ...pin, pinned_at: 'bad date' } }] })] }));
    expect(new SessionCatalogCache().get('scope')).toBeUndefined();
  });

  it('rejects invalid persisted relationship flags', () => {
    localStorage.setItem(SESSION_CATALOG_STORAGE_KEY, JSON.stringify({ version: 1, entries: [entry({
      sessions: [{ ...session, relationshipKnown: 'yes' } as unknown as DesktopSessionSummary]
    })] }));
    expect(new SessionCatalogCache().get('scope')).toBeUndefined();
  });

  it('continues in memory if storage access throws or writes fail', () => {
    const unavailable = new SessionCatalogCache(() => { throw new DOMException('Denied', 'SecurityError'); });
    unavailable.set(entry());
    unavailable.flush();
    expect(unavailable.get('scope')?.sessions).toEqual([session]);
    const failing = { setItem: vi.fn(() => { throw new DOMException('Full', 'QuotaExceededError'); }) } as unknown as Storage;
    const quota = new SessionCatalogCache(() => failing);
    quota.set(entry());
    quota.flush();
    expect(quota.get('scope')?.sessions).toEqual([session]);
  });

  it('handles a quota failure after the storage probe without losing the current catalog', () => {
    const storage = { getItem: vi.fn((key: string) => key.endsWith('.probe') ? '1' : null), removeItem: vi.fn(), setItem: vi.fn() };
    const cache = new SessionCatalogCache(() => storage as unknown as Storage);
    cache.get('scope');
    storage.setItem.mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    cache.set(entry());
    expect(() => cache.flush()).not.toThrow();
    expect(cache.get('scope')?.sessions).toEqual([session]);
  });

  it.each(['{invalid', JSON.stringify({ version: 999, entries: [entry()] }), JSON.stringify({ version: 1, entries: [{ ...entry(), sessions: [{ ...session, title: {} }] }] })])('ignores an invalid cache document (%s)', (raw) => {
    localStorage.setItem(SESSION_CATALOG_STORAGE_KEY, raw);
    expect(new SessionCatalogCache().get('scope')).toBeUndefined();
  });

  it('is fresh only for successful complete scans within the freshness window', () => {
    const now = Date.now();
    expect(isCatalogFresh(entry({ checkedAt: now }), now)).toBe(true);
    expect(isCatalogFresh(entry({ checkedAt: now - SESSION_CATALOG_FRESH_MS }), now)).toBe(false);
    expect(isCatalogFresh(entry({ checkedAt: now + 1000 }), now)).toBe(false);
    expect(isCatalogFresh(entry({ checkedAt: now, complete: false }), now)).toBe(false);
  });

  it('isolates endpoints, transports, encryption, lifecycle filters and remote peer selections', () => {
    const key = sessionCatalogKey([config], ['peer-2', 'peer-1'], filter);
    expect(sessionCatalogKey([config], ['peer-1', 'peer-2'], filter)).toBe(key);
    for (const changed of [{ ...config, websocketUrl: 'other:3000' }, { ...config, websocketSecure: true }, { ...config, transport: 'stdio' as const, commandLine: 'qmtcode' }]) {
      expect(sessionCatalogKey([changed], ['peer-1', 'peer-2'], filter)).not.toBe(key);
    }
    expect(sessionCatalogKey([config], [], filter)).not.toBe(key);
    expect(sessionCatalogKey([config], ['peer-1', 'peer-2'], { resolution: 'resolved', archive: 'excluded' })).not.toBe(key);
  });

  it('bounds persisted rows, marks truncation incomplete, and never serializes extra session content', () => {
    const cache = new SessionCatalogCache();
    const rows = Array.from({ length: 2500 }, (_, i) => ({ ...session, sessionId: `session-${i}`, lifecycle: { ...session.lifecycle!, session_id: `session-${i}` }, prompt: 'must not persist' }));
    cache.set(entry({ sessions: rows }));
    cache.flush();
    const raw = localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)!;
    expect(raw.length).toBeLessThanOrEqual(1_000_000);
    expect(raw).not.toContain('must not persist');
    const restored = new SessionCatalogCache().get('scope');
    expect(restored?.sessions.length).toBeLessThan(2500);
    expect(restored?.complete).toBe(false);
    expect(cache.get('scope')?.sessions).toHaveLength(2500);
  });

  it('merges only locally owned writes so stale tab views do not erase another scope', () => {
    const a = new SessionCatalogCache(), b = new SessionCatalogCache();
    a.get('a'); b.get('b');
    a.set(entry({ key: 'a' })); a.flush();
    b.set(entry({ key: 'b' })); b.flush();
    expect(new SessionCatalogCache().get('a')?.sessions).toHaveLength(1);
    expect(new SessionCatalogCache().get('b')?.sessions).toHaveLength(1);
  });

  it('does not persist received snapshots or clear disk on peer invalidations', async () => {
    vi.useFakeTimers();
    const a = new SessionCatalogCache(); a.set(entry()); a.flush();
    const raw = localStorage.getItem(SESSION_CATALOG_STORAGE_KEY);
    const follower = new SessionCatalogCache();
    follower.set(entry({ key: 'peer', sessions: [] }), false);
    await vi.advanceTimersByTimeAsync(1_000); follower.flush();
    expect(follower.get('peer')?.sessions).toEqual([]);
    expect(localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)).toBe(raw);
    follower.clear(false);
    expect(localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)).toBe(raw);
  });

  it('batches page writes and cancels pending persistence when invalidated', async () => {
    vi.useFakeTimers();
    const cache = new SessionCatalogCache();
    cache.set(entry({ complete: false }));
    cache.set(entry({ sessions: [session, { ...session, sessionId: 'later', lifecycle: { ...session.lifecycle!, session_id: 'later' } }], complete: false }));
    expect(localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(750);
    expect(new SessionCatalogCache().get('scope')?.sessions).toHaveLength(2);
    cache.set(entry());
    cache.clear();
    await vi.advanceTimersByTimeAsync(750);
    expect(localStorage.getItem(SESSION_CATALOG_STORAGE_KEY)).toBeNull();
    expect(cache.get('scope')).toBeUndefined();
  });
});
