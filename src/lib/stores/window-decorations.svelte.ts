import { browser } from '$app/environment';
import { setWindowDecorationMode } from '$native';
import { isTauriRuntime } from '$lib/platform/runtime';

export type WindowDecorationMode = 'os' | 'custom';

const storageKey = 'querymt.windowDecorationMode';

class WindowDecorationsStore {
  mode = $state<WindowDecorationMode>('os');
  supported = $state(false);
  initialized = $state(false);
  error = $state<string | null>(null);

  get usesCustomTitlebar() {
    return this.mode === 'custom' && this.supported;
  }

  async initialize() {
    if (!browser || this.initialized) {
      return;
    }

    const savedMode = window.localStorage.getItem(storageKey);
    if (savedMode === 'custom' || savedMode === 'os') {
      this.mode = savedMode;
    }

    this.supported = isTauriRuntime();
    this.initialized = true;

    if (this.supported) {
      await this.applyMode();
    }
  }

  async setMode(mode: WindowDecorationMode) {
    this.mode = mode;
    this.error = null;

    if (browser) {
      window.localStorage.setItem(storageKey, mode);
    }

    if (this.supported) {
      await this.applyMode();
    }
  }

  async toggleCustomTitlebar(enabled: boolean) {
    await this.setMode(enabled ? 'custom' : 'os');
  }

  private async applyMode() {
    try {
      await setWindowDecorationMode(this.mode === 'os');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to update window decorations.';
    }
  }
}

export const windowDecorationsStore = new WindowDecorationsStore();
