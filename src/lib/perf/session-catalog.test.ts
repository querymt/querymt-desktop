import { describe, expect, it } from 'vitest';
import { createSessionCatalogFixture, SESSION_CATALOG_BENCH_AGENT_ID, timeSessionCatalogLoad } from './session-catalog-fixture';

describe('session catalog load', () => {
  it('loads every page with runtime-derived statuses', async () => {
    const fixture = createSessionCatalogFixture(260, 50);
    await fixture.loadCatalog();
    await fixture.refreshAgent();
    const { store } = fixture;
    expect(store.sessionCatalog).toHaveLength(260);
    expect(store.sessionsByAgent[SESSION_CATALOG_BENCH_AGENT_ID]).toHaveLength(260);
    expect(store.sessionCatalog.every((session) => session.status === 'completed')).toBe(true);
    expect(Object.keys(store.sessionRuntimeBySession)).toHaveLength(260);
    fixture.dispose();
  });

  it('scales roughly linearly with the number of listed sessions', async () => {
    await timeSessionCatalogLoad(250, 1); // warm up the JIT
    const small = await timeSessionCatalogLoad(500);
    const large = await timeSessionCatalogLoad(2_000);
    // 4x sessions: linear work stays well under 8x; the quadratic regression measured ~16x.
    expect(large / small).toBeLessThan(8);
  }, 120_000);
});
