import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspacesStore = vi.hoisted(() => ({
  items: [] as Array<{ id: string; name: string; path: string; status: 'attention'; defaultRuntime: string }>,
  loading: false,
  error: null as string | null,
  addWorkspaceFromDialog: vi.fn(async () => undefined),
  addWorkspacePath: vi.fn(),
  removeWorkspace: vi.fn()
}));
const runtime = vi.hoisted(() => ({ isEmbedded: false }));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore: { setComposerCwd: vi.fn() } }));
vi.mock('$lib/stores/workspaces.svelte', () => ({ workspacesStore }));
vi.mock('$lib/platform/runtime', () => ({
  get isEmbedded() {
    return runtime.isEmbedded;
  }
}));

import WorkspacesPage from './+page.svelte';

beforeEach(() => {
  workspacesStore.items = [];
  workspacesStore.loading = false;
  workspacesStore.error = null;
  runtime.isEmbedded = false;
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('Workspaces page', () => {
  it('offers a labelled neutral Add folder button in the header', async () => {
    workspacesStore.items = [{ id: 'w1', name: 'repo', path: '/tmp/repo', status: 'attention', defaultRuntime: 'x' }];
    render(WorkspacesPage);

    const button = screen.getByRole('button', { name: 'Add folder' });
    expect(button).not.toHaveClass('action-btn-primary');
    await fireEvent.click(button);
    expect(workspacesStore.addWorkspaceFromDialog).toHaveBeenCalledOnce();
  });

  it('keeps one primary Add folder action in the empty state', () => {
    render(WorkspacesPage);

    const buttons = screen.getAllByRole('button', { name: 'Add folder' });
    expect(buttons).toHaveLength(2);
    expect(buttons.filter((b) => b.classList.contains('action-btn-primary'))).toHaveLength(1);
  });

  it('shows a busy header button that ignores clicks while the picker is open', async () => {
    workspacesStore.loading = true;
    workspacesStore.items = [{ id: 'w1', name: 'repo', path: '/tmp/repo', status: 'attention', defaultRuntime: 'x' }];
    render(WorkspacesPage);

    const busy = screen.getByRole('button', { name: /Opening folder picker/ });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).not.toBeDisabled();
    await fireEvent.click(busy);
    expect(workspacesStore.addWorkspaceFromDialog).not.toHaveBeenCalled();
  });

  it('uses a neutral Add server path button for embedded servers', () => {
    runtime.isEmbedded = true;
    render(WorkspacesPage);

    expect(screen.queryByRole('button', { name: 'Add folder' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add server path' })).not.toHaveClass('action-btn-primary');
  });
});
