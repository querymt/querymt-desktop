import { describe, expect, it } from 'vitest';
import { activeSessionFromLoadResponse } from '$lib/domain/session-snapshot';
import { applySessionNotification, createEmptyActiveSession } from '$lib/domain/session-updates';
import { createSyntheticSessionLoadFixture, TRACE_SESSION_LOAD_1X } from './session-load-fixture';

describe('synthetic session load fixture', () => {
  it('matches the observed 1x trace shape', () => {
    const fixture = createSyntheticSessionLoadFixture({ scale: 1 });
    expect(fixture.eventCount).toBe(TRACE_SESSION_LOAD_1X.events);
    expect(fixture.notifications).toHaveLength(TRACE_SESSION_LOAD_1X.notifications);
    expect(fixture.notificationsBeforeResponse).toHaveLength(TRACE_SESSION_LOAD_1X.notificationsBeforeResponse);
    expect(fixture.notificationsAfterResponse).toHaveLength(TRACE_SESSION_LOAD_1X.notificationsAfterResponse);
  });

  it('produces equivalent replay and snapshot history shapes', () => {
    const fixture = createSyntheticSessionLoadFixture({ scale: 0.125 });
    const snapshot = activeSessionFromLoadResponse(fixture.sessionId, fixture.response);
    let replay = createEmptyActiveSession();
    for (const notification of fixture.notifications) replay = applySessionNotification(replay, notification);

    expect(snapshot.toolCalls.length).toBeGreaterThan(0);
    expect(replay.toolCalls).toHaveLength(snapshot.toolCalls.length);
    expect(replay.transcript.length).toBeGreaterThanOrEqual(snapshot.transcript.length);
  });
});
