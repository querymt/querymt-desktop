export interface SessionLoadPhase {
  name: string;
  durationMs: number;
}

export interface SessionLoadMetrics {
  operationId: string;
  agentId: string;
  sessionId: string;
  totalMs: number;
  phases: SessionLoadPhase[];
  liveNotifications: number;
  drainedNotifications: number;
  appliedNotifications: number;
  duplicateNotifications: number;
  replayCapturedNotifications: number;
  replayReactiveNotifications: number;
  historyAssignments: number;
  snapshotEvents: number;
  transcriptItems: number;
  toolCalls: number;
  debugEvents: number;
  domNodes: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestTaskMs: number;
}

type CounterName =
  | 'liveNotifications'
  | 'drainedNotifications'
  | 'appliedNotifications'
  | 'duplicateNotifications'
  | 'replayCapturedNotifications'
  | 'replayReactiveNotifications'
  | 'historyAssignments';

function clock(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export class SessionLoadMeasurement {
  readonly operationId: string;
  private readonly startedAt = clock();
  private phaseStartedAt = this.startedAt;
  private phases: SessionLoadPhase[] = [];
  private longTaskObserver: PerformanceObserver | null = null;
  private longTasks: number[] = [];
  private cleanedUp = false;
  private counterValues: Record<CounterName, number> = {
    liveNotifications: 0,
    drainedNotifications: 0,
    appliedNotifications: 0,
    duplicateNotifications: 0,
    replayCapturedNotifications: 0,
    replayReactiveNotifications: 0,
    historyAssignments: 0
  };

  constructor(
    private readonly agentId: string,
    private readonly sessionId: string
  ) {
    this.operationId = `${sessionId}-${Math.round(this.startedAt)}`;
    this.mark('start');
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) this.longTasks.push(entry.duration);
        });
        this.longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch {
        this.longTaskObserver = null;
      }
    }
  }

  phase(name: string): number {
    const now = clock();
    const durationMs = now - this.phaseStartedAt;
    this.phases.push({ name, durationMs });
    this.phaseStartedAt = now;
    this.mark(name);
    console.debug('querymt session/load phase', {
      operationId: this.operationId,
      name,
      durationMs
    });
    return durationMs;
  }

  increment(counter: CounterName, amount = 1): void {
    this.counterValues[counter] += amount;
  }

  counters(): SessionLoadTelemetryCounters {
    return {
      ...this.counterValues,
      domNodes: typeof document === 'undefined' ? 0 : document.querySelectorAll('*').length,
      longTaskCount: this.longTasks.length,
      longTaskTotalMs: this.longTasks.reduce((total, duration) => total + duration, 0),
      longestTaskMs: Math.max(0, ...this.longTasks)
    };
  }

  cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
    this.longTasks = [];
  }

  finish(counts: {
    snapshotEvents: number;
    transcriptItems: number;
    toolCalls: number;
    debugEvents: number;
  }): SessionLoadMetrics {
    const metrics: SessionLoadMetrics = {
      operationId: this.operationId,
      agentId: this.agentId,
      sessionId: this.sessionId,
      totalMs: clock() - this.startedAt,
      phases: this.phases,
      ...this.counterValues,
      ...counts,
      domNodes: typeof document === 'undefined' ? 0 : document.querySelectorAll('*').length,
      longTaskCount: this.longTasks.length,
      longTaskTotalMs: this.longTasks.reduce((total, duration) => total + duration, 0),
      longestTaskMs: Math.max(0, ...this.longTasks)
    };
    if (typeof performance !== 'undefined') {
      try {
        performance.measure(`querymt.session-load.${this.operationId}`, this.markName('start'));
      } catch {
        // Performance marks are diagnostic-only and must not affect loading.
      }
    }
    console.info('querymt session/load metrics', metrics);
    this.cleanup();
    return metrics;
  }

  private mark(name: string): void {
    if (typeof performance !== 'undefined') performance.mark(this.markName(name));
  }

  private markName(name: string): string {
    return `querymt.session-load.${this.operationId}.${name}`;
  }
}

export type SessionLoadTelemetryCounters = Partial<
  Pick<
    SessionLoadMetrics,
    | 'liveNotifications'
    | 'drainedNotifications'
    | 'appliedNotifications'
    | 'duplicateNotifications'
    | 'replayCapturedNotifications'
    | 'replayReactiveNotifications'
    | 'historyAssignments'
    | 'snapshotEvents'
    | 'transcriptItems'
    | 'toolCalls'
    | 'debugEvents'
    | 'domNodes'
    | 'longTaskCount'
    | 'longTaskTotalMs'
    | 'longestTaskMs'
  >
>;

export function countSnapshotEvents(response: unknown): number {
  if (!response || typeof response !== 'object') return 0;
  const meta = (response as { _meta?: Record<string, unknown> })._meta;
  const snapshot = meta?.['querymt/sessionLoadSnapshot.v1'];
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const audit = (snapshot as { audit?: { events?: unknown[] } }).audit;
  return Array.isArray(audit?.events) ? audit.events.length : 0;
}
