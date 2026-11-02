import type { ListSessionsRequest, ListSessionsResponse, SessionInfo } from '@agentclientprotocol/sdk';
import { AgentsStore } from '$lib/stores/agents.svelte';
import type { SessionLifecycleFilter } from '$lib/domain/types';

// Unfiltered so agents without lifecycle support stay in scope.
const ALL_SESSIONS: SessionLifecycleFilter = { resolution: 'any', archive: 'any' };

export interface SessionCatalogFixture {
  store: AgentsStore;
  pageSize: number;
  sessions: SessionInfo[];
  /** Reload the full catalog (session browser path) and every-page agent discovery. */
  loadCatalog: () => Promise<void>;
  /** Routine polling re-list of the first page (the duplicate loader in the trace). */
  refreshAgent: () => Promise<void>;
  dispose: () => void;
}

const AGENT_ID = 'bench-agent';

/** Synthetic `session/list` rows mirroring the profiled /sessions load: every row carries runtime observation + delegation activity. */
export function createListedSessions(count: number): SessionInfo[] {
  return Array.from({ length: count }, (_, index) => {
    const sessionId = `session-${index.toString().padStart(6, '0')}`;
    return {
      sessionId,
      cwd: `/work/project-${index % 25}`,
      title: `Session ${index}`,
      updatedAt: new Date(Date.UTC(2026, 9, 1) + index * 60_000).toISOString(),
      _meta: {
        messageCount: 4, userMessageCount: 2, hasErrors: false,
        runtimeStatus: {
          phase: 'idle', active_run_id: null, steerable: false, pending_steering_count: 0, queued_input_count: 0,
          observation: { availability: 'inactive', epoch: 'actor-1', revision: 1 },
          delegation_activity: []
        }
      }
    } as SessionInfo;
  });
}

export function createSessionCatalogFixture(count: number, pageSize = 50): SessionCatalogFixture {
  const sessions = createListedSessions(count);
  const client = {
    listSessions: async (request: ListSessionsRequest): Promise<ListSessionsResponse> => {
      const start = request.cursor ? Number(request.cursor) : 0;
      const end = Math.min(sessions.length, start + pageSize);
      return { sessions: sessions.slice(start, end), nextCursor: end < sessions.length ? String(end) : undefined };
    },
    listModels: async () => [],
    supportsSessionLifecycle: () => false,
    supportsSessionPins: () => false,
    supportsQuerymtMethod: () => false,
    supportsQuerymtFeature: () => false,
    getControlCapabilities: () => null,
    getSessionRuntimeStatus: () => new Promise(() => {})
  };
  const store = new AgentsStore();
  store.configs = [{ id: AGENT_ID, name: 'Bench', transport: 'stdio', commandLine: 'qmt --acp', enabled: true, autoStart: false }];
  store.statuses = { [AGENT_ID]: { agentId: AGENT_ID, state: 'running', commandLine: 'qmt --acp', pid: 1, version: '1', message: 'Running', lastError: null } };
  // The benchmark drives the real list pipeline against an in-memory client; no transport is involved.
  (store as unknown as { clients: Map<string, unknown> }).clients.set(AGENT_ID, {
    client, connectionState: 'initialized', initializeResponse: { protocolVersion: 1, agentCapabilities: {} }, error: null,
    unsubscribeSessionUpdates: null, unsubscribeExtensionNotifications: null, unsubscribeConnectionLoss: null,
    unsubscribeInbox: null, recentSessionUpdateKeys: []
  });
  return {
    store,
    pageSize,
    sessions,
    loadCatalog: async () => {
      await store.refreshSessionCatalog(ALL_SESSIONS, true);
      await store.refreshSessionsForAgent(AGENT_ID, true, true);
    },
    refreshAgent: () => store.refreshSessionsForAgent(AGENT_ID, false, true),
    dispose: () => store.dispose()
  };
}

export const SESSION_CATALOG_BENCH_AGENT_ID = AGENT_ID;

/** Mean wall time (ms) of one cold catalog load + discovery + routine re-list at `count` sessions. */
export async function timeSessionCatalogLoad(count: number, runs = 3): Promise<number> {
  let total = 0;
  for (let run = 0; run < runs; run++) {
    const fixture = createSessionCatalogFixture(count);
    const started = performance.now();
    await fixture.loadCatalog();
    await fixture.refreshAgent();
    total += performance.now() - started;
    fixture.dispose();
  }
  return total / runs;
}
