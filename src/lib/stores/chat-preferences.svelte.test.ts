import { beforeEach, describe, expect, it } from 'vitest';
import { ChatPreferencesStore } from './chat-preferences.svelte';

const storageKey = 'querymt.sendShortcut';

beforeEach(() => {
  window.localStorage.clear();
});

describe('ChatPreferencesStore', () => {
  it('defaults to Enter when no preference is saved', () => {
    const store = new ChatPreferencesStore();

    store.initialize();

    expect(store.sendShortcut).toBe('enter');
  });

  it('restores a saved send shortcut', () => {
    window.localStorage.setItem(storageKey, 'shift-enter');
    const store = new ChatPreferencesStore();

    store.initialize();

    expect(store.sendShortcut).toBe('shift-enter');
  });

  it('ignores invalid saved values', () => {
    window.localStorage.setItem(storageKey, 'space');
    const store = new ChatPreferencesStore();

    store.initialize();

    expect(store.sendShortcut).toBe('enter');
  });

  it('persists shortcut changes', () => {
    const store = new ChatPreferencesStore();

    store.setSendShortcut('ctrl-enter');

    expect(store.sendShortcut).toBe('ctrl-enter');
    expect(window.localStorage.getItem(storageKey)).toBe('ctrl-enter');
  });
});
