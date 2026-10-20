import type { ListSessionsResponse } from '@agentclientprotocol/sdk';

export interface SessionListChannel {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(data: unknown): void;
  close(): void;
}
const CHANNEL = 'querymt.session-lists.v1';
const ELECT_MS = 60;
const LEASE_MS = 6_000;
const MAX_BYTES = 500_000;
const MAX_ENTRIES = 24;
const MAX_PENDING = 16;
const MAX_AGE = 5 * 60_000;
type Revision = { clock: number; peer: string };
type Snapshot = { page: ListSessionsResponse; at: number; revision: Revision };
type Claim = { until: number; busy: boolean };
type Pending = {
  source: string; key: string; fresh: boolean; maxAge: number; started: number; revision: Revision;
  claims: Map<string, Claim>; timer?: ReturnType<typeof setTimeout>; fetching: boolean;
  fetch: () => Promise<ListSessionsResponse>; promise: Promise<ListSessionsResponse>;
  resolve: (page: ListSessionsResponse) => void; reject: (error: Error) => void;
};
const initial: Revision = { clock: 0, peer: '' };
const compare = (a: Revision, b: Revision) => a.clock - b.clock || a.peer.localeCompare(b.peer);
const scopeKey = (source: string, key: string) => JSON.stringify([source, key]);
const validString = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 8_000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Shared data is only a bounded session-list hint, never runtime/control authority. */
export function validSessionListPage(value: unknown): value is ListSessionsResponse {
  if (!object(value) || !Array.isArray(value.sessions) || value.sessions.length > 2_000 ||
    (value.nextCursor != null && typeof value.nextCursor !== 'string')) return false;
  return value.sessions.every((row) => object(row) && validString(row.sessionId) && typeof row.cwd === 'string' &&
    (row.title == null || typeof row.title === 'string') && (row.updatedAt == null || typeof row.updatedAt === 'string') &&
    (row._meta == null || object(row._meta)));
}

/** Per-page visible claim election. Best effort on LAN HTTP: bounded leases allow takeover,
 * not atomic exactly-once delivery when tabs are throttled, partitioned or suspended. */
export class SessionListCoordinator {
  private channel: SessionListChannel | null = null;
  private disposed = false;
  private cache = new Map<string, Snapshot>();
  private sharedPages = new WeakSet<object>();
  private pending = new Map<string, Pending>();
  private revisions = new Map<string, Revision>();
  private seenInvalidations = new Set<string>();
  private readonly id: string;
  private readonly visible: () => boolean;

  constructor(private options: {
    id?: string;
    createChannel?: () => SessionListChannel | null;
    visible?: () => boolean;
    onInvalidate?: (source: string) => void;
  } = {}) {
    this.id = options.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    this.visible = options.visible ?? (() => typeof document === 'undefined' || !document.hidden);
    try {
      if (options.createChannel) this.channel = options.createChannel();
      else if (typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined') {
        const browserChannel = new window.BroadcastChannel(CHANNEL);
        const channel: SessionListChannel = { onmessage: null, postMessage: (data) => browserChannel.postMessage(data), close: () => browserChannel.close() };
        browserChannel.onmessage = ({ data }) => channel.onmessage?.({ data });
        this.channel = channel;
      }
      if (this.channel) this.channel.onmessage = ({ data }) => this.receive(data);
    } catch { this.channel = null; }
  }

  get available() { return this.channel !== null && !this.disposed; }
  isShared(page: ListSessionsResponse) { return this.sharedPages.has(page); }

  read(source: string, key: string, fetch: () => Promise<ListSessionsResponse>, options: { fresh?: boolean; maxAge?: number; allowHidden?: boolean } = {}): Promise<ListSessionsResponse> {
    if (this.disposed) return Promise.reject(new Error('Session coordinator disposed.'));
    if (!this.available || (!this.visible() && options.allowHidden) || !validString(source) || !validString(key) || this.pending.size >= MAX_PENDING) return fetch();
    const scope = scopeKey(source, key);
    const cached = this.cache.get(scope);
    const maxAge = Math.min(MAX_AGE, Math.max(0, options.maxAge ?? 30_000));
    if (!options.fresh && cached && Date.now() - cached.at >= 0 && Date.now() - cached.at < maxAge) {
      const page = structuredClone(cached.page);
      this.sharedPages.add(page);
      return Promise.resolve(page);
    }
    const existing = this.pending.get(scope);
    if (existing) return existing.promise;
    let resolve!: Pending['resolve'], reject!: Pending['reject'];
    const promise = new Promise<ListSessionsResponse>((ok, fail) => { resolve = ok; reject = fail; });
    const pending: Pending = { source, key, fetch, promise, resolve, reject, maxAge, fresh: options.fresh ?? false,
      started: Date.now(), revision: this.revisions.get(source) ?? initial, claims: new Map(), fetching: false };
    this.pending.set(scope, pending);
    this.send('want', pending, { fresh: pending.fresh, maxAge });
    this.elect(pending);
    return promise;
  }

  invalidate(source: string) {
    if (this.disposed) return;
    const revision = { clock: (this.revisions.get(source)?.clock ?? 0) + 1, peer: this.id };
    this.noteInvalidation(source, revision);
    this.adopt(source, revision);
    this.send('invalidate', { source, key: '', revision });
  }

  drop(source: string) {
    for (const [scope, pending] of this.pending) if (pending.source === source) {
      this.send('yield', pending);
      this.finish(scope, new Error('Session source disconnected.'));
    }
    for (const scope of this.cache.keys()) if (JSON.parse(scope)[0] === source) this.cache.delete(scope);
  }

  visibilityChanged() {
    for (const pending of this.pending.values()) {
      if (!this.visible()) { this.send('yield', pending); pending.claims.delete(this.id); }
      else this.elect(pending);
    }
  }

  dispose() {
    if (this.disposed) return;
    for (const [scope, pending] of this.pending) { this.send('yield', pending); this.finish(scope, new Error('Session coordinator disposed.')); }
    this.disposed = true;
    if (this.channel) { this.channel.onmessage = null; this.channel.close(); }
    this.channel = null; this.cache.clear(); this.revisions.clear(); this.seenInvalidations.clear();
  }

  private send(type: string, context: { source: string; key: string; revision: Revision }, extra: Record<string, unknown> = {}) {
    if (!this.channel) return;
    try {
      const message = JSON.stringify({ version: 1, type, peer: this.id,
        source: context.source, key: context.key, revision: context.revision, ...extra });
      if (message.length <= MAX_BYTES) this.channel.postMessage(message);
    } catch {
      this.channel.onmessage = null;
      try { this.channel.close(); } catch { /* Failed channels must not disable local reads. */ }
      this.channel = null;
      for (const pending of this.pending.values()) if (!pending.fetching) this.run(pending);
    }
  }

  private elect(pending: Pending) {
    if (pending.timer) clearTimeout(pending.timer);
    if (!this.visible() || pending.fetching) return;
    if (!this.available) { this.run(pending); return; }
    const until = Date.now() + LEASE_MS;
    pending.claims.set(this.id, { until, busy: false });
    this.send('claim', pending, { until, busy: false });
    pending.timer = setTimeout(() => this.drive(pending), ELECT_MS);
  }

  private drive(pending: Pending) {
    if (!this.pending.has(scopeKey(pending.source, pending.key)) || !this.visible() || pending.fetching) return;
    const candidates = [...pending.claims].filter(([, claim]) => claim.until > Date.now())
      .sort(([a, ac], [b, bc]) => Number(bc.busy) - Number(ac.busy) || a.localeCompare(b));
    const winner = candidates[0];
    if (!winner || winner[0] === this.id) { this.run(pending); return; }
    pending.timer = setTimeout(() => this.elect(pending), winner[1].until - Date.now() + 1);
  }

  private run(pending: Pending) {
    const scope = scopeKey(pending.source, pending.key);
    if (pending.fetching || this.pending.get(scope) !== pending) return;
    pending.fetching = true;
    if (pending.timer) clearTimeout(pending.timer);
    const until = Date.now() + LEASE_MS;
    pending.claims.set(this.id, { until, busy: true });
    this.send('claim', pending, { until, busy: true });
    // The lease bounds how long peers wait, not the local ACP transport's deadline.
    const revision = pending.revision;
    void pending.fetch().then((page) => {
      if (this.pending.get(scope) !== pending || compare(this.revisions.get(pending.source) ?? initial, revision)) return;
      if (validSessionListPage(page)) {
        const snapshot = { page, at: Date.now(), revision: pending.revision };
        this.remember(scope, snapshot);
        this.send('snapshot', pending, { page, at: snapshot.at });
      }
      this.finish(scope, page);
    }, (error) => {
      if (this.pending.get(scope) !== pending || compare(this.revisions.get(pending.source) ?? initial, revision)) return;
      this.send('yield', pending);
      this.finish(scope, error instanceof Error ? error : new Error('Session list failed.'));
    });
  }

  private finish(scope: string, value: ListSessionsResponse | Error, shared = false) {
    const pending = this.pending.get(scope);
    if (!pending) return;
    this.pending.delete(scope);
    if (pending.timer) clearTimeout(pending.timer);
    if (value instanceof Error) pending.reject(value);
    else {
      const page = structuredClone(value);
      if (shared) this.sharedPages.add(page);
      pending.resolve(page);
    }
  }

  private remember(scope: string, snapshot: Snapshot) {
    try { if (JSON.stringify(snapshot).length > MAX_BYTES) return; } catch { return; }
    this.cache.delete(scope); this.cache.set(scope, structuredClone(snapshot));
    while (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
  }

  private noteInvalidation(source: string, revision: Revision): boolean {
    const event = JSON.stringify([source, revision.clock, revision.peer]);
    if (this.seenInvalidations.has(event)) return false;
    this.seenInvalidations.add(event);
    while (this.seenInvalidations.size > 256) this.seenInvalidations.delete(this.seenInvalidations.values().next().value!);
    return true;
  }

  private adopt(source: string, revision: Revision) {
    this.revisions.delete(source); this.revisions.set(source, revision);
    while (this.revisions.size > 32) this.revisions.delete(this.revisions.keys().next().value!);
    this.drop(source);
  }

  private receive(data: unknown) {
    if (this.disposed || typeof data !== 'string' || data.length > MAX_BYTES) return;
    let message: Record<string, unknown>;
    try { message = JSON.parse(data); } catch { return; }
    if (!object(message) || message.version !== 1 || !validString(message.peer) || message.peer === this.id ||
      !validString(message.source) || typeof message.key !== 'string' || message.key.length > 8_000 ||
      !object(message.revision) || !Number.isSafeInteger(message.revision.clock) || Number(message.revision.clock) < 0 ||
      typeof message.revision.peer !== 'string' || message.revision.peer.length > 100) return;
    const type = message.type;
    // Validate the whole message before adopting an epoch or retiring any request.
    if (type === 'want') {
      if (typeof message.fresh !== 'boolean' || typeof message.maxAge !== 'number' || !Number.isFinite(message.maxAge) || message.maxAge < 0 || message.maxAge > MAX_AGE) return;
    } else if (type === 'claim') {
      if (typeof message.until !== 'number' || !Number.isFinite(message.until) || message.until <= Date.now() || message.until > Date.now() + LEASE_MS || typeof message.busy !== 'boolean') return;
    } else if (type === 'snapshot') {
      if (!validSessionListPage(message.page) || typeof message.at !== 'number' || !Number.isFinite(message.at) || message.at > Date.now() || Date.now() - message.at > MAX_AGE) return;
    } else if (type !== 'invalidate' && type !== 'yield' && type !== 'epoch') return;
    const revision = message.revision as Revision;
    const source = message.source;
    const scope = scopeKey(source, message.key);
    if (type !== 'invalidate' && !this.pending.has(scope) && !this.cache.has(scope) && !this.revisions.has(source)) return;
    const current = this.revisions.get(source) ?? initial;
    const order = compare(revision, current);
    if (type === 'invalidate') {
      if (!this.noteInvalidation(source, revision)) return;
      // Concurrent mutation events must each retire snapshots, even if their
      // Lamport tie-break sorts below an epoch already cached in this tab.
      const fence = order > 0 ? revision : { clock: current.clock + 1, peer: this.id };
      this.adopt(source, fence);
      if (order <= 0) this.send('epoch', { source, key: message.key, revision: fence });
      this.options.onInvalidate?.(source);
      return;
    }
    if (order < 0) {
      if (type === 'want') {
        const cached = this.cache.get(scope);
        this.send('epoch', { source, key: message.key, revision: current });
        if (cached && message.fresh === false && Date.now() - cached.at < Number(message.maxAge)) {
          this.send('snapshot', { source, key: message.key, revision: current }, { page: cached.page, at: cached.at });
        }
      }
      return;
    }
    if (order > 0) {
      if (!this.revisions.has(source)) {
        // Initial epoch sync is not a new mutation in a late-joining tab.
        this.revisions.set(source, revision);
        while (this.revisions.size > 32) this.revisions.delete(this.revisions.keys().next().value!);
        for (const pending of this.pending.values()) if (pending.source === source) {
          pending.revision = revision; pending.fetching = false; pending.claims.clear(); this.elect(pending);
        }
      } else { this.adopt(source, revision); this.options.onInvalidate?.(source); }
    }
    const pending = this.pending.get(scope);
    if (type === 'want') {
      const cached = this.cache.get(scope);
      if (cached && message.fresh === false && Date.now() - cached.at < Number(message.maxAge)) {
        this.send('snapshot', { source, key: message.key, revision }, { page: cached.page, at: cached.at });
      }
      const own = pending?.claims.get(this.id);
      if (pending && own && this.visible()) this.send('claim', pending, own);
    } else if (type === 'claim' && pending && pending.claims.size < 16) {
      pending.claims.set(message.peer, { until: message.until as number, busy: message.busy as boolean });
    } else if (type === 'yield' && pending) {
      pending.claims.delete(message.peer);
      if (!pending.fetching) this.elect(pending);
    } else if (type === 'snapshot' && pending && Date.now() - Number(message.at) <
      (pending.fresh ? Math.max(1, Date.now() - pending.started + 1) : pending.maxAge)) {
      this.remember(scope, { page: message.page as ListSessionsResponse, at: message.at as number, revision });
      this.finish(scope, message.page as ListSessionsResponse, true);
    }
  }
}
