import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const storageKey = 'querymt-desktop.workspaces';
const workspace = {
  id: 'ws-live-1',
  name: 'querymt-desktop',
  path: '/projects/querymt-desktop',
  status: 'indexed',
  defaultRuntime: 'QMTCODE'
};

async function loadStore() {
  vi.resetModules();
  return (await import('./workspaces.svelte')).workspacesStore;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('workspacesStore removal', () => {
  it('removes the workspace shortcut from app state and persistence', async () => {
    window.localStorage.setItem(storageKey, JSON.stringify([workspace]));
    const store = await loadStore();

    store.removeWorkspace(workspace.id);

    expect(store.items).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')).toEqual([]);
  });

  it('does not affect other saved workspace shortcuts', async () => {
    const second = { ...workspace, id: 'ws-live-2', name: 'api', path: '/projects/api' };
    window.localStorage.setItem(storageKey, JSON.stringify([workspace, second]));
    const store = await loadStore();

    store.removeWorkspace(workspace.id);

    expect(store.items).toEqual([second]);
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')).toEqual([second]);
  });
});
