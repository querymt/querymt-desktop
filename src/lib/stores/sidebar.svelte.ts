import { browser } from '$app/environment';

const storageKey = 'querymt.sidebarCollapsed';

class SidebarStore {
  collapsed = $state(false);
  narrowOpen = $state(false);
  initialized = $state(false);

  initialize() {
    if (!browser || this.initialized) return;
    this.collapsed = window.localStorage.getItem(storageKey) === 'true';
    this.initialized = true;
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    if (browser) window.localStorage.setItem(storageKey, String(this.collapsed));
  }

  openNarrow() {
    this.narrowOpen = true;
  }

  closeNarrow() {
    this.narrowOpen = false;
  }
}

export const sidebarStore = new SidebarStore();
