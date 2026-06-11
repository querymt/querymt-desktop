import type { SessionInfo } from '@agentclientprotocol/sdk';
import type { DesktopSessionSummary, SessionStatus } from '$lib/domain/types';

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
