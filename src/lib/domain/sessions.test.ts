import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@agentclientprotocol/sdk';
import { buildListSessionChildrenRequest, getSessionGroupCwd, compareSessionsByPin, readSessionPin, sessionMatchesLifecycle, buildListSessionsRequest, formatSessionTimestamp, getRecentSessionRailItems, groupSessionsByWorkspace, inferSessionStatus, isRootSession, mapAcpSessionsToDesktopSessions, newestTimestamp } from './sessions';
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

describe('session pin metadata and requests', () => {
  it('parses only authoritative, valid pin metadata without changing lifecycle or activity', () => {
    expect(readSessionPin(undefined, 's')).toBeNull();
    expect(readSessionPin({ pin: { pinned: 'true', pinned_at: null } }, 's')).toBeNull();
    expect(readSessionPin({ pin: { pinned: true, pinned_at: 'not a date' } }, 's')).toBeNull();
    expect(readSessionPin({ pin: { pinned: false, pinned_at: null } }, 's')).toEqual({ session_id: 's', pinned: false, pinned_at: null });
    const [summary] = mapAcpSessionsToDesktopSessions([createSession({ querymt: { pin: { pinned: true, pinned_at: '2026-10-20T10:00:00Z' } } })], { agentId: 'a', agentName: 'A' });
    expect(summary.pin?.pinned).toBe(true);
    expect(summary.lifecycle).toBeNull();
    expect(summary.updatedAt).toBe('2026-06-17T12:00:00Z');
  });
  it('composes pin and lifecycle filters and rejects mesh aggregation explicitly', () => {
    expect(buildListSessionsRequest({ pinned: true, lifecycle: { resolution: 'resolved', archive: 'only' } })._meta).toEqual({
      session_scope: 'root', querymt: { sessionFilters: { resolution: 'resolved', archive: 'only', pinned: true } }
    });
    expect(() => buildListSessionsRequest({ pinned: false, remoteNodeIds: ['peer'] })).toThrow('directly connected');
  });
});

describe('compareSessionsByPin', () => {
  function pinned(sessionId: string, timestamp: string): DesktopSessionSummary {
    const pin = readSessionPin({ pin: { pinned: true, pinned_at: timestamp } }, sessionId);
    expect(pin).not.toBeNull();
    return { ...createDesktopSession({ sessionId }), pin };
  }

  it.each([
    ['fractional seconds', '2026-10-20T10:00:00.500Z', '2026-10-20T10:00:00Z'],
    ['UTC offsets', '2026-10-20T10:30:00Z', '2026-10-20T12:00:00+02:00']
  ])('orders valid pin %s chronologically, newest first', (_label, newer, older) => {
    const rows = [pinned('older', older), pinned('newer', newer)];
    expect(rows.sort(compareSessionsByPin).map((session) => session.sessionId)).toEqual(['newer', 'older']);
  });

  it('uses the stable full session key for equivalent instants with different timestamp spellings', () => {
    const rows = [pinned('c', '2026-10-20T10:00:00Z'), pinned('b', '2026-10-20T10:00:00.000Z'),
      pinned('a', '2026-10-20T12:00:00+02:00')];
    rows.push({ ...pinned('a', '2026-10-20T10:00:00Z'), agentId: 'agent-2' });
    expect(rows.sort(compareSessionsByPin).map((session) => `${session.agentId}:${session.sessionId}`))
      .toEqual(['agent-1:a', 'agent-1:b', 'agent-1:c', 'agent-2:a']);
  });

  it('keeps absent and known-unpinned metadata behind valid pins with a stable tie-break', () => {
    const absent = createDesktopSession({ sessionId: 'a' });
    const unpinned = { ...createDesktopSession({ sessionId: 'b' }), pin: readSessionPin({ pin: { pinned: false, pinned_at: null } }, 'b') };
    expect([unpinned, absent, pinned('c', '1969-12-31T23:59:59Z')].sort(compareSessionsByPin).map((session) => session.sessionId))
      .toEqual(['c', 'a', 'b']);
  });
});

function runtimeMeta(phase: string): Record<string, unknown> {
  return { phase, steerable: phase !== 'idle', pending_steering_count: 0, queued_input_count: 0 };
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
    expect(buildListSessionsRequest({ remoteNodeIds: ['node-1'] })._meta).toEqual({
      session_scope: 'root', remoteNodeIds: ['node-1']
    });
  });
});

describe('session lifecycle metadata', () => {
  const lifecycle = { session_id: 'session-1', resolved: true, archived: true, resolved_at: '2026-10-18T00:00:00Z', archived_at: '2026-10-01T00:00:00Z' };
  it('preserves independent owner-sourced lifecycle fields without changing runtime inference', () => {
    const [summary] = mapAcpSessionsToDesktopSessions([createSession({ querymt: { lifecycle }, messageCount: 2, userMessageCount: 1, hasErrors: true, runtimeStatus: runtimeMeta('model') })], { agentId: 'agent-1', agentName: 'Agent' });
    expect(summary.lifecycle).toEqual(lifecycle);
    expect(summary.status).toBe('thinking');
  });
  it('does not invent lifecycle state when the metadata is missing or belongs to another session', () => {
    for (const meta of [{}, { querymt: { lifecycle: { ...lifecycle, session_id: 'other' } } }, { querymt: { lifecycle: { resolved: false } } }]) {
      expect(mapAcpSessionsToDesktopSessions([createSession(meta)], { agentId: 'a', agentName: 'A' })[0].lifecycle).toBeNull();
    }
    expect(sessionMatchesLifecycle(null, { resolution: 'open', archive: 'excluded' })).toBe(false);
    expect(sessionMatchesLifecycle(null, { resolution: 'any', archive: 'any' })).toBe(true);
  });
  it('serializes archive + resolution predicates alongside root, workspace and remote scope', () => {
    expect(buildListSessionsRequest({ cwd: '/tmp/work', cursor: '10', remoteNodeIds: ['owner'], lifecycle: { resolution: 'open', archive: 'only' } })).toEqual({ cwd: '/tmp/work', cursor: '10', _meta: { session_scope: 'root', remoteNodeIds: ['owner'], querymt: { sessionFilters: { resolution: 'open', archive: 'only' } } } });
  });
});

describe('session relationship metadata', () => {
  it('maps remote location and peer identity without attachment', () => {
    const [session] = mapAcpSessionsToDesktopSessions(
      [createSession({ location: 'remote', nodeId: 'peer-1', nodeLabel: 'Laptop', connectionState: 'disconnected' })],
      { agentId: 'agent-1', agentName: 'QueryMT' }
    );
    expect(session).toMatchObject({ location: 'remote', remoteNodeId: 'peer-1', remoteNodeLabel: 'Laptop', remoteConnectionState: 'disconnected' });
  });

  it('does not treat disconnected bookmarks without owner relationship metadata as roots', () => {
    const [session] = mapAcpSessionsToDesktopSessions(
      [createSession({ location: 'remote', nodeId: 'peer-1', connectionState: 'disconnected' })],
      { agentId: 'agent-1', agentName: 'QueryMT' }
    );
    expect(isRootSession(session)).toBe(false);
  });

  it('maps only owner-supplied remote profile metadata', () => {
    const [remote] = mapAcpSessionsToDesktopSessions(
      [createSession({ location: 'remote', nodeId: 'peer-1', profileId: 'owner-profile', profileLabel: 'Owner Profile' })],
      { agentId: 'agent-1', agentName: 'QueryMT' }
    );
    expect(remote).toMatchObject({ remoteProfileId: 'owner-profile', remoteProfileLabel: 'Owner Profile' });
    const [local] = mapAcpSessionsToDesktopSessions(
      [createSession({ profileId: 'owner-profile', profileLabel: 'Owner Profile' })],
      { agentId: 'agent-1', agentName: 'QueryMT' }
    );
    expect(local.remoteProfileId).toBeUndefined();
    expect(local.remoteProfileLabel).toBeUndefined();
  });

  it('maps durable fork hierarchy metadata from ACP session info', () => {
    const [session] = mapAcpSessionsToDesktopSessions(
      [
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
          runtimeStatus: runtimeMeta('idle'),
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

    expect(session.status).toBe('unknown');
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

  it('rejects partial child metadata without guessing from titles or session kinds', () => {
    const root = createDesktopSession({ sessionId: 'root', title: 'Task: ordinary root' });
    expect(isRootSession({ ...root, forkOrigin: 'delegation' })).toBe(false);
    expect(isRootSession({ ...root, forkOrigin: 'user' })).toBe(false);
    const recurringRoot = { ...root, sessionKind: 'recurring' };
    expect(isRootSession(recurringRoot)).toBe(true);
    expect(isRootSession({ ...root, relationshipKnown: false })).toBe(false);
  });

  it('rejects delegate and forked sessions that reference a parent session', () => {
    const delegateSession = { ...createDesktopSession({ sessionId: 'task-1', title: 'Task: explore repo' }), parentSessionId: 'root-1' };
    const forkedSession = { ...createDesktopSession({ sessionId: 'fork-1' }), parentSessionId: 'root-1', forkOrigin: 'user' };

    expect(isRootSession(delegateSession)).toBe(false);
    expect(isRootSession(forkedSession)).toBe(false);
  });
});

describe('worktree session metadata', () => {
  const workspace = { workspaceId: 'ws_1', branch: 'qmt/ws_1', checkoutPath: '/w/ws_1', sourceCwd: '/p/app', baselineMode: 'head', lifecycle: 'ready' };

  it('maps workspace and access metadata and groups under the source cwd', () => {
    const [summary] = mapAcpSessionsToDesktopSessions([
      { ...createSession({ forkOrigin: 'worktree', parentSessionId: 'p', querymt: { workspace, sessionAccess: { mode: 'read_only', ownerSessionId: 'o' } } }), cwd: '/w/ws_1' } as SessionInfo
    ], { agentId: 'a', agentName: 'A' });
    expect(summary.workspace?.branch).toBe('qmt/ws_1');
    expect(summary.access?.ownerSessionId).toBe('o');
    expect(summary.cwd).toBe('/w/ws_1');
    expect(getSessionGroupCwd(summary)).toBe('/p/app');
    expect(groupSessionsByWorkspace([summary])[0].cwd).toBe('/p/app');
  });

  it('leaves sessions without metadata untouched', () => {
    const [summary] = mapAcpSessionsToDesktopSessions([createSession()], { agentId: 'a', agentName: 'A' });
    expect(summary.workspace).toBeNull();
    expect(summary.access).toBeNull();
    expect(getSessionGroupCwd(summary)).toBe('/tmp/project');
  });

  it('builds the children request', () => {
    expect(buildListSessionChildrenRequest('p1')).toEqual({ _meta: { session_scope: 'children', querymt: { parentSessionId: 'p1' } } });
    expect(buildListSessionChildrenRequest('p1', 'c2').cursor).toBe('c2');
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
  it.each(['model', 'tools', 'closing'] as const)('maps active %s runtime to thinking, including closing', (phase) => {
    expect(
      inferSessionStatus(
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
runtimeStatus: runtimeMeta(phase)
        })
      )
    ).toBe('thinking');
  });

  it('maps native waiting execution to active, not human input needed', () => {
    expect(
      inferSessionStatus(
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
          runtimeStatus: runtimeMeta('waiting')
        })
      )
    ).toBe('thinking');
  });

  it('maps cancel_requested runtimeStatus to cancelling', () => {
    expect(
      inferSessionStatus(
        createSession({
          messageCount: 2,
          userMessageCount: 1,
          hasErrors: false,
          runtimeStatus: runtimeMeta('cancel_requested')
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
          runtimeStatus: runtimeMeta('idle')
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
          runtimeStatus: runtimeMeta('idle')
        })
      )
    ).toBe('idle');
  });

  it('reports unknown when session meta is missing', () => {
    expect(inferSessionStatus(createSession())).toBe('unknown');
  });
});

describe('newestTimestamp', () => {
  it('returns the newer ISO timestamp regardless of argument order', () => {
    expect(newestTimestamp('2026-06-17T12:00:00Z', '2026-06-17T12:05:00Z')).toBe('2026-06-17T12:05:00Z');
    expect(newestTimestamp('2026-06-17T12:05:00Z', '2026-06-17T12:00:00Z')).toBe('2026-06-17T12:05:00Z');
    expect(newestTimestamp('2026-06-17T12:00:00Z', '2026-06-17T12:00:00Z')).toBe('2026-06-17T12:00:00Z');
  });

  it('compares by parsed instant when fractional precision differs', () => {
    expect(newestTimestamp('2026-06-17T12:00:00Z', '2026-06-17T12:00:00.500Z')).toBe(
      '2026-06-17T12:00:00.500Z'
    );
    expect(newestTimestamp('2026-06-17T12:00:00.500Z', '2026-06-17T12:00:00Z')).toBe(
      '2026-06-17T12:00:00.500Z'
    );
  });

  it('compares by parsed instant when timezone offsets differ', () => {
    // 2026-06-17T12:00:00+02:00 is 10:00Z, which is older than 10:30Z even
    // though it sorts higher as a raw string.
    expect(newestTimestamp('2026-06-17T12:00:00+02:00', '2026-06-17T10:30:00Z')).toBe(
      '2026-06-17T10:30:00Z'
    );
    expect(newestTimestamp('2026-06-17T10:30:00Z', '2026-06-17T12:00:00+02:00')).toBe(
      '2026-06-17T10:30:00Z'
    );
    // Equal instants in different offsets keep the current stamp.
    expect(newestTimestamp('2026-06-17T12:00:00Z', '2026-06-17T14:00:00+02:00')).toBe(
      '2026-06-17T12:00:00Z'
    );
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
