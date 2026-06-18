import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@agentclientprotocol/sdk';
import { inferSessionStatus } from './sessions';

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
