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

// localStorage can be unavailable in restricted webviews or privacy modes;
// treat every storage failure as a no-op instead of breaking the UI.
function readStorage(key: string): string | null {
  if (!browser) return null;
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (!browser) return;
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Ignore persistence failures.
  }
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

    const savedShortcut = readStorage(storageKey);
    if (isSendShortcut(savedShortcut)) {
      this.sendShortcut = savedShortcut;
    }

    const savedImageMode = readStorage(imageModeStorageKey);
    if (isImageSendMode(savedImageMode)) {
      this.imageSendMode = savedImageMode;
    }

    this.developerMode = readStorage(developerModeStorageKey) === 'true';

    const savedInputDelivery = readStorage(inputDeliveryStorageKey);
    if (isSessionInputDeliveryMode(savedInputDelivery)) {
      this.inputDelivery = savedInputDelivery;
    }

    this.initialized = true;
  }

  setSendShortcut(shortcut: SendShortcut) {
    this.sendShortcut = shortcut;
    writeStorage(storageKey, shortcut);
  }

  setImageSendMode(mode: ImageSendMode) {
    this.imageSendMode = mode;
    writeStorage(imageModeStorageKey, mode);
  }

  setDeveloperMode(enabled: boolean) {
    this.developerMode = enabled;
    writeStorage(developerModeStorageKey, enabled ? 'true' : 'false');
  }

  setInputDelivery(delivery: SessionInputDeliveryMode) {
    this.inputDelivery = delivery;
    writeStorage(inputDeliveryStorageKey, delivery);
  }
}

export const chatPreferencesStore = new ChatPreferencesStore();
