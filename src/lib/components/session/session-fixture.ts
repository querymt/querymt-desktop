import type { ActiveSessionViewModel } from '$lib/domain/types';

/** Shared `ActiveSessionViewModel` fixture for session component tests. */
export function session(overrides: Partial<ActiveSessionViewModel> = {}): ActiveSessionViewModel {
  return {
    sessionId: 'session-1',
    transcript: [],
    toolCalls: [],
    plans: [],
    events: [],
    configOptions: [],
    runState: 'idle',
    activityLabel: null,
    activeToolCallId: null,
    lastStopReason: null,
    lastError: null,
    usage: { contextUsed: null, contextLimit: null, cumulativeCostUsd: null, activeWorkMs: 0, activeWorkStartedAt: null },
    undo: { stack: [], pendingOperation: null, lastRevertedFiles: [], lastMessage: null },
    ...overrides
  };
}
