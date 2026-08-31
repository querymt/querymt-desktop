import { bench, describe } from 'vitest';
import { createSyntheticSessionLoadFixture } from './session-load-fixture';
import { runObservedSessionLoadPipeline } from './session-load-pipeline';

for (const scale of [0.125, 0.5, 1]) {
  const fixture = createSyntheticSessionLoadFixture({ scale });
  describe(`observed session pipeline ${scale}x`, () => {
    bench('live + response + duplicate sidecar drain', () => {
      const result = runObservedSessionLoadPipeline(
        fixture.sessionId,
        fixture.response,
        fixture.notificationsBeforeResponse,
        fixture.notificationsAfterResponse,
        fixture.notifications
      );
      void result.session.events.length;
    });
  });
}
