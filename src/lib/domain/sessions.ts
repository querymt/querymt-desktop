import type { SessionInfo } from '@agentclientprotocol/sdk';
import type { DesktopSessionSummary, SessionStatus } from '$lib/domain/types';

export interface WorkspaceSessionGroup {
  key: string;
  name: string;
  path: string;
  sessions: DesktopSessionSummary[];
  latestActivity: string | null;
  agents: string[];
}

export function mapAcpSessionsToDesktopSessions(
  sessions: SessionInfo[],
  agent: { agentId: string; agentName: string }
): DesktopSessionSummary[] {
  return sessions.map((session) => ({
    agentId: agent.agentId,
    agentName: agent.agentName,
    sessionId: session.sessionId,
    title: session.title ?? 'Untitled session',
    cwd: session.cwd,
    updatedAt: session.updatedAt ?? null,
    runtimeId: agent.agentId,
    runtimeName: agent.agentName,
    source: 'acp',
    status: inferSessionStatus(session)
  }));
}

export function inferSessionStatus(session: SessionInfo): SessionStatus {
  if (session.sessionId === null) {
    return 'waiting';
  }

  if (session.updatedAt) {
    return 'active';
  }

  return 'waiting';
}

export function getSessionWorkspaceName(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) ?? cwd;
}

export function getSessionWorkspaceKey(cwd: string): string {
  return cwd.trim() || '__no_workspace__';
}

export function groupSessionsByWorkspace(sessions: DesktopSessionSummary[]): WorkspaceSessionGroup[] {
  const groups = new Map<string, DesktopSessionSummary[]>();

  for (const session of sessions) {
    const key = getSessionWorkspaceKey(session.cwd);
    const existing = groups.get(key) ?? [];
    existing.push(session);
    groups.set(key, existing);
  }

  return [...groups.entries()]
    .map(([key, groupSessions]) => {
      const sortedSessions = groupSessions.slice().sort(compareSessionsByActivity);
      const latestActivity = sortedSessions[0]?.updatedAt ?? null;
      const path = key === '__no_workspace__' ? 'No workspace path recorded' : key;
      return {
        key,
        name: key === '__no_workspace__' ? 'No workspace' : getSessionWorkspaceName(key),
        path,
        sessions: sortedSessions,
        latestActivity,
        agents: [...new Set(sortedSessions.map((session) => session.agentName))].sort((a, b) => a.localeCompare(b))
      };
    })
    .sort((a, b) => compareNullableTimestamps(b.latestActivity, a.latestActivity));
}

function compareSessionsByActivity(a: DesktopSessionSummary, b: DesktopSessionSummary): number {
  return compareNullableTimestamps(b.updatedAt, a.updatedAt);
}

function compareNullableTimestamps(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '');
}

export function formatSessionTimestamp(updatedAt: string | null): string {
  if (!updatedAt) {
    return 'No recent activity';
  }

  const value = new Date(updatedAt);
  if (Number.isNaN(value.getTime())) {
    return updatedAt;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(value);
}

export function getSessionById(
  sessions: DesktopSessionSummary[],
  sessionId: string,
  agentId?: string | null
): DesktopSessionSummary | null {
  return (
    sessions.find(
      (session) => session.sessionId === sessionId && (agentId ? session.agentId === agentId : true)
    ) ?? null
  );
}
