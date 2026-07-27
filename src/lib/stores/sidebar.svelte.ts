import { browser } from '$app/environment';

const storageKey = 'querymt.sidebarCollapsed';
const constrainedViewportQuery = '(max-width: 1279px)';

class SidebarStore {
  collapsed = $state(false);
  viewportConstrained = $state(false);
  initialized = $state(false);

  get effectiveCollapsed() {
    return this.collapsed || this.viewportConstrained;
  }

  initialize() {
    if (!browser || this.initialized) return;
    this.collapsed = window.localStorage.getItem(storageKey) === 'true';

    const mediaQuery = window.matchMedia(constrainedViewportQuery);
    this.viewportConstrained = mediaQuery.matches;
    mediaQuery.addEventListener('change', (event) => {
      this.viewportConstrained = event.matches;
    });

    this.initialized = true;
  }

  toggleCollapsed() {
    if (this.viewportConstrained) return;
    this.collapsed = !this.collapsed;
    if (browser) window.localStorage.setItem(storageKey, String(this.collapsed));
  }
}

export const sidebarStore = new SidebarStore();
