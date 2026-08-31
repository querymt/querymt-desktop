import { describe, expect, it } from 'vitest';
import { createSyntheticSessionLoadFixture } from './session-load-fixture';
import { runObservedSessionLoadPipeline } from './session-load-pipeline';

describe('observed session load pipeline', () => {
  it('deduplicates the sidecar drain after live replay', () => {
    const fixture = createSyntheticSessionLoadFixture({ scale: 0.125 });
    const result = runObservedSessionLoadPipeline(
      fixture.sessionId,
      fixture.response,
      fixture.notificationsBeforeResponse,
      fixture.notificationsAfterResponse,
      fixture.notifications
    );
    expect(result.appliedNotifications).toBe(fixture.notifications.length);
    expect(result.duplicateNotifications).toBe(fixture.notifications.length);
    expect(result.session.runState).toBe('completed');
  });
});
