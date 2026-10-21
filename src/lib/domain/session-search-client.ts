import { getSessionKey, type WorkspaceSessionGroup } from './sessions';
import type { DesktopSessionSummary } from './types';
import {
  SessionSearchIndex, type SearchGroupDocument, type SearchSessionDocument, type SessionSearchMatch,
  type SessionSearchPatch, type SessionSearchRequest, type SessionSearchResponse
} from './session-search';

type SearchWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

export class SessionSearchClient {
  private sessions = new Map<string, SearchSessionDocument>();
  private groups = new Map<string, SearchGroupDocument>();
  private order: string[] = [];
  private worker: SearchWorker | null = null;
  private fallback: SessionSearchIndex | null = null;
  private fallbackRequest: object | null = null;
  private disposed = false;
  private sequence = 0;
  private pending: { id: number; query: string; resolve: (matches: SessionSearchMatch[] | null) => void } | null = null;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(private createWorker: () => SearchWorker = () => new Worker(new URL('./session-search.worker.ts', import.meta.url), { type: 'module' })) {}

  update(groups: WorkspaceSessionGroup[]) {
    if (this.disposed) return false;
    const summaries = new Map<string, DesktopSessionSummary>();
    const sessions = new Map<string, SearchSessionDocument>();
    const nextGroups = new Map<string, SearchGroupDocument>();
    const patch: SessionSearchPatch = { sessions: [], removedSessions: [], groups: [], removedGroups: [], order: groups.map((group) => group.key) };
    for (const group of groups) {
      const sessionKeys: string[] = [];
      for (const session of group.sessions) {
        const key = getSessionKey(session);
        sessionKeys.push(key);
        summaries.set(key, session);
      }
      const previous = this.groups.get(group.key);
      const special = !!group.kind;
      if (previous && previous.name === group.name && previous.path === group.path && previous.special === special &&
        sameKeys(previous.sessionKeys, sessionKeys)) nextGroups.set(group.key, previous);
      else {
        const document = { key: group.key, name: group.name, path: group.path, special, sessionKeys };
        nextGroups.set(group.key, document);
        patch.groups.push(document);
      }
    }
    for (const [key, session] of summaries) {
      const previous = this.sessions.get(key);
      if (previous && previous.title === session.title && previous.agentName === session.agentName &&
        previous.sessionId === session.sessionId && previous.cwd === session.cwd) sessions.set(key, previous);
      else {
        const document = { key, title: session.title, agentName: session.agentName, sessionId: session.sessionId, cwd: session.cwd };
        sessions.set(key, document);
        patch.sessions.push(document);
      }
    }
    patch.removedSessions = [...this.sessions.keys()].filter((key) => !sessions.has(key));
    patch.removedGroups = [...this.groups.keys()].filter((key) => !nextGroups.has(key));
    const changed = patch.sessions.length || patch.removedSessions.length || patch.groups.length || patch.removedGroups.length || !sameKeys(this.order, patch.order);
    this.sessions = sessions;
    this.groups = nextGroups;
    this.order = patch.order;
    if (!changed) return false;
    this.cancel();
    if (this.fallback) this.fallback.apply(patch);
    else if (this.worker) this.post({ type: 'patch', patch });
    return true;
  }

  search(query: string): Promise<SessionSearchMatch[] | null> {
    this.cancel();
    if (this.disposed) return Promise.resolve(null);
    const id = ++this.sequence;
    return new Promise((resolve) => {
      this.pending = { id, query, resolve };
      if (!this.worker && !this.fallback) {
        try {
          this.worker = this.createWorker();
          this.worker.onmessage = ({ data }: MessageEvent<SessionSearchResponse>) => {
            if (this.pending?.id !== data.id) return;
            clearTimeout(this.timeout);
            const pending = this.pending;
            this.pending = null;
            pending.resolve(data.matches);
          };
          this.worker.onerror = (event) => { event.preventDefault(); this.useFallback(); };
          this.worker.onmessageerror = () => this.useFallback();
          this.post({ type: 'patch', patch: this.snapshot() });
        } catch { this.useFallback(); }
      }
      if (this.fallback) this.runFallback();
      else if (this.worker) {
        this.timeout = setTimeout(() => this.useFallback(), 5000);
        this.post({ type: 'search', id, query });
      }
    });
  }

  cancel() {
    ++this.sequence;
    clearTimeout(this.timeout);
    this.pending?.resolve(null);
    this.pending = null;
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.fallback = null;
    this.sessions.clear();
    this.groups.clear();
  }

  private snapshot(): SessionSearchPatch {
    return { sessions: [...this.sessions.values()], groups: [...this.groups.values()],
      removedSessions: [], removedGroups: [], order: this.order };
  }

  private post(request: SessionSearchRequest) {
    try { this.worker?.postMessage(request); }
    catch { this.useFallback(); }
  }

  private useFallback() {
    if (this.disposed || this.fallback) return;
    clearTimeout(this.timeout);
    this.worker?.terminate();
    this.worker = null;
    this.fallback = new SessionSearchIndex();
    this.fallback.apply(this.snapshot());
    this.runFallback();
  }

  private runFallback() {
    const pending = this.pending;
    if (!pending || !this.fallback || this.fallbackRequest === pending) return;
    this.fallbackRequest = pending;
    void this.fallback.searchYielding(pending.query, () => this.pending !== pending).then((matches) => {
      if (this.pending !== pending) return;
      this.pending = null;
      pending.resolve(matches);
    });
  }
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
