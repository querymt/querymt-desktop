import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSessionSummary } from '$lib/domain/types';
import DesktopSessionList from './DesktopSessionList.svelte';

const sessions: DesktopSessionSummary[] = [
  {
    agentId: 'agent-1',
    agentName: 'WS-QMT',
    sessionId: '8f2a91bc-1234-5678-9012-abcdefabcdef',
    title: 'Inspect workspace',
    cwd: '/projects/querymt',
    updatedAt: '2026-07-18T01:23:00Z',
    runtimeId: 'agent-1',
    runtimeName: 'WS-QMT',
    source: 'acp',
    status: 'completed'
  },
  {
    agentId: 'agent-2',
    agentName: 'QMTCODE',
    sessionId: 'session-2',
    title: 'Fix tests',
    cwd: '/projects/querymt',
    updatedAt: '2026-07-18T01:20:00Z',
    runtimeId: 'agent-2',
    runtimeName: 'QMTCODE',
    source: 'acp',
    status: 'idle'
  }
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DesktopSessionList', () => {
  it('shows agent names on sessions without workspace-level agent pills', async () => {
    const { container } = render(DesktopSessionList, { sessions, onOpenSession: vi.fn() });

    await waitFor(() => {
      expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
    });

    expect(container.querySelector('.session-workspace-agents')).toBeNull();
    expect(container.querySelector('.session-agent-chip')).toBeNull();
    const identicon = container.querySelector<SVGElement>('.session-identicon-svg');
    expect(identicon).not.toBeNull();
    expect(identicon?.style.getPropertyValue('--identicon-color').trim()).toMatch(/^#[0-9a-f]{6}$/i);
    expect(identicon?.querySelector('circle')).toHaveAttribute('fill', 'currentColor');
    expect(identicon?.querySelector('g')).toHaveAttribute('stroke', 'currentColor');
    expect(screen.getAllByText('WS-QMT')).toHaveLength(1);
    expect(screen.getAllByText('QMTCODE')).toHaveLength(1);
  });

  it('shows fork relationships and parent fork counts without inferring from titles', async () => {
    const hierarchySessions: DesktopSessionSummary[] = [
      { ...sessions[0], sessionId: 'parent', title: 'Parent', hasChildren: true, forkCount: 2 },
      { ...sessions[0], sessionId: 'user-fork', title: 'Branch', parentSessionId: 'parent', forkOrigin: 'user' },
      { ...sessions[0], sessionId: 'delegate', title: 'Worker', parentSessionId: 'parent', forkOrigin: 'delegation' },
      { ...sessions[0], sessionId: 'unknown-child', title: 'Child session', parentSessionId: 'parent', forkOrigin: 'future-origin' }
    ];

    render(DesktopSessionList, { sessions: hierarchySessions, onOpenSession: vi.fn() });

    expect(await screen.findByText('2 forks')).toBeInTheDocument();
    expect(screen.getByText('Fork')).toBeInTheDocument();
    expect(screen.getByText('Delegate')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('does not show relationship badges for a root session without hierarchy metadata', async () => {
    const { container } = render(DesktopSessionList, { sessions: [sessions[0]], onOpenSession: vi.fn() });
    await screen.findByText('Inspect workspace');
    expect(container.querySelector('.session-relationship-badge')).toBeNull();
  });

  it('shows a short session ID and copies the complete ID without opening the session', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });
    const onOpenSession = vi.fn();
    render(DesktopSessionList, { sessions, onOpenSession });

    expect(await screen.findByText('8f2a91bc')).toBeInTheDocument();
    expect(screen.queryByText('8f2a91bc-1234-5678-9012-abcdefabcdef')).not.toBeInTheDocument();

    await fireEvent.click(screen.getAllByRole('button', { name: 'Copy session ID' })[0]);

    expect(writeText).toHaveBeenCalledWith('8f2a91bc-1234-5678-9012-abcdefabcdef');
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Session ID copied' })).toBeInTheDocument();
  });

  it('opens sessions from the row navigation control', async () => {
    const onOpenSession = vi.fn();
    render(DesktopSessionList, { sessions, onOpenSession });

    await fireEvent.click(await screen.findByRole('button', { name: 'Open session Inspect workspace' }));

    expect(onOpenSession).toHaveBeenCalledWith(sessions[0]);
  });

  it('continues filtering sessions by agent name', async () => {
    render(DesktopSessionList, { sessions });

    await fireEvent.input(screen.getByPlaceholderText('Search sessions, workspaces, agents…'), {
      target: { value: 'WS-QMT' }
    });

    await waitFor(() => {
      expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
      expect(screen.queryByText('Fix tests')).not.toBeInTheDocument();
    });
  });

  it('only offers delete for supported agents and confirms in-app without opening the session', async () => {
    const onDeleteSession = vi.fn(async () => {});
    const onOpenSession = vi.fn();
    render(DesktopSessionList, {
      sessions,
      onOpenSession,
      onDeleteSession,
      canDeleteSession: (session) => session.agentId === 'agent-1'
    });

    const deleteButton = await screen.findByRole('button', { name: 'Delete session Inspect workspace' });
    expect(screen.queryByRole('button', { name: 'Delete session Fix tests' })).not.toBeInTheDocument();

    await fireEvent.click(deleteButton);

    const dialog = screen.getByRole('dialog', { name: 'Delete Session' });
    expect(dialog).toHaveTextContent('Permanently remove "Inspect workspace" from WS-QMT?');
    expect(dialog).toHaveTextContent('This cannot be undone');
    expect(onDeleteSession).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    expect(onDeleteSession).toHaveBeenCalledWith(sessions[0]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete Session' })).not.toBeInTheDocument());
  });

  it('keeps the session when the in-app deletion dialog is cancelled', async () => {
    const onDeleteSession = vi.fn(async () => {});
    render(DesktopSessionList, {
      sessions,
      onDeleteSession,
      canDeleteSession: () => true
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Delete session Inspect workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDeleteSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Delete Session' })).not.toBeInTheDocument();
  });

  it('reports a deletion failure in the dialog and restores the delete action', async () => {
    const onDeleteSession = vi.fn(async () => {
      throw new Error('Agent refused to delete the session.');
    });
    render(DesktopSessionList, {
      sessions,
      onDeleteSession,
      canDeleteSession: () => true
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Delete session Inspect workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Agent refused to delete the session.');
    expect(screen.getByRole('button', { name: /^Delete$/ })).toBeEnabled();
    expect(screen.getByRole('dialog', { name: 'Delete Session' })).toBeInTheDocument();
  });

  it('does not present an uninitialized workspace as having zero sessions', async () => {
    const onOpenWorkspace = vi.fn(async () => {});
    render(DesktopSessionList, {
      workspaceGroups: [createWorkspaceGroup({ initialized: false, sessions: [], hasMore: false })],
      onOpenWorkspace
    });

    expect(screen.getByLabelText('Sessions not loaded')).toHaveTextContent('—');
    expect(screen.queryByLabelText('0 loaded sessions')).not.toBeInTheDocument();
    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledWith('/projects/querymt'));
  });

  it('shows workspace loading, empty, paginated, and terminal count states accurately', () => {
    const tenSessions = Array.from({ length: 10 }, (_, index) => ({
      ...sessions[0],
      sessionId: `session-${index}`,
      title: `Session ${index}`
    }));
    render(DesktopSessionList, {
      workspaceGroups: [
        createWorkspaceGroup({ key: '/loading', cwd: '/loading', name: 'loading', initialized: false, loading: true }),
        createWorkspaceGroup({ key: '/empty', cwd: '/empty', name: 'empty', initialized: true }),
        createWorkspaceGroup({ key: '/more', cwd: '/more', name: 'more', sessions: tenSessions, initialized: true, hasMore: true }),
        createWorkspaceGroup({ key: '/done', cwd: '/done', name: 'done', sessions: tenSessions, initialized: true })
      ]
    });

    expect(screen.getByLabelText('Loading sessions')).toBeInTheDocument();
    expect(screen.getByLabelText('0 loaded sessions')).toHaveTextContent('0');
    expect(screen.getByLabelText('10 loaded sessions, more available')).toHaveTextContent('10+');
    expect(screen.getByLabelText('10 loaded sessions')).toHaveTextContent('10');
  });

  it('loads an unopened workspace and requests ten more when pagination is available', async () => {
    const onOpenWorkspace = vi.fn(async () => {});
    const onLoadMoreWorkspace = vi.fn(async () => {});
    const workspaceGroups = [createWorkspaceGroup({ sessions, initialized: false, hasMore: true })];
    render(DesktopSessionList, { workspaceGroups, onOpenWorkspace, onLoadMoreWorkspace });

    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledWith('/projects/querymt'));
    const loadMoreButton = screen.getByRole('button', { name: 'Load 10 more' });
    expect(loadMoreButton).toHaveClass('session-workspace-load-more');
    expect(loadMoreButton.querySelector('.lucide-chevron-down')).not.toBeNull();
    await fireEvent.click(loadMoreButton);

    expect(onLoadMoreWorkspace).toHaveBeenCalledWith('/projects/querymt');
    expect(screen.getByLabelText('Sessions not loaded')).toBeInTheDocument();
  });
});

function createWorkspaceGroup(overrides: Partial<{
  key: string;
  cwd: string;
  name: string;
  path: string;
  sessions: DesktopSessionSummary[];
  latestActivity: string | null;
  initialized: boolean;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
}> = {}) {
  return {
    key: '/projects/querymt',
    cwd: '/projects/querymt',
    name: 'querymt',
    path: overrides.cwd ?? '/projects/querymt',
    sessions: [],
    latestActivity: '2026-07-18T01:23:00Z',
    initialized: false,
    loading: false,
    hasMore: false,
    error: null,
    ...overrides
  };
}
