import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { applySessionNotification, createEmptyActiveSession, reduceSessionReplay } from './session-updates';
import { createSyntheticSessionLoadFixture } from '$lib/perf/session-load-fixture';

/** The pre-optimization reducer: fold through the incremental, cloning path. */
function reduceSessionReplayIncremental(
  sessionId: string,
  notifications: readonly SessionNotification[]
) {
  let session = createEmptyActiveSession();
  session.sessionId = sessionId;
  for (const notification of notifications) {
    session = applySessionNotification(session, notification);
  }
  return session;
}

function normalize(session: ReturnType<typeof reduceSessionReplay>) {
  return JSON.parse(
    JSON.stringify(session, (key, value) => (key === 'timestampMs' ? 0 : value))
  );
}

describe('reduceSessionReplay fast path', () => {
  it('matches the incremental reducer on a synthetic session', () => {
    const fixture = createSyntheticSessionLoadFixture({ scale: 0.125 });
    const fast = reduceSessionReplay(fixture.sessionId, fixture.notifications);
    const incremental = reduceSessionReplayIncremental(
      fixture.sessionId,
      fixture.notifications
    );
    expect(normalize(fast)).toEqual(normalize(incremental));
  });

  it('matches the incremental reducer for streaming merges and reasoning parts', () => {
    const notifications = [
      {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'm-1',
          content: { type: 'text', text: 'hello ' }
        }
      },
      {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'm-1',
          content: { type: 'text', text: 'world' }
        }
      },
      {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          messageId: 'r-1',
          content: { type: 'text', text: 'hmm' },
          _meta: { 'querymt/reasoningPartId': 'p-1' }
        }
      },
      {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          messageId: 'r-1',
          content: { type: 'text', text: ' more' },
          _meta: { 'querymt/reasoningPartId': 'p-1' }
        }
      },
      {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 't-1',
          title: 'read',
          status: 'in_progress'
        }
      },
      {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't-1',
          status: 'completed',
          rawOutput: { ok: true }
        }
      },
      {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'usage_update',
          used: 10,
          size: 100
        }
      },
      {
        sessionId: 's-1',
        update: {
          sessionUpdate: 'plan',
          entries: [{ content: 'ship', priority: 'high', status: 'in_progress' }]
        }
      }
    ] as unknown as SessionNotification[];

    const fast = reduceSessionReplay('s-1', notifications);
    const incremental = reduceSessionReplayIncremental('s-1', notifications);
    expect(normalize(fast)).toEqual(normalize(incremental));
  });

  it('does not mutate the input notifications', () => {
    const fixture = createSyntheticSessionLoadFixture({ scale: 0.0625 });
    const before = JSON.stringify(fixture.notifications);
    reduceSessionReplay(fixture.sessionId, fixture.notifications);
    expect(JSON.stringify(fixture.notifications)).toBe(before);
  });
});
