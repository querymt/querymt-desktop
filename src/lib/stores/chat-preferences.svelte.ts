import { browser } from '$app/environment';
import type { ImageSendMode, SessionInputDeliveryMode } from '$lib/domain/types';

export type SendShortcut = 'enter' | 'shift-enter' | 'ctrl-enter' | 'cmd-enter';

const storageKey = 'querymt.sendShortcut';
const imageModeStorageKey = 'querymt.imageAttachmentMode';
const developerModeStorageKey = 'querymt.developerMode';
const inputDeliveryStorageKey = 'querymt.inputDelivery';

function isSendShortcut(value: string | null): value is SendShortcut {
  return value === 'enter' || value === 'shift-enter' || value === 'ctrl-enter' || value === 'cmd-enter';
}

function isImageSendMode(value: string | null): value is ImageSendMode {
  return value === 'image' || value === 'resource';
}

function isSessionInputDeliveryMode(value: string | null): value is SessionInputDeliveryMode {
  return value === 'steer' || value === 'queue';
}

export class ChatPreferencesStore {
  sendShortcut = $state<SendShortcut>('enter');
  imageSendMode = $state<ImageSendMode>('image');
  developerMode = $state(false);
  inputDelivery = $state<SessionInputDeliveryMode>('steer');
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

    const savedInputDelivery = window.localStorage.getItem(inputDeliveryStorageKey);
    if (isSessionInputDeliveryMode(savedInputDelivery)) {
      this.inputDelivery = savedInputDelivery;
    }

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

  setInputDelivery(delivery: SessionInputDeliveryMode) {
    this.inputDelivery = delivery;

    if (browser) {
      window.localStorage.setItem(inputDeliveryStorageKey, delivery);
    }
  }
}

export const chatPreferencesStore = new ChatPreferencesStore();
