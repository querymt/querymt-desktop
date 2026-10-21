import type { AgentConfig, DesktopSessionSummary, SessionLifecycleFilter } from '$lib/domain/types';
import { readSessionLifecycle, readSessionPin } from '$lib/domain/sessions';

export const SESSION_CATALOG_STORAGE_KEY = 'querymt-desktop.session-catalog.v1';
export const SESSION_CATALOG_FRESH_MS = 5 * 60_000;
const MAX_ENTRIES = 8;
const MAX_STORED_CHARACTERS = 1_000_000;
const MAX_STORED_ROWS = 2_000;

export interface CachedSessionCatalog {
  key: string;
  sessions: DesktopSessionSummary[];
  complete: boolean;
  checkedAt: number;
  hasSessions: boolean | null;
  scope?: {
    agentIds: string[];
    remoteNodeIds: string[];
    lifecycle: SessionLifecycleFilter;
    pinned?: boolean;
  };
}

export function sessionCatalogKey(configs: AgentConfig[], remoteNodeIds: string[], lifecycle: SessionLifecycleFilter): string {
  return JSON.stringify({
    agents: configs.map(({ id, transport, commandLine, websocketUrl, websocketSecure }) =>
      [id, transport, transport === 'websocket' ? websocketUrl : commandLine, websocketSecure ?? false]
    ).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    remoteNodeIds: [...remoteNodeIds].sort(),
    scope: 'root',
    resolution: lifecycle.resolution,
    archive: lifecycle.archive
  });
}

export function isCatalogFresh(entry: CachedSessionCatalog, now = Date.now()): boolean {
  const age = now - entry.checkedAt;
  return entry.complete && age >= 0 && age < SESSION_CATALOG_FRESH_MS;
}

/** A disposable, bounded warm-start cache; never a source of runtime or permission state. */
export class SessionCatalogCache {
  private entries = new Map<string, CachedSessionCatalog>();
  private initialized = false;
  private storage: Storage | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = new Set<string>();

  constructor(private getStorage: () => Storage | null = () => typeof window === 'undefined' ? null : window.localStorage) {}

  get(key: string): CachedSessionCatalog | undefined {
    this.initialize();
    return this.entries.get(key);
  }

  set(entry: CachedSessionCatalog, persist = true) {
    this.initialize();
    this.entries.delete(entry.key);
    this.entries.set(entry.key, { ...entry, sessions: entry.sessions.slice() });
    if (persist) this.dirty.add(entry.key); else this.dirty.delete(entry.key);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest); this.dirty.delete(oldest);
    }
    if (persist && this.storage && this.persistTimer === null) this.persistTimer = setTimeout(() => this.flush(), 750);
  }

  update(update: (entry: CachedSessionCatalog) => CachedSessionCatalog) {
    this.initialize();
    for (const entry of [...this.entries.values()]) {
      const next = update(entry);
      if (next !== entry) this.set(next);
    }
  }

  clear(persist = true) {
    this.initialize();
    this.entries.clear();
    this.dirty.clear();
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    try { if (persist) this.storage?.removeItem(SESSION_CATALOG_STORAGE_KEY); } catch { this.storage = null; }
  }

  flush() {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.storage || !this.dirty.size) return;
    try {
      // Merge only locally fetched scopes into the latest document. This is a warm
      // cache, not an atomic cross-window lease or a mutation authority.
      const merged = readCatalogEntries(this.storage.getItem(SESSION_CATALOG_STORAGE_KEY));
      for (const key of this.dirty) {
        const entry = this.entries.get(key);
        if (!entry || (merged.get(key)?.checkedAt ?? -1) > entry.checkedAt) continue;
        merged.delete(key); merged.set(key, entry);
      }
      this.dirty.clear();
      const entries = [...merged.values()].slice(-MAX_ENTRIES).map((entry) => ({
        ...entry,
        sessions: entry.sessions.slice(0, MAX_STORED_ROWS).map(persistedSummary),
        complete: entry.complete && entry.sessions.length <= MAX_STORED_ROWS
      }));
      let serialized = JSON.stringify({ version: 1, entries });
      while (serialized.length > MAX_STORED_CHARACTERS && entries.length) {
        if (entries.length > 1) entries.shift();
        else {
          entries[0].sessions = entries[0].sessions.slice(0, Math.floor(entries[0].sessions.length / 2));
          entries[0].complete = false;
          if (!entries[0].sessions.length) entries.shift();
        }
        serialized = JSON.stringify({ version: 1, entries });
      }
      this.storage.setItem(SESSION_CATALOG_STORAGE_KEY, serialized);
    } catch {
      // Quota or policy failures affect persistence, not the in-memory catalog.
      this.storage = null;
    }
  }

  private initialize() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const storage = this.getStorage();
      if (!storage) return;
      const probe = `${SESSION_CATALOG_STORAGE_KEY}.probe`;
      storage.setItem(probe, '1');
      const writable = storage.getItem(probe) === '1';
      storage.removeItem(probe);
      if (!writable) return;
      this.storage = storage;
      this.entries = readCatalogEntries(storage.getItem(SESSION_CATALOG_STORAGE_KEY));
    } catch {
      // Unavailable storage and malformed cache documents are both disposable.
    }
  }
}

function readCatalogEntries(raw: string | null): Map<string, CachedSessionCatalog> {
  const entries = new Map<string, CachedSessionCatalog>();
  if (!raw || raw.length > MAX_STORED_CHARACTERS) return entries;
  try {
    const document = JSON.parse(raw);
    if (document?.version !== 1 || !Array.isArray(document.entries)) return entries;
    for (const entry of document.entries.slice(-MAX_ENTRIES)) {
      if (typeof entry?.key !== 'string' || !Array.isArray(entry.sessions) || entry.sessions.length > MAX_STORED_ROWS ||
        typeof entry.complete !== 'boolean' || !Number.isFinite(entry.checkedAt) ||
        (entry.hasSessions !== null && typeof entry.hasSessions !== 'boolean')) continue;
      const sessions = entry.sessions.map(readSummary);
      if (sessions.some((session: DesktopSessionSummary | null) => session === null)) continue;
      const scope = entry.scope;
      const validScope = scope && Array.isArray(scope.agentIds) && scope.agentIds.every((id: unknown) => typeof id === 'string') &&
        Array.isArray(scope.remoteNodeIds) && scope.remoteNodeIds.every((id: unknown) => typeof id === 'string') &&
        ['open', 'resolved', 'any'].includes(scope.lifecycle?.resolution) && ['excluded', 'only', 'any'].includes(scope.lifecycle?.archive) &&
        (scope.pinned === undefined || typeof scope.pinned === 'boolean');
      entries.set(entry.key, { key: entry.key, sessions, complete: entry.complete, checkedAt: entry.checkedAt, hasSessions: entry.hasSessions,
        ...(validScope ? { scope } : {}) });
    }
  } catch { /* A corrupt warm cache must not prevent the next successful write. */ }
  return entries;
}

function persistedSummary(session: DesktopSessionSummary): DesktopSessionSummary {
  return {
    agentId: session.agentId, agentName: session.agentName, sessionId: session.sessionId,
    title: session.title, cwd: session.cwd, updatedAt: session.updatedAt,
    runtimeId: session.runtimeId, runtimeName: session.runtimeName, source: 'acp', status: 'idle',
    location: session.location, remoteNodeId: session.remoteNodeId, remoteNodeLabel: session.remoteNodeLabel,
    remoteProfileId: session.remoteProfileId, remoteProfileLabel: session.remoteProfileLabel,
    remoteConnectionState: session.location === 'remote' ? 'disconnected' : undefined,
    pin: session.pin, lifecycle: session.lifecycle, relationshipKnown: session.relationshipKnown,
    parentSessionId: session.parentSessionId, forkOrigin: session.forkOrigin,
    sessionKind: session.sessionKind, hasChildren: session.hasChildren, forkCount: session.forkCount
  };
}

function readSummary(value: unknown): DesktopSessionSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as DesktopSessionSummary;
  if (![row.agentId, row.agentName, row.sessionId, row.title, row.cwd, row.runtimeId, row.runtimeName].every((value) => typeof value === 'string') ||
    !row.agentId || !row.sessionId || row.source !== 'acp' || (row.updatedAt !== null && typeof row.updatedAt !== 'string') ||
    (row.location !== undefined && row.location !== 'local' && row.location !== 'remote')) return null;
  for (const field of ['remoteNodeId', 'remoteNodeLabel', 'remoteProfileId', 'remoteProfileLabel', 'parentSessionId', 'forkOrigin', 'sessionKind'] as const) {
    if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') return null;
  }
  if ((row.relationshipKnown !== undefined && typeof row.relationshipKnown !== 'boolean') ||
    (row.hasChildren !== undefined && typeof row.hasChildren !== 'boolean') ||
    (row.forkCount !== undefined && (!Number.isSafeInteger(row.forkCount) || row.forkCount < 0))) return null;
  const lifecycle = readSessionLifecycle({ lifecycle: row.lifecycle }, row.sessionId);
  if (row.lifecycle != null && lifecycle === null) return null;
  const pin = readSessionPin({ pin: row.pin }, row.sessionId);
  if (row.pin != null && (pin === null || row.pin.session_id !== row.sessionId)) return null;
  return persistedSummary({ ...row, lifecycle, pin });
}
