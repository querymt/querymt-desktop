import { bench, describe } from 'vitest';
import { activeSessionFromLoadResponse, prependOlderHistory } from '$lib/domain/session-snapshot';
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

// A windowed load returns only the most recent events plus `history`/`summary`;
// one older-history page is then merged in front on scroll.
describe('session windowed load 1x', () => {
  const fixture = createSyntheticSessionLoadFixture({ scale: 1 });
  const events = (fixture.response as unknown as {
    _meta: { 'querymt/sessionLoadSnapshot.v1': { audit: { events: unknown[] } } };
  })._meta['querymt/sessionLoadSnapshot.v1'].audit.events;
  const WINDOW_EVENTS = 600;
  // Lifecycle filler events do not render; window over the conversation events.
  const visible = (events as Array<{ kind: { type: string } }>).filter(
    (event) => event.kind.type !== 'hook_notice' && event.kind.type !== 'progress_recorded'
  );
  const windowEvents = visible.slice(-WINDOW_EVENTS);
  const olderPage = visible.slice(-2 * WINDOW_EVENTS, -WINDOW_EVENTS);
  const windowedResponse = {
    configOptions: [],
    _meta: {
      'querymt/sessionLoadSnapshot.v1': {
        audit: { events: windowEvents },
        history: { complete: false, before: 'bench-token' }
      }
    }
  };

  bench('windowed load + one older-history page', () => {
    const session = activeSessionFromLoadResponse(fixture.sessionId, windowedResponse);
    const merged = prependOlderHistory(session, { events: olderPage });
    // An explicit previous-turn list bypasses the conversation memo cache.
    buildSessionConversation(merged, []);
  });
});
