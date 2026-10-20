import { browser } from '$app/environment';

const storageKey = 'querymt.sidebarCollapsed';
const pinnedSessionsStorageKey = 'querymt.sidebarShowPinnedSessions';
const constrainedViewportQuery = '(max-width: 1279px)';

class SidebarStore {
  collapsed = $state(false);
  showPinnedSessions = $state(false);
  viewportConstrained = $state(false);
  initialized = $state(false);

  get effectiveCollapsed() {
    return this.collapsed || this.viewportConstrained;
  }

  initialize() {
    if (!browser || this.initialized) return;
    try {
      this.collapsed = window.localStorage.getItem(storageKey) === 'true';
      this.showPinnedSessions = window.localStorage.getItem(pinnedSessionsStorageKey) === 'true';
    } catch {
      // Unavailable storage leaves the default sidebar preferences in place.
    }

    const mediaQuery = window.matchMedia(constrainedViewportQuery);
    this.viewportConstrained = mediaQuery.matches;
    mediaQuery.addEventListener('change', (event) => {
      this.viewportConstrained = event.matches;
    });

    this.initialized = true;
  }

  setShowPinnedSessions(enabled: boolean) {
    this.showPinnedSessions = enabled;
    try {
      if (browser) window.localStorage.setItem(pinnedSessionsStorageKey, String(enabled));
    } catch {
      // The preference still applies for this window if persistence is unavailable.
    }
  }

  toggleCollapsed() {
    if (this.viewportConstrained) return;
    this.collapsed = !this.collapsed;
    if (browser) window.localStorage.setItem(storageKey, String(this.collapsed));
  }
}

export const sidebarStore = new SidebarStore();
