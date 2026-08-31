import { bench, describe } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import ActiveSessionView from '$lib/components/primitives/ActiveSessionView.svelte';
import { activeSessionFromLoadResponse } from '$lib/domain/session-snapshot';
import { createSyntheticSessionLoadFixture } from './session-load-fixture';

for (const scale of [0.125, 0.5, 1]) {
  const fixture = createSyntheticSessionLoadFixture({ scale });
  const session = activeSessionFromLoadResponse(fixture.sessionId, fixture.response);
  describe(`session render ${scale}x`, () => {
    bench(
      'ActiveSessionView mount and destroy',
      () => {
        const view = render(ActiveSessionView, { session });
        const nodes = view.container.querySelectorAll('*').length;
        view.unmount();
        cleanup();
        void nodes;
      },
      { iterations: 5, warmupIterations: 1 }
    );
  });
}
