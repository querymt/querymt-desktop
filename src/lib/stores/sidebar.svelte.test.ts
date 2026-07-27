import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

let constrained = false;
let onViewportChange: ((event: MediaQueryListEvent) => void) | null = null;

async function loadStore() {
  vi.resetModules();
  return (await import('./sidebar.svelte')).sidebarStore;
}

beforeEach(() => {
  window.localStorage.clear();
  constrained = false;
  onViewportChange = null;
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: constrained,
    media: '(max-width: 1279px)',
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      onViewportChange = listener;
    }
  })));
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

  it('forces the compact rail while constrained without changing the saved preference', async () => {
    constrained = true;
    const store = await loadStore();
    store.initialize();

    expect(store.effectiveCollapsed).toBe(true);
    store.toggleCollapsed();
    expect(store.collapsed).toBe(false);
    expect(window.localStorage.getItem('querymt.sidebarCollapsed')).toBeNull();
  });

  it('restores the expanded preference when the viewport widens', async () => {
    constrained = true;
    const store = await loadStore();
    store.initialize();

    onViewportChange?.({ matches: false } as MediaQueryListEvent);

    expect(store.viewportConstrained).toBe(false);
    expect(store.effectiveCollapsed).toBe(false);
  });
});
