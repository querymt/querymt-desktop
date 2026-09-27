import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@agentclientprotocol/sdk';
import { buildListSessionsRequest, formatSessionTimestamp, getRecentSessionRailItems, groupSessionsByWorkspace, inferSessionStatus, isRootSession, mapAcpSessionsToDesktopSessions, newestTimestamp } from './sessions';
import type { DesktopSessionSummary, SessionStatus } from './types';

function createDesktopSession(input: Partial<DesktopSessionSummary> & { sessionId: string }): DesktopSessionSummary {
  return {
    agentId: 'agent-1',
    agentName: 'QMTCODE',
    sessionId: input.sessionId,
    title: input.title ?? input.sessionId,
    cwd: input.cwd ?? '/tmp/project',
    updatedAt: input.updatedAt ?? null,
    runtimeId: input.runtimeId ?? 'agent-1',
    runtimeName: input.runtimeName ?? 'QMTCODE',
    source: 'acp',
    location: input.location,
    remoteNodeId: input.remoteNodeId,
    remoteNodeLabel: input.remoteNodeLabel,
    status: input.status ?? 'idle'
  };
}

function createSession(meta?: Record<string, unknown>): SessionInfo {
  return {
    sessionId: 'session-1',
    title: 'Test session',
    cwd: '/tmp/project',
    updatedAt: '2026-06-17T12:00:00Z',
    _meta: meta
  } as SessionInfo;
}

describe('session list request meta', () => {
  it('defaults ACP session/list requests to root scope meta', () => {
    expect(buildListSessionsRequest()).toEqual({
      _meta: { session_scope: 'root' }
    });
    expect(buildListSessionsRequest({ cwd: '/tmp/work', cursor: '10' })).toEqual({
      _meta: { session_scope: 'root' },
      cwd: '/tmp/work',
      cursor: '10'
    });
  });
});

describe('session relationship metadata', () => {
  it('maps durable fork hierarchy metadata from ACP session info', () => {
    const [session] = mapAcpSessionsToDesktopSessions(
      [
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
          runtimeStatus: 'idle',
          parentSessionId: 'parent-1',
          forkOrigin: 'user',
          sessionKind: 'custom',
          hasChildren: true,
          forkCount: 2
        })
      ],
      { agentId: 'agent-1', agentName: 'QueryMT' }
    );

    expect(session).toMatchObject({
      location: 'local',
      parentSessionId: 'parent-1',
      forkOrigin: 'user',
      sessionKind: 'custom',
      hasChildren: true,
      forkCount: 2
    });
  });

  it('parses relationship metadata independently of operational statistics', () => {
    const [session] = mapAcpSessionsToDesktopSessions(
      [createSession({ parentSessionId: 'parent-1', forkOrigin: 'delegation', hasChildren: false, forkCount: 0 })],
      { agentId: 'agent-1', agentName: 'QueryMT' }
    );

    expect(session.status).toBe('idle');
    expect(session).toMatchObject({
      parentSessionId: 'parent-1',
      forkOrigin: 'delegation',
      sessionKind: null,
      hasChildren: false,
      forkCount: 0
    });
  });

  it('defaults invalid or absent hierarchy metadata safely', () => {
    const [session] = mapAcpSessionsToDesktopSessions(
      [createSession({ parentSessionId: '', forkOrigin: 42, hasChildren: 'yes', forkCount: -1 })],
      { agentId: 'agent-1', agentName: 'QueryMT' }
    );

    expect(session).toMatchObject({
      parentSessionId: null,
      forkOrigin: null,
      sessionKind: null,
      hasChildren: false,
      forkCount: 0
    });
  });
});

describe('isRootSession', () => {
  it('treats sessions without a parent as root sessions', () => {
    expect(isRootSession(createDesktopSession({ sessionId: 'root-1' }))).toBe(true);
    expect(isRootSession({ ...createDesktopSession({ sessionId: 'root-2' }), parentSessionId: null })).toBe(true);
    expect(isRootSession({ ...createDesktopSession({ sessionId: 'root-3' }), parentSessionId: '   ' })).toBe(true);
  });

  it('rejects delegate and forked sessions that reference a parent session', () => {
    const delegateSession = { ...createDesktopSession({ sessionId: 'task-1', title: 'Task: explore repo' }), parentSessionId: 'root-1' };
    const forkedSession = { ...createDesktopSession({ sessionId: 'fork-1' }), parentSessionId: 'root-1', forkOrigin: 'user' };

    expect(isRootSession(delegateSession)).toBe(false);
    expect(isRootSession(forkedSession)).toBe(false);
  });
});

describe('workspace location', () => {
  it('classifies local, remote, and mixed workspace groups', () => {
    const local = createDesktopSession({ sessionId: 'local', cwd: '/tmp/local', location: 'local' });
    const remote = createDesktopSession({ sessionId: 'remote', cwd: '/tmp/remote', location: 'remote', remoteNodeId: 'node-1', remoteNodeLabel: 'sapr' });
    const mixedRemote = createDesktopSession({ sessionId: 'mixed-remote', cwd: '/tmp/mixed', location: 'remote', remoteNodeId: 'node-2' });
    const mixedLocal = createDesktopSession({ sessionId: 'mixed-local', cwd: '/tmp/mixed', location: 'local' });

    expect(groupSessionsByWorkspace([local, remote, mixedRemote, mixedLocal])).toEqual(expect.arrayContaining([
      expect.objectContaining({ cwd: '/tmp/local', location: 'local' }),
      expect.objectContaining({ cwd: '/tmp/remote', location: 'remote', remoteMachines: [{ id: 'node-1', label: 'sapr' }] }),
      expect.objectContaining({ cwd: '/tmp/mixed', location: 'mixed', remoteMachines: [{ id: 'node-2', label: null }] })
    ]));
  });
});

describe('inferSessionStatus', () => {
  it('maps running runtimeStatus to thinking', () => {
    expect(
      inferSessionStatus(
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
          runtimeStatus: 'running'
        })
      )
    ).toBe('thinking');
  });

  it('maps waiting runtimeStatus to waiting', () => {
    expect(
      inferSessionStatus(
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
          runtimeStatus: 'waiting'
        })
      )
    ).toBe('waiting');
  });

  it('maps cancel_requested runtimeStatus to cancelling', () => {
    expect(
      inferSessionStatus(
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
          runtimeStatus: 'cancel_requested'
        })
      )
    ).toBe('cancelling');
  });

  it('maps idle sessions with prior user messages to completed', () => {
    expect(
      inferSessionStatus(
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
          runtimeStatus: 'idle'
        })
      )
    ).toBe('completed');
  });

  it('maps idle sessions without prior user messages to idle', () => {
    expect(
      inferSessionStatus(
        createSession({
          messageCount: 0,
          userMessageCount: 0,
          hasErrors: false,
          runtimeStatus: 'idle'
        })
      )
    ).toBe('idle');
  });

  it('falls back to idle when session meta is missing', () => {
    expect(inferSessionStatus(createSession())).toBe('idle');
  });
});

describe('newestTimestamp', () => {
  it('returns the lexicographically newer ISO timestamp regardless of argument order', () => {
    expect(newestTimestamp('2026-06-17T12:00:00Z', '2026-06-17T12:05:00Z')).toBe('2026-06-17T12:05:00Z');
    expect(newestTimestamp('2026-06-17T12:05:00Z', '2026-06-17T12:00:00Z')).toBe('2026-06-17T12:05:00Z');
    expect(newestTimestamp('2026-06-17T12:00:00Z', '2026-06-17T12:00:00Z')).toBe('2026-06-17T12:00:00Z');
  });

  it('keeps the known timestamp when the incoming value is missing', () => {
    expect(newestTimestamp('2026-06-17T12:00:00Z', null)).toBe('2026-06-17T12:00:00Z');
    expect(newestTimestamp('2026-06-17T12:00:00Z', undefined)).toBe('2026-06-17T12:00:00Z');
    expect(newestTimestamp(null, '2026-06-17T12:00:00Z')).toBe('2026-06-17T12:00:00Z');
    expect(newestTimestamp(null, null)).toBeNull();
  });
});

describe('formatSessionTimestamp', () => {
  const now = Date.UTC(2026, 5, 17, 12, 30, 0);

  it('formats relative labels against the provided reference time', () => {
    expect(formatSessionTimestamp('2026-06-17T12:29:30Z', now)).toBe('just now');
    expect(formatSessionTimestamp('2026-06-17T12:29:00Z', now)).toBe('1 minute ago');
    expect(formatSessionTimestamp('2026-06-17T12:25:00Z', now)).toBe('5 minutes ago');
    expect(formatSessionTimestamp('2026-06-17T12:00:00Z', now)).toBe('30 minutes ago');
    expect(formatSessionTimestamp('2026-06-17T10:00:00Z', now)).toBe('2 hours ago');
    expect(formatSessionTimestamp('2026-06-14T10:00:00Z', now)).toBe('3 days ago');
  });

  it('accepts a Date reference for clock-driven rendering', () => {
    expect(formatSessionTimestamp('2026-06-17T12:20:00Z', new Date(now))).toBe('10 minutes ago');
  });

  it('falls back to the current clock when no reference is given', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatSessionTimestamp(recent)).toBe('just now');
  });

  it('keeps legacy behavior for missing and invalid values', () => {
    expect(formatSessionTimestamp(null)).toBe('No recent activity');
    expect(formatSessionTimestamp('not-a-date', now)).toBe('not-a-date');
  });
});

describe('getRecentSessionRailItems', () => {
  it('prioritizes attention sessions before active and recent sessions', () => {
    const sessions = [
      createDesktopSession({ sessionId: 'recent-newer', status: 'completed', updatedAt: '2026-06-17T12:04:00Z' }),
      createDesktopSession({ sessionId: 'active-older', status: 'thinking', updatedAt: '2026-06-17T12:01:00Z' }),
      createDesktopSession({ sessionId: 'attention-older', status: 'completed', updatedAt: '2026-06-17T12:00:00Z' }),
      createDesktopSession({ sessionId: 'active-newer', status: 'waiting', updatedAt: '2026-06-17T12:03:00Z' })
    ];

    const items = getRecentSessionRailItems(sessions, {
      attentionSessionKeys: ['agent-1:attention-older']
    });

    expect(items.map((item) => item.session.sessionId)).toEqual([
      'attention-older',
      'active-newer',
      'active-older',
      'recent-newer'
    ]);
    expect(items.map((item) => item.tone)).toEqual(['attention', 'active', 'active', 'recent']);
    expect(items.map((item) => item.requiresAttention)).toEqual([true, false, false, false]);
  });

  it('keeps active and action-required states simultaneously', () => {
    const sessions = [
      createDesktopSession({ sessionId: 'active-normal', status: 'thinking', updatedAt: '2026-06-17T12:05:00Z' }),
      createDesktopSession({ sessionId: 'active-question', status: 'waiting', updatedAt: '2026-06-17T12:01:00Z' })
    ];

    const items = getRecentSessionRailItems(sessions, {
      actionRequiredSessionKeys: ['agent-1:active-question']
    });

    expect(items.map((item) => item.session.sessionId)).toEqual(['active-question', 'active-normal']);
    expect(items[0]).toMatchObject({ isActive: true, requiresAttention: true, tone: 'attention' });
    expect(items[1]).toMatchObject({ isActive: true, requiresAttention: false, tone: 'active' });
  });

  it('limits rail items after priority sorting', () => {
    const sessions: DesktopSessionSummary[] = [
      createDesktopSession({ sessionId: 'recent', status: 'completed', updatedAt: '2026-06-17T12:03:00Z' }),
      createDesktopSession({ sessionId: 'attention', status: 'completed', updatedAt: '2026-06-17T12:00:00Z' }),
      createDesktopSession({ sessionId: 'active', status: 'thinking' as SessionStatus, updatedAt: '2026-06-17T12:01:00Z' })
    ];

    const items = getRecentSessionRailItems(sessions, {
      attentionSessionKeys: ['agent-1:attention'],
      limit: 2
    });

    expect(items.map((item) => item.session.sessionId)).toEqual(['attention', 'active']);
  });
});
