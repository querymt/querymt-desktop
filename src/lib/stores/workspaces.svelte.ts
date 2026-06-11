import { open } from '@tauri-apps/plugin-dialog';
import type { WorkspaceItem } from '$lib/domain/types';

const WORKSPACES_STORAGE_KEY = 'querymt-desktop.workspaces';

class WorkspacesStore {
  private nextWorkspaceId = getNextWorkspaceId();

  items = $state<WorkspaceItem[]>(loadInitialWorkspaces());
  loading = $state(false);
  error = $state<string | null>(null);

  async addWorkspaceFromDialog() {
    this.loading = true;
    this.error = null;

    try {
      const selection = await open({
        directory: true,
        multiple: false,
        title: 'Choose a workspace folder'
      });

      if (!selection || Array.isArray(selection)) {
        return;
      }

      this.addWorkspace(selection);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to open workspace picker.';
    } finally {
      this.loading = false;
    }
  }

  private addWorkspace(path: string) {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }

    const existing = this.items.find((item) => item.path === normalizedPath);
    if (existing) {
      return;
    }

    const name = basename(normalizedPath);
    this.items = [
      {
        id: `ws-live-${this.nextWorkspaceId++}`,
        name,
        path: normalizedPath,
        status: 'attention',
        defaultRuntime: 'Select runtime'
      },
      ...this.items
    ];
    persistUserWorkspaces(this.items);
  }
}

function loadInitialWorkspaces(): WorkspaceItem[] {
  return loadPersistedWorkspaces();
}

function loadPersistedWorkspaces(): WorkspaceItem[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as WorkspaceItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getNextWorkspaceId(): number {
  const persisted = loadPersistedWorkspaces();
  const highest = persisted.reduce((max, item) => {
    const match = /^ws-live-(\d+)$/.exec(item.id);
    const current = match ? Number(match[1]) : 0;
    return Math.max(max, current);
  }, 0);

  return highest + 1;
}

function persistUserWorkspaces(items: WorkspaceItem[]) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const persisted = items.filter((item) => item.id.startsWith('ws-live-'));
  localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(persisted));
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

export const workspacesStore = new WorkspacesStore();
