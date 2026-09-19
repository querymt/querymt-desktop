import { beforeEach, describe, expect, it } from 'vitest';
import { ChatPreferencesStore } from './chat-preferences.svelte';

const storageKey = 'querymt.sendShortcut';
const imageModeStorageKey = 'querymt.imageAttachmentMode';
const developerModeStorageKey = 'querymt.developerMode';
const inputDeliveryStorageKey = 'querymt.inputDelivery';

beforeEach(() => {
  window.localStorage.clear();
});

describe('ChatPreferencesStore', () => {
  it('defaults to Enter when no preference is saved', () => {
    const store = new ChatPreferencesStore();

    store.initialize();

    expect(store.sendShortcut).toBe('enter');
    expect(store.imageSendMode).toBe('image');
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

  it('restores and persists image attachment encoding', () => {
    window.localStorage.setItem(imageModeStorageKey, 'resource');
    const store = new ChatPreferencesStore();
    store.initialize();
    expect(store.imageSendMode).toBe('resource');

    store.setImageSendMode('image');
    expect(window.localStorage.getItem(imageModeStorageKey)).toBe('image');
  });

  it('disables developer mode by default', () => {
    const store = new ChatPreferencesStore();

    store.initialize();

    expect(store.developerMode).toBe(false);
  });

  it('restores and persists developer mode', () => {
    window.localStorage.setItem(developerModeStorageKey, 'true');
    const store = new ChatPreferencesStore();
    store.initialize();
    expect(store.developerMode).toBe(true);

    store.setDeveloperMode(false);
    expect(store.developerMode).toBe(false);
    expect(window.localStorage.getItem(developerModeStorageKey)).toBe('false');
  });

  it('persists shortcut changes', () => {
    const store = new ChatPreferencesStore();

    store.setSendShortcut('ctrl-enter');

    expect(store.sendShortcut).toBe('ctrl-enter');
    expect(window.localStorage.getItem(storageKey)).toBe('ctrl-enter');
  });

  it('defaults input delivery to steer', () => {
    const store = new ChatPreferencesStore();

    store.initialize();

    expect(store.inputDelivery).toBe('steer');
  });

  it('restores and persists input delivery preference', () => {
    window.localStorage.setItem(inputDeliveryStorageKey, 'queue');
    const store = new ChatPreferencesStore();
    store.initialize();
    expect(store.inputDelivery).toBe('queue');

    store.setInputDelivery('steer');
    expect(store.inputDelivery).toBe('steer');
    expect(window.localStorage.getItem(inputDeliveryStorageKey)).toBe('steer');
  });

  it('ignores invalid saved input delivery values', () => {
    window.localStorage.setItem(inputDeliveryStorageKey, 'bogus');
    const store = new ChatPreferencesStore();

    store.initialize();

    expect(store.inputDelivery).toBe('steer');
  });
});
