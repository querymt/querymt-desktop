import { browser } from '$app/environment';

export type AppearanceThemeMode = 'system' | 'light' | 'dark';

const storageKey = 'querymt.themeMode';
const darkQuery = '(prefers-color-scheme: dark)';

class AppearanceStore {
  themeMode = $state<AppearanceThemeMode>('system');
  resolvedTheme = $state<'light' | 'dark'>('light');
  initialized = $state(false);

  private mediaQuery: MediaQueryList | null = null;
  private mediaListener = () => this.applyTheme();

  initialize() {
    if (!browser || this.initialized) {
      return;
    }

    const savedMode = window.localStorage.getItem(storageKey);
    if (savedMode === 'system' || savedMode === 'light' || savedMode === 'dark') {
      this.themeMode = savedMode;
    }

    this.mediaQuery = window.matchMedia(darkQuery);
    this.mediaQuery.addEventListener('change', this.mediaListener);
    this.initialized = true;
    this.applyTheme();
  }

  setThemeMode(mode: AppearanceThemeMode) {
    this.themeMode = mode;

    if (browser) {
      window.localStorage.setItem(storageKey, mode);
    }

    this.applyTheme();
  }

  private applyTheme() {
    if (!browser) {
      return;
    }

    const nextTheme = this.themeMode === 'system' ? (this.mediaQuery?.matches ? 'dark' : 'light') : this.themeMode;
    this.resolvedTheme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
  }
}

export const appearanceStore = new AppearanceStore();
