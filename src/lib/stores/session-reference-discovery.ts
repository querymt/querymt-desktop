const FRESH_MS = 5 * 60_000;
const RETRY_MS = 30_000;

/** One resumable, demand-driven scan per backend/peer scope, never a history load. */
export class SessionReferenceDiscovery<T extends { sessionId: string }> {
  private targets = new Map<string, T>();
  private demands = new Set<Set<string>>();
  private removed = new Set<string>();
  private cursor: string | undefined;
  private seenCursors = new Set<string>();
  private complete = false;
  private startedAt: number | null = null;
  private retryAt = 0;
  private running = false;
  private disposed = false;

  constructor(private options: {
    fetchPage: (cursor?: string) => Promise<{ sessions: T[]; nextCursor?: string | null }>;
    publish: (sessions: T[]) => void;
    isCurrent: () => boolean;
    now?: () => number;
  }) {}

  watch(sessionIds: Iterable<string>): () => void {
    const demand = new Set(Array.from(sessionIds, (id) => id.toLowerCase()));
    if (this.disposed || !demand.size) return () => {};
    this.demands.add(demand);
    // Batch registrations from all mounted messages before the first request.
    queueMicrotask(() => { void this.scan(); });
    return () => { this.demands.delete(demand); };
  }

  forget(sessionId: string) {
    const id = sessionId.toLowerCase();
    this.removed.add(id);
    if (this.targets.delete(id) && !this.disposed) this.options.publish([...this.targets.values()]);
  }

  dispose() {
    this.disposed = true;
    this.demands.clear();
    this.targets.clear();
  }

  private hasMissingReferences(): boolean {
    for (const demand of this.demands) {
      for (const id of demand) if (!this.targets.has(id) && !this.removed.has(id)) return true;
    }
    return false;
  }

  private async scan() {
    const now = this.options.now ?? Date.now;
    if (this.running || this.disposed || !this.options.isCurrent() || !this.hasMissingReferences() || now() < this.retryAt) return;
    if (this.startedAt === null || now() - this.startedAt >= FRESH_MS) {
      this.startedAt = now();
      this.cursor = undefined;
      this.seenCursors.clear();
      this.complete = false;
    }
    if (this.complete) return;

    this.running = true;
    let changed = false;
    try {
      while (!this.disposed && this.options.isCurrent() && this.hasMissingReferences() && !this.complete) {
        const page = await this.options.fetchPage(this.cursor);
        if (this.disposed || !this.options.isCurrent()) return;
        const wanted = new Set([...this.demands].flatMap((demand) => [...demand]));
        const foundReference = page.sessions.some((session) => wanted.has(session.sessionId.toLowerCase()) &&
          !this.targets.has(session.sessionId.toLowerCase()));
        for (const session of page.sessions) {
          const id = session.sessionId.toLowerCase();
          if (!this.removed.has(id)) {
            this.targets.set(id, session);
            changed = true;
          }
        }
        const next = page.nextCursor || undefined;
        if (next && this.seenCursors.has(next)) throw new Error('Repeated delegate session cursor.');
        if (next) this.seenCursors.add(next);
        this.cursor = next;
        this.complete = !next;
        // Publish a page's matches together, so one unknown UUID cannot hold
        // verified links hostage until the entire delegate catalog is scanned.
        if (changed && foundReference && this.hasMissingReferences()) {
          this.options.publish([...this.targets.values()]);
          changed = false;
        }
      }
    } catch {
      // A failure/partial scan is not a negative result. Retry on later demand,
      // with a cooldown so remounts cannot hammer a disconnected backend.
      this.retryAt = now() + RETRY_MS;
    } finally {
      this.running = false;
      if (changed && !this.disposed && this.options.isCurrent()) this.options.publish([...this.targets.values()]);
    }
  }
}
