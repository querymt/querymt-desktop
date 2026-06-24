import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@agentclientprotocol/sdk';
import { getRecentSessionRailItems, inferSessionStatus } from './sessions';
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
