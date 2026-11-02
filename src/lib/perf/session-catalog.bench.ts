import { bench, describe } from 'vitest';
import { createSessionCatalogFixture } from './session-catalog-fixture';

for (const count of [250, 1_000, 2_000]) {
  describe(`session catalog ${count}`, () => {
    bench(
      'catalog load + discovery + routine re-list',
      async () => {
        const fixture = createSessionCatalogFixture(count);
        await fixture.loadCatalog();
        await fixture.refreshAgent();
        fixture.dispose();
      },
      { iterations: 5, warmupIterations: 1 }
    );
  });
}
