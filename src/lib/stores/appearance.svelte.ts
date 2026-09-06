import { browser } from '$app/environment';

export type AppearanceThemeMode = 'system' | 'light' | 'dark';

export type AccentColorId =
  | 'blue'
  | 'teal'
  | 'green'
  | 'amber'
  | 'orange'
  | 'red'
  | 'pink'
  | 'purple'
  | 'slate';

export interface AccentPreset {
  id: AccentColorId;
  label: string;
  /** Base color for the dark theme (brighter shade). */
  dark: string;
  /** Base color for the light theme (deeper shade). */
  light: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'blue', label: 'Blue', dark: '#60a5fa', light: '#3b82f6' },
  { id: 'teal', label: 'Teal', dark: '#2dd4bf', light: '#14b8a6' },
  { id: 'green', label: 'Green', dark: '#4ade80', light: '#22c55e' },
  { id: 'amber', label: 'Amber', dark: '#facc15', light: '#eab308' },
  { id: 'orange', label: 'Orange', dark: '#fb923c', light: '#f97316' },
  { id: 'red', label: 'Red', dark: '#f87171', light: '#ef4444' },
  { id: 'pink', label: 'Pink', dark: '#f472b6', light: '#ec4899' },
  { id: 'purple', label: 'Purple', dark: '#c084fc', light: '#a855f7' },
  { id: 'slate', label: 'Slate', dark: '#94a3b8', light: '#64748b' }
];

export const DEFAULT_ACCENT: AccentColorId = 'orange';

const storageKey = 'querymt.themeMode';
const accentStorageKey = 'querymt.accentColor';
const darkQuery = '(prefers-color-scheme: dark)';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

class AppearanceStore {
  themeMode = $state<AppearanceThemeMode>('system');
  resolvedTheme = $state<'light' | 'dark'>('light');
  accent = $state<AccentColorId>(DEFAULT_ACCENT);
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

    const savedAccent = window.localStorage.getItem(accentStorageKey);
    if (savedAccent && ACCENT_PRESETS.some((preset) => preset.id === savedAccent)) {
      this.accent = savedAccent as AccentColorId;
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

  setAccentColor(accent: AccentColorId) {
    this.accent = accent;

    if (browser) {
      window.localStorage.setItem(accentStorageKey, accent);
    }

    this.applyAccent();
  }

  private applyTheme() {
    if (!browser) {
      return;
    }

    const nextTheme = this.themeMode === 'system' ? (this.mediaQuery?.matches ? 'dark' : 'light') : this.themeMode;
    this.resolvedTheme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    this.applyAccent();
  }

  // Accent variables are applied as inline styles on <html> so they win over
  // the theme blocks in app.css; they are recomputed per resolved theme so
  // light/dark keep their tailored shades.
  private applyAccent() {
    if (!browser) {
      return;
    }

    const preset = ACCENT_PRESETS.find((entry) => entry.id === this.accent) ?? ACCENT_PRESETS[4];
    const dark = this.resolvedTheme === 'dark';
    const base = dark ? preset.dark : preset.light;
    const hover = dark ? `color-mix(in srgb, ${base}, white 30%)` : `color-mix(in srgb, ${base}, black 18%)`;
    const { r, g, b } = hexToRgb(base);
    const rgba = (alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
    const rootStyle = document.documentElement.style;

    rootStyle.setProperty('--accent', base);
    rootStyle.setProperty('--accent-hover', hover);
    rootStyle.setProperty('--accent-dim', rgba(dark ? 0.16 : 0.12));
    rootStyle.setProperty('--hazard', rgba(dark ? 0.18 : 0.14));
    rootStyle.setProperty('--rail', rgba(dark ? 0.28 : 0.22));
    rootStyle.setProperty('--selected-surface', rgba(dark ? 0.1 : 0.13));
    rootStyle.setProperty('--selected-border', rgba(dark ? 0.28 : 0.32));
  }
}

export const appearanceStore = new AppearanceStore();
