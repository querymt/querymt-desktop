import { browser } from '$app/environment';

export type SendShortcut = 'enter' | 'shift-enter' | 'ctrl-enter' | 'cmd-enter';

const storageKey = 'querymt.sendShortcut';

function isSendShortcut(value: string | null): value is SendShortcut {
  return value === 'enter' || value === 'shift-enter' || value === 'ctrl-enter' || value === 'cmd-enter';
}

export class ChatPreferencesStore {
  sendShortcut = $state<SendShortcut>('enter');
  initialized = $state(false);

  initialize() {
    if (!browser || this.initialized) {
      return;
    }

    const savedShortcut = window.localStorage.getItem(storageKey);
    if (isSendShortcut(savedShortcut)) {
      this.sendShortcut = savedShortcut;
    }

    this.initialized = true;
  }

  setSendShortcut(shortcut: SendShortcut) {
    this.sendShortcut = shortcut;

    if (browser) {
      window.localStorage.setItem(storageKey, shortcut);
    }
  }
}

export const chatPreferencesStore = new ChatPreferencesStore();
