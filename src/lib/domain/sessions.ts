import type { SessionInfo } from '@agentclientprotocol/sdk';
import type { DesktopSessionSummary, SessionStatus } from '$lib/domain/types';
import {
  SessionRuntimeStatus as QuerymtSessionRuntimeStatus,
  type SessionMeta as QuerymtSessionMeta
} from '$lib/querymt/generated/types';

export type SessionRailTone = 'attention' | 'active' | 'recent';

export interface WorkspaceSessionGroup {
  key: string;
  name: string;
  path: string;
  sessions: DesktopSessionSummary[];
  latestActivity: string | null;
}

export interface SessionRailItem {
  key: string;
  session: DesktopSessionSummary;
  tone: SessionRailTone;
  isActive: boolean;
  requiresAttention: boolean;
}

export interface SessionRailOptions {
  attentionSessionKeys?: Iterable<string>;
  actionRequiredSessionKeys?: Iterable<string>;
  limit?: number;
}

const ACTIVE_SESSION_STATUSES = new Set<SessionStatus>(['thinking', 'waiting', 'cancelling']);

export function buildSessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

export function getSessionKey(session: Pick<DesktopSessionSummary, 'agentId' | 'sessionId'>): string {
  return buildSessionKey(session.agentId, session.sessionId);
}

export function isActiveSessionStatus(status: SessionStatus): boolean {
  return ACTIVE_SESSION_STATUSES.has(status);
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
  const meta = readSessionMeta(session);
  if (!meta) {
    return 'idle';
  }

  switch (meta.runtimeStatus) {
    case QuerymtSessionRuntimeStatus.Running:
      return 'thinking';
    case QuerymtSessionRuntimeStatus.Waiting:
      return 'waiting';
    case QuerymtSessionRuntimeStatus.CancelRequested:
      return 'cancelling';
    case QuerymtSessionRuntimeStatus.Idle:
    default:
      return meta.userMessageCount > 0 ? 'completed' : 'idle';
  }
}

function readSessionMeta(session: SessionInfo): QuerymtSessionMeta | null {
  const meta = session._meta;
  if (!meta || typeof meta !== 'object') {
    return null;
  }

  const candidate = meta as Partial<QuerymtSessionMeta>;
  if (
    typeof candidate.messageCount !== 'number' ||
    typeof candidate.userMessageCount !== 'number' ||
    typeof candidate.hasErrors !== 'boolean' ||
    typeof candidate.runtimeStatus !== 'string'
  ) {
    return null;
  }

  return candidate as QuerymtSessionMeta;
}

export function getSessionWorkspaceName(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) ?? cwd;
}

export function getSessionWorkspaceKey(cwd: string): string {
  return cwd.trim() || '__no_workspace__';
}

export function getRecentSessionRailItems(
  sessions: DesktopSessionSummary[],
  options: SessionRailOptions = {}
): SessionRailItem[] {
  const attentionKeys = new Set(options.attentionSessionKeys ?? []);
  const actionRequiredKeys = new Set(options.actionRequiredSessionKeys ?? []);
  const limit = options.limit ?? 12;

  return sessions
    .map((session) => {
      const key = getSessionKey(session);
      const isActive = isActiveSessionStatus(session.status);
      const requiresAttention = attentionKeys.has(key) || actionRequiredKeys.has(key);
      const tone: SessionRailTone = requiresAttention ? 'attention' : isActive ? 'active' : 'recent';
      return { key, session, tone, isActive, requiresAttention };
    })
    .sort(compareSessionRailItems)
    .slice(0, limit);
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
        latestActivity
      };
    })
    .sort((a, b) => compareNullableTimestamps(b.latestActivity, a.latestActivity));
}

function compareSessionRailItems(a: SessionRailItem, b: SessionRailItem): number {
  const priorityDifference = getSessionRailPriority(a) - getSessionRailPriority(b);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const activityDifference = compareNullableTimestamps(b.session.updatedAt, a.session.updatedAt);
  if (activityDifference !== 0) {
    return activityDifference;
  }

  return a.session.title.localeCompare(b.session.title);
}

function getSessionRailPriority(item: SessionRailItem): number {
  if (item.requiresAttention) return 0;
  if (item.isActive) return 1;
  return 2;
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
