import { bench, describe } from 'vitest';
import { activeSessionFromLoadResponse } from '$lib/domain/session-snapshot';
import { reduceSessionReplay } from '$lib/domain/session-updates';
import { buildSessionConversation } from '$lib/domain/session-conversation';
import { createSyntheticSessionLoadFixture } from './session-load-fixture';

for (const scale of [0.125, 0.5, 1, 2]) {
  const fixture = createSyntheticSessionLoadFixture({ scale });

  describe(`session load ${scale}x`, () => {
    bench('snapshot hydration', () => {
      activeSessionFromLoadResponse(fixture.sessionId, fixture.response);
    });

    bench('captured ACP replay reduction', () => {
      const session = reduceSessionReplay(fixture.sessionId, fixture.notifications);
      void session.events.length;
    });

    const hydrated = activeSessionFromLoadResponse(fixture.sessionId, fixture.response);
    bench('conversation construction', () => {
      buildSessionConversation(hydrated);
    });
  });
}
