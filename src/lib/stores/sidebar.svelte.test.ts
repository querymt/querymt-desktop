import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

async function loadStore() {
  vi.resetModules();
  return (await import('./sidebar.svelte')).sidebarStore;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('sidebarStore', () => {
  it('defaults to expanded and persists collapse preference', async () => {
    const store = await loadStore();
    store.initialize();

    expect(store.collapsed).toBe(false);
    store.toggleCollapsed();
    expect(store.collapsed).toBe(true);
    expect(window.localStorage.getItem('querymt.sidebarCollapsed')).toBe('true');
  });

  it('restores a saved collapsed preference', async () => {
    window.localStorage.setItem('querymt.sidebarCollapsed', 'true');
    const store = await loadStore();
    store.initialize();

    expect(store.collapsed).toBe(true);
  });

  it('opens and closes narrow-window navigation', async () => {
    const store = await loadStore();
    store.openNarrow();
    expect(store.narrowOpen).toBe(true);
    store.closeNarrow();
    expect(store.narrowOpen).toBe(false);
  });
});
