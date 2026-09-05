import { browser } from '$app/environment';
import type { ImageSendMode } from '$lib/domain/types';

export type SendShortcut = 'enter' | 'shift-enter' | 'ctrl-enter' | 'cmd-enter';

const storageKey = 'querymt.sendShortcut';
const imageModeStorageKey = 'querymt.imageAttachmentMode';
const developerModeStorageKey = 'querymt.developerMode';

function isSendShortcut(value: string | null): value is SendShortcut {
  return value === 'enter' || value === 'shift-enter' || value === 'ctrl-enter' || value === 'cmd-enter';
}

function isImageSendMode(value: string | null): value is ImageSendMode {
  return value === 'image' || value === 'resource';
}

export class ChatPreferencesStore {
  sendShortcut = $state<SendShortcut>('enter');
  imageSendMode = $state<ImageSendMode>('image');
  developerMode = $state(false);
  initialized = $state(false);

  initialize() {
    if (!browser || this.initialized) {
      return;
    }

    const savedShortcut = window.localStorage.getItem(storageKey);
    if (isSendShortcut(savedShortcut)) {
      this.sendShortcut = savedShortcut;
    }

    const savedImageMode = window.localStorage.getItem(imageModeStorageKey);
    if (isImageSendMode(savedImageMode)) {
      this.imageSendMode = savedImageMode;
    }

    this.developerMode = window.localStorage.getItem(developerModeStorageKey) === 'true';

    this.initialized = true;
  }

  setSendShortcut(shortcut: SendShortcut) {
    this.sendShortcut = shortcut;

    if (browser) {
      window.localStorage.setItem(storageKey, shortcut);
    }
  }

  setImageSendMode(mode: ImageSendMode) {
    this.imageSendMode = mode;

    if (browser) {
      window.localStorage.setItem(imageModeStorageKey, mode);
    }
  }

  setDeveloperMode(enabled: boolean) {
    this.developerMode = enabled;

    if (browser) {
      window.localStorage.setItem(developerModeStorageKey, enabled ? 'true' : 'false');
    }
  }
}

export const chatPreferencesStore = new ChatPreferencesStore();
