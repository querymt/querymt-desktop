import type { AgentRuntimeStatus, RuntimeCard as RuntimeCardType } from '$lib/domain/types';

export function buildLiveRuntimeCards(params: {
  statuses: Record<string, AgentRuntimeStatus>;
  sessionCounts: Record<string, number>;
}): RuntimeCardType[] {
  return Object.values(params.statuses).map((status) => ({
    id: status.agentId,
    name: status.agentId,
    profile: status.state,
    workspace: status.commandLine,
    model: status.version || 'ACP stdio agent',
    status:
      status.state === 'running'
        ? 'running'
        : status.state === 'starting'
          ? 'starting'
          : status.state === 'failed'
            ? 'degraded'
            : 'stopped',
    activeSessions: params.sessionCounts[status.agentId] ?? 0,
    lastActivity: status.message
  }));
}
