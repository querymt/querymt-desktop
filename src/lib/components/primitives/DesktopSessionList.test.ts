import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { createSessionBrowserState, getSessionKey, RECENT_SESSION_GROUP_KEY } from '$lib/domain/sessions';
import type { DesktopSessionSummary } from '$lib/domain/types';
import DesktopSessionList from './DesktopSessionList.svelte';
import { SessionSearchClient } from '$lib/domain/session-search-client';
import type { SessionSearchMatch } from '$lib/domain/session-search';

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
    lifecycle: { session_id: '8f2a91bc-1234-5678-9012-abcdefabcdef', resolved: false, archived: false, resolved_at: null, archived_at: null },
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
    lifecycle: { session_id: 'session-2', resolved: false, archived: false, resolved_at: null, archived_at: null },
    status: 'idle'
  }
];

async function searchFor(value: string) {
  await fireEvent.input(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value } });
  await waitFor(() => expect(screen.queryByText('Updating search results')).not.toBeInTheDocument());
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DesktopSessionList pinned sessions', () => {
  const pinned = Array.from({ length: 12 }, (_, index) => ({ ...sessions[0], sessionId: `pin-${index}`, title: `Pinned task ${index}`,
    pin: { session_id: `pin-${index}`, pinned: true, pinned_at: `2026-10-20T10:${String(index).padStart(2, '0')}:00Z` }
  }));
  it('places pins above recents and workspaces, removes recent duplicates, and reveals ten at a time', async () => {
    const { container } = render(DesktopSessionList, { sessions: [...pinned, sessions[1]], pinnedSessions: pinned,
      recentSessionKeys: [...pinned, sessions[1]].map(getSessionKey), catalogComplete: true });
    const groups = container.querySelectorAll<HTMLElement>('.session-workspace-item');
    expect(within(groups[0]).getByText('Pinned sessions')).toBeInTheDocument();
    expect(within(groups[1]).getByText('Recent sessions')).toBeInTheDocument();
    const pinGroup = within(groups[0]);
    expect(pinGroup.getAllByRole('button', { name: /^Open session/ })).toHaveLength(10);
    expect(pinGroup.getAllByRole('button', { name: /^Open session/ })[0]).toHaveAccessibleName('Open session Pinned task 11');
    expect(within(groups[1]).queryByText('Pinned task 0')).not.toBeInTheDocument();
    expect(pinGroup.queryByTitle('Copy project path')).not.toBeInTheDocument();
    await fireEvent.click(pinGroup.getByRole('button', { name: 'Load 10 more' }));
    expect(pinGroup.getAllByRole('button', { name: /^Open session/ })).toHaveLength(12);
  });
  it('finds old pins not in the activity catalog and honors lifecycle and search filters', async () => {
    const old = { ...pinned[0], lifecycle: { ...pinned[0].lifecycle!, archived: true, resolved: true } };
    render(DesktopSessionList, { sessions: [sessions[1]], pinnedSessions: [old], catalogComplete: true });
    expect(screen.queryByText('Pinned sessions')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(screen.getByText('Pinned sessions')).toBeInTheDocument();
    expect(screen.getAllByText('Pinned task 0').length).toBeGreaterThan(0);
    await searchFor('nonexistent');
    expect(screen.queryByText('Pinned sessions')).not.toBeInTheDocument();
  });
});

describe('DesktopSessionList recent sessions', () => {
  it('shows recents as the first expanded workspace with ten rows and local load-more', async () => {
    const catalog = Array.from({ length: 24 }, (_, index) => ({
      ...sessions[0], sessionId: `recent-${index}`, title: `Recent task ${index}`, cwd: `/projects/project-${index % 2}`,
      updatedAt: `2026-07-${String(index + 1).padStart(2, '0')}T01:00:00Z`
    }));
    const onLoadMoreWorkspace = vi.fn();
    const onCreateWorkspaceSession = vi.fn();
    const onOpenSession = vi.fn();
    const { container } = render(DesktopSessionList, {
      sessions: catalog, recentSessionKeys: catalog.map(getSessionKey), catalogComplete: true,
      onLoadMoreWorkspace, onCreateWorkspaceSession, onOpenSession
    });
    const groups = container.querySelectorAll<HTMLElement>('.session-workspace-item');
    const recent = within(groups[0]);
    expect(recent.getByText('Recent sessions')).toBeInTheDocument();
    expect(recent.getByRole('button', { name: /^Recent sessions/ })).toHaveAttribute('aria-expanded', 'true');
    expect(recent.getAllByRole('button', { name: /^Open session/ }).map((row) => row.getAttribute('aria-label')))
      .toEqual(catalog.slice(0, 10).map((session) => `Open session ${session.title}`));
    expect(recent.queryByRole('button', { name: /^New session/ })).not.toBeInTheDocument();
    expect(recent.queryByTitle('Copy project path')).not.toBeInTheDocument();
    expect(recent.getAllByText('project-0')).toHaveLength(5);
    expect(groups).toHaveLength(3);
    expect(groups[0].querySelector('.session-workspace-icon .lucide-clock-3')).not.toBeNull();
    await fireEvent.click(recent.getByRole('button', { name: 'Open session Recent task 0' }));
    expect(onOpenSession).toHaveBeenCalledWith(catalog[0]);
    await fireEvent.click(recent.getByRole('button', { name: 'Load 10 more' }));
    expect(recent.getAllByRole('button', { name: /^Open session/ })).toHaveLength(20);
    expect(onLoadMoreWorkspace).not.toHaveBeenCalled();
    await fireEvent.click(recent.getByRole('button', { name: 'Load 10 more' }));
    expect(recent.getAllByRole('button', { name: /^Open session/ })).toHaveLength(24);
    expect(recent.queryByRole('button', { name: 'Load 10 more' })).not.toBeInTheDocument();
  });

  it('filters recents by lifecycle, runtime, location, and workspace search before limiting', async () => {
    const catalog = [
      ...Array.from({ length: 12 }, (_, index) => ({ ...sessions[0], sessionId: `open-${index}`, title: `Open ${index}` })),
      { ...sessions[1], title: 'Remote result', cwd: '/projects/remote-project', location: 'remote' as const, status: 'thinking' as const,
        lifecycle: { ...sessions[1].lifecycle!, resolved: true } }
    ];
    const { container } = render(DesktopSessionList, { sessions: catalog, recentSessionKeys: catalog.map(getSessionKey), catalogComplete: true, showRemoteSessions: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    const recent = () => within(container.querySelector<HTMLElement>('.session-workspace-item')!);
    expect(recent().getByText('Remote result')).toBeInTheDocument();
    expect(recent().queryByText('Open 0')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Runtime' })).getByRole('radio', { name: 'Running' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Location' })).getByRole('radio', { name: 'Remote' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    await searchFor('remote-project');
    expect(recent().getByText('Recent sessions')).toBeInTheDocument();
    expect(recent().getByText('Remote result')).toBeInTheDocument();
    await searchFor('missing');
    expect(screen.queryByText('Recent sessions')).not.toBeInTheDocument();
  });

  it('never invents missing rows or promotes child/unknown summaries and does not duplicate recents', () => {
    const child = { ...sessions[0], sessionId: 'child', parentSessionId: 'root' };
    const fork = { ...sessions[0], sessionId: 'fork', forkOrigin: 'delegation' };
    const unknown = { ...sessions[0], sessionId: 'unknown', relationshipKnown: false };
    const catalog = [sessions[0], child, fork, unknown];
    const { container } = render(DesktopSessionList, {
      sessions: catalog, catalogComplete: true,
      recentSessionKeys: [...catalog.map(getSessionKey), getSessionKey(sessions[0]), 'agent-1:missing']
    });
    const recent = within(container.querySelector<HTMLElement>('.session-workspace-item')!);
    expect(recent.getByText('Recent sessions')).toBeInTheDocument();
    expect(recent.getAllByRole('button', { name: /^Open session/ })).toHaveLength(1);
  });

  it('restores the Recent group expansion and independent row limit', () => {
    const catalog = Array.from({ length: 22 }, (_, index) => ({ ...sessions[0], sessionId: `recent-${index}`, title: `Recent ${index}` }));
    const browserState = {
      ...createSessionBrowserState(), groupsInitialized: true, recentGroupInitialized: true,
      openGroups: ['/projects/querymt'], visibleLimits: { [RECENT_SESSION_GROUP_KEY]: 20 }
    };
    const first = render(DesktopSessionList, { sessions: catalog, browserState, catalogComplete: true, recentSessionKeys: catalog.map(getSessionKey) });
    expect(screen.getByRole('button', { name: /^Recent sessions/ })).toHaveAttribute('aria-expanded', 'false');
    first.unmount();
    render(DesktopSessionList, { sessions: catalog, browserState: { ...browserState, openGroups: [RECENT_SESSION_GROUP_KEY] }, catalogComplete: true, recentSessionKeys: catalog.map(getSessionKey) });
    expect(screen.getByRole('button', { name: /^Recent sessions/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: /^Open session/ })).toHaveLength(20);
  });

  it('does not show an empty Recent group before the first visit or when its rows leave the catalog', async () => {
    const { rerender } = render(DesktopSessionList, { sessions, catalogComplete: true });
    expect(screen.queryByText('Recent sessions')).not.toBeInTheDocument();
    await rerender({ sessions: [], catalogComplete: true, recentSessionKeys: sessions.map(getSessionKey) });
    expect(screen.queryByText('Recent sessions')).not.toBeInTheDocument();
  });
});

describe('DesktopSessionList', () => {
  it('delays loading chrome while keeping the pending state distinct from an empty catalog', async () => {
    vi.useFakeTimers();
    const { container } = render(DesktopSessionList, { loading: true });
    expect(container.querySelector('.session-browser-body')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByLabelText('Loading sessions')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(200);
    await tick();
    expect(screen.getByLabelText('Loading sessions')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(container.querySelector('.state-inline-progress')).toBeNull();
  });

  it('does not flash a skeleton or loading status on fast loads or a completed fast view switch', async () => {
    vi.useFakeTimers();
    const { rerender, container } = render(DesktopSessionList, { loading: true, catalogComplete: true });
    await vi.advanceTimersByTimeAsync(80);
    await rerender({ loading: false, catalogComplete: true, sessions });
    await vi.advanceTimersByTimeAsync(200);
    await tick();
    expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading sessions')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await rerender({ loading: true, catalogComplete: true, sessions });
    await vi.advanceTimersByTimeAsync(50);
    await rerender({ loading: false, catalogComplete: true, sessions });
    await vi.advanceTimersByTimeAsync(200);
    await tick();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('.state-inline-progress')).toBeNull();
  });

  it('shows current-load progress in the placeholder and restores the original when finished', async () => {
    vi.useFakeTimers();
    const { rerender } = render(DesktopSessionList, { sessions, loading: true, catalogComplete: true, loadedSessionCount: 12 });
    const input = screen.getByRole('textbox', { name: 'Search sessions' });
    expect(input).toHaveAttribute('placeholder', 'Search sessions, workspaces, agents…');
    await vi.advanceTimersByTimeAsync(200);
    await tick();
    expect(input).toHaveAttribute('placeholder', 'Loading remaining sessions… 12 loaded');
    expect(screen.getByRole('status')).toHaveTextContent('Loading remaining sessions… 12 loaded');
    await rerender({ sessions, loading: true, catalogComplete: true, loadedSessionCount: 25 });
    expect(input).toHaveAttribute('placeholder', 'Loading remaining sessions… 25 loaded');
    await rerender({ sessions, loading: false, catalogComplete: true, loadedSessionCount: 25 });
    expect(input).toHaveAttribute('placeholder', 'Search sessions, workspaces, agents…');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not invent a total or replace the query while loading, and restores the placeholder on failure', async () => {
    vi.useFakeTimers();
    const { rerender } = render(DesktopSessionList, { sessions, loading: true, catalogComplete: true, loadedSessionCount: 0 });
    const input = screen.getByRole('textbox', { name: 'Search sessions' });
    await vi.advanceTimersByTimeAsync(200);
    await tick();
    expect(input).toHaveAttribute('placeholder', 'Loading remaining sessions…');
    await fireEvent.input(input, { target: { value: 'Inspect' } });
    await rerender({ sessions, loading: true, catalogComplete: true, loadedSessionCount: 3 });
    expect(input).toHaveValue('Inspect');
    expect(input).toHaveAttribute('placeholder', 'Searching remaining history… 3 loaded');
    await rerender({ sessions, loading: false, catalogComplete: true, loadedSessionCount: 3, error: 'Remote owner offline' });
    expect(input).toHaveValue('Inspect');
    expect(input).toHaveAttribute('placeholder', 'Search sessions, workspaces, agents…');
  });

  it('offers the right recovery for empty and disconnected states', async () => {
    const onCreateSession = vi.fn();
    const { unmount } = render(DesktopSessionList, { onCreateSession, emptyMessage: 'Start a task first.' });

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(onCreateSession).toHaveBeenCalledOnce();
    unmount();

    const onOpenAgents = vi.fn();
    render(DesktopSessionList, { disconnected: true, onOpenAgents });
    expect(screen.getByText('No agents connected')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Open agents' }));
    expect(onOpenAgents).toHaveBeenCalledOnce();
  });

  it.each([
    ['resolved', 'No resolved sessions', 'Sessions you mark as resolved appear here.', 'View open sessions'],
    ['archived', 'No archived sessions', 'Sessions you archive appear here.', 'View all sessions']
  ] as const)('shows category-specific recovery for an empty %s view', async (view, title, description, action) => {
    const onCreateSession = vi.fn();
    const { container } = render(DesktopSessionList, { sessions, catalogComplete: true, hasAnySessions: true, onCreateSession });
    await fireEvent.click(screen.getByRole('button', { name: view === 'resolved' ? 'Resolved' : 'Archived' }));
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New session' })).not.toBeInTheDocument();
    const actions = container.querySelector('.session-empty-actions');
    expect(actions).not.toBeNull();
    expect(within(actions as HTMLElement).getAllByRole('button')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: action }));
    expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
  });

  it('offers a new session only when the whole catalog is known to be empty', async () => {
    const onCreateSession = vi.fn();
    const { container } = render(DesktopSessionList, { sessions: [], hasAnySessions: false, onCreateSession, catalogComplete: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.queryByText('No archived sessions')).not.toBeInTheDocument();
    const actions = container.querySelector('.session-empty-actions')!;
    expect(within(actions as HTMLElement).getAllByRole('button')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(onCreateSession).toHaveBeenCalledOnce();
  });

  it('does not treat a filtered empty response as proof that no sessions exist', async () => {
    render(DesktopSessionList, { sessions: [], catalogComplete: true, hasAnySessions: null, onCreateSession: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByText('No resolved sessions')).toBeInTheDocument();
    expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New session' })).not.toBeInTheDocument();
  });

  it('keeps search recovery separate from an empty lifecycle category', async () => {
    render(DesktopSessionList, { sessions: [], catalogComplete: true, hasAnySessions: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    await searchFor('missing');
    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
    expect(screen.queryByText('No archived sessions')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByText('No archived sessions')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows exclusions without an error banner and does not open details on hover or focus', async () => {
    vi.useFakeTimers();
    render(DesktopSessionList, { sessions, catalogComplete: true, excludedAgents: [{ id: 'old', name: 'flkr-ws' }], supportedAgentCount: 1 });
    const trigger = screen.getByRole('button', { name: '1 agent excluded from this view. Show details' });
    expect(trigger.querySelector('.lucide-info')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
    await fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    trigger.focus();
    await vi.advanceTimersByTimeAsync(1000);
    await tick();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Excluded agents' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens exclusions on click and offers All without inferring lifecycle for excluded agents', async () => {
    const { container } = render(DesktopSessionList, { sessions, catalogComplete: true, excludedAgents: [{ id: 'old', name: 'flkr-ws' }], supportedAgentCount: 1 });
    await fireEvent.click(screen.getByRole('button', { name: '1 agent excluded from this view. Show details' }));
    const explanation = screen.getByRole('dialog', { name: 'Excluded agents' });
    expect(explanation).toHaveTextContent('flkr-ws does not support lifecycle filters. Its sessions are available in All.');
    expect(within(explanation).getByRole('link', { name: 'flkr-ws' })).toHaveAttribute('href', '/agents');
    expect(within(explanation).queryByRole('button', { name: 'View all sessions' })).not.toBeInTheDocument();
    expect(within(explanation).getAllByRole('button')).toHaveLength(1);
    expect(container.querySelector('.state-inline-error')).toBeNull();
    await fireEvent.click(within(explanation).getByRole('button', { name: 'available in All' }));
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('1 agent excluded')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Excluded agents' })).not.toBeInTheDocument();
  });

  it('supports keyboard activation, per-agent links, and Escape for excluded-agent details', async () => {
    render(DesktopSessionList, { sessions, excludedAgents: [{ id: 'one', name: 'Old one' }, { id: 'two', name: 'Old two' }], supportedAgentCount: 1 });
    const trigger = screen.getByRole('button', { name: '2 agents excluded from this view. Show details' });
    trigger.focus();
    expect(screen.queryByRole('dialog', { name: 'Excluded agents' })).not.toBeInTheDocument();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const explanation = screen.getByRole('dialog', { name: 'Excluded agents' });
    expect(explanation).toHaveTextContent('Old one, Old two do not support lifecycle filters. Their sessions are available in All.');
    expect(within(explanation).getByRole('link', { name: 'Old one' })).toHaveAttribute('href', '/agents');
    expect(within(explanation).getByRole('link', { name: 'Old two' })).toHaveAttribute('href', '/agents');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Excluded agents' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it.each(['Open', 'Resolved', 'Archived'])('uses a neutral unavailable state when no agent supports the %s view', async (view) => {
    const onRefresh = vi.fn();
    render(DesktopSessionList, { sessions: [], catalogComplete: true, hasAnySessions: null, excludedAgents: [{ id: 'old', name: 'Older agent' }], supportedAgentCount: 0, onRefresh });
    await fireEvent.click(screen.getByRole('button', { name: view }));
    expect(screen.getByText(`${view} view unavailable for connected agents`)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'View all sessions' }));
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('qualifies empty supported results without claiming excluded agents have no sessions', async () => {
    render(DesktopSessionList, { sessions: [], catalogComplete: true, hasAnySessions: false, excludedAgents: [{ id: 'old', name: 'Older agent' }], supportedAgentCount: 1 });
    await fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByText('No resolved sessions from supported agents')).toBeInTheDocument();
    expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps actual request failures visible alongside compatibility information', () => {
    render(DesktopSessionList, { sessions, catalogComplete: true, error: 'New agent: request timed out', excludedAgents: [{ id: 'old', name: 'Older agent' }], supportedAgentCount: 1, onRefresh: vi.fn() });
    expect(screen.getByRole('alert')).toHaveTextContent('New agent: request timed out');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('1 agent excluded')).toBeInTheDocument();
  });

  it('clears a search that has no matching sessions', async () => {
    render(DesktopSessionList, { sessions });
    const search = screen.getByPlaceholderText('Search sessions, workspaces, agents…');
    await searchFor('missing session');

    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(search).toHaveValue('');
    expect(await screen.findByText('Inspect workspace')).toBeInTheDocument();
  });

  it('finds a session by its full session id without matching siblings', async () => {
    render(DesktopSessionList, { sessions });
    await searchFor('8f2a91bc-1234-5678-9012-abcdefabcdef');

    expect(await screen.findByText('Inspect workspace')).toBeInTheDocument();
    expect(screen.queryByText('Fix tests')).not.toBeInTheDocument();
  });

  it('finds a session by the displayed 13-character session id prefix', async () => {
    render(DesktopSessionList, { sessions });
    await searchFor('8f2a91bc-1234');

    expect(await screen.findByText('Inspect workspace')).toBeInTheDocument();
    expect(screen.queryByText('Fix tests')).not.toBeInTheDocument();
  });

  it('shows the empty state when no session id matches the query', async () => {
    render(DesktopSessionList, { sessions });
    await searchFor('ffffffff-ffff-ffff-ffff-ffffffffffff');

    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
  });

  it('keeps loaded sessions visible during refresh errors', async () => {
    const onRefresh = vi.fn();
    render(DesktopSessionList, { sessions, loading: true, error: 'Connection timed out.', onRefresh });

    expect(await screen.findByText('Inspect workspace')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sessions could not be refreshed.');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('renders loaded rows while showing that remaining history is still loading', async () => {
    render(DesktopSessionList, { sessions, loading: true, catalogComplete: true });
    expect(await screen.findByText('Inspect workspace')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Loading remaining sessions');
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(screen.queryByLabelText('Loading sessions')).not.toBeInTheDocument();
  });

  it('does not report a complete no-match result while remaining history is loading', async () => {
    const { rerender } = render(DesktopSessionList, { sessions, loading: true, catalogComplete: true });
    await searchFor('not loaded yet');
    expect(await screen.findByRole('status')).toHaveTextContent('Searching remaining history');
    expect(screen.queryByText('No matching sessions')).not.toBeInTheDocument();
    expect(screen.getByText('No matches in loaded sessions')).toBeInTheDocument();
    await rerender({ sessions, loading: false, catalogComplete: true });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
  });

  it('keeps partial-load errors visible even when none of the loaded rows match', async () => {
    const onRefresh = vi.fn();
    render(DesktopSessionList, { sessions, catalogComplete: true, error: 'Later page timed out.', onRefresh });
    await searchFor('not loaded yet');
    expect(screen.getByRole('alert')).toHaveTextContent('Session results may be incomplete.');
    expect(screen.getByRole('alert')).toHaveTextContent('Later page timed out.');
    expect(screen.queryByText('No matching sessions')).not.toBeInTheDocument();
    expect(screen.getByText('No matches in loaded sessions')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows agent names on sessions without workspace-level agent pills', async () => {
    const { container } = render(DesktopSessionList, { sessions, onOpenSession: vi.fn() });

    await waitFor(() => {
      expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
    });

    expect(container.querySelector('.session-workspace-agents')).toBeNull();
    expect(container.querySelector('.session-agent-chip')).toBeNull();
    const identicon = container.querySelector('.hex-identicon');
    expect(identicon).not.toBeNull();
    expect(identicon?.querySelector('svg')).toHaveAttribute('viewBox', '0 0 32 32');
    expect(identicon?.querySelector('polygon')).toHaveAttribute('fill', expect.stringMatching(/^#[0-9a-f]{6}$/i));
    expect(identicon?.querySelector('circle')).toBeNull();
    expect(screen.getAllByText('WS-QMT')).toHaveLength(1);
    expect(screen.getAllByText('QMTCODE')).toHaveLength(1);
  });

  it('uses sync folders only for collapsed remote and mixed groups and keeps location beside the path', async () => {
    const remote = { ...sessions[0], sessionId: 'remote', location: 'remote' as const };
    const local = { ...sessions[1], sessionId: 'local', location: 'local' as const };
    const { container } = render(DesktopSessionList, {
      sessions: [
        { ...remote, cwd: '/projects/remote' },
        { ...local, cwd: '/projects/local' },
        { ...remote, sessionId: 'mixed-remote', cwd: '/projects/mixed' },
        { ...local, sessionId: 'mixed-local', cwd: '/projects/mixed' }
      ]
    });

    expect(container.querySelectorAll('.session-workspace-icon')).toHaveLength(3);
    expect(container.querySelector('.lucide-folder-kanban')).toBeNull();
    for (const trigger of container.querySelectorAll<HTMLElement>('.session-workspace-trigger')) {
      if (trigger.getAttribute('aria-expanded') === 'true') await fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      if (trigger.querySelector('.session-workspace-machine')) {
        expect(trigger.querySelector('.lucide-folder-sync')).not.toBeNull();
        await fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(trigger.querySelector('.lucide-folder-open')).not.toBeNull();
        expect(trigger.querySelector('.lucide-folder-sync')).toBeNull();
        await fireEvent.click(trigger);
        expect(trigger.querySelector('.lucide-folder-sync')).not.toBeNull();
      } else {
        expect(trigger.querySelector('.lucide-folder')).not.toBeNull();
        expect(trigger.querySelector('.lucide-folder-sync')).toBeNull();
      }
    }
    expect(container.querySelectorAll('.lucide-folder-sync')).toHaveLength(2);
    for (const icon of container.querySelectorAll('.session-workspace-icon')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon.querySelector('svg')).toHaveAttribute('width', '22');
      expect(icon.querySelector('svg')).toHaveAttribute('stroke-width', '1.5');
    }
    expect(screen.getByText('Remote', { selector: '.session-workspace-machine' })).toHaveAttribute('title', 'Remote workspace');
    expect(screen.getByText('local + remote')).toHaveAttribute('title', 'Local and remote workspace');
    expect(screen.getByText('Remote', { selector: '.session-workspace-machine' }).closest('.session-workspace-path')).not.toBeNull();
  });

  it('shows open and closed folder glyphs as each workspace is expanded or collapsed', async () => {
    const { container } = render(DesktopSessionList, { sessions: [sessions[0], { ...sessions[1], cwd: '/projects/other' }] });
    const triggers = [...container.querySelectorAll<HTMLElement>('.session-workspace-trigger')];
    await waitFor(() => expect(triggers[0]).toHaveAttribute('aria-expanded', 'true'));
    expect(triggers[0].querySelector('.lucide-folder-open')).not.toBeNull();
    expect(triggers[1]).toHaveAttribute('aria-expanded', 'false');
    expect(triggers[1].querySelector('.lucide-folder')).not.toBeNull();
    await fireEvent.click(triggers[0]);
    expect(triggers[0]).toHaveAttribute('aria-expanded', 'false');
    expect(triggers[0].querySelector('.lucide-folder-open')).toBeNull();
    expect(triggers[0].querySelector('.lucide-folder')).not.toBeNull();
    await fireEvent.click(triggers[1]);
    expect(triggers[1]).toHaveAttribute('aria-expanded', 'true');
    expect(triggers[1].querySelector('.lucide-folder-open')).not.toBeNull();
  });

  it('shows the owning machine on remote and mixed workspace path lines', () => {
    const longNodeId = '12D3KooWPtRjf6xSzZKwyRWP2kBA1kZhqYjr4XxEmtHfunWZUT62';
    render(DesktopSessionList, {
      sessions: [
        { ...sessions[0], sessionId: 'remote', cwd: '/srv/app', location: 'remote', remoteNodeId: 'node-sapr', remoteNodeLabel: 'sapr' },
        { ...sessions[0], sessionId: 'mixed-remote', cwd: '/srv/mixed', location: 'remote', remoteNodeId: longNodeId },
        { ...sessions[1], sessionId: 'mixed-local', cwd: '/srv/mixed', location: 'local' },
        { ...sessions[0], sessionId: 'machine-a', cwd: '/srv/shared', location: 'remote', remoteNodeId: 'node-a', remoteNodeLabel: 'alpha' },
        { ...sessions[1], sessionId: 'machine-b', cwd: '/srv/shared', location: 'remote', remoteNodeId: 'node-b', remoteNodeLabel: 'beta' }
      ]
    });

    expect(screen.getByText('sapr')).toHaveAttribute('title', 'Remote workspace on sapr');
    expect(screen.getByText('sapr').querySelector('.lucide-network')).not.toBeNull();
    expect(screen.getByText('local + 12D3KooWPtRj...unWZUT62')).toHaveAttribute(
      'title',
      'Local workspace and remote workspace on 12D3KooWPtRj...unWZUT62'
    );
    expect(screen.getByText('2 machines')).toHaveAttribute('title', 'Remote workspace on alpha, beta');
    expect(screen.getAllByText(/^(sapr|local \+ 12D3KooWPtRj\.\.\.unWZUT62|2 machines)$/).every((item) => item.querySelector('.lucide-network'))).toBe(true);
  });

  it('shows a copyable session id chip after the row status dot', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });
    render(DesktopSessionList, { sessions, onOpenSession: vi.fn() });

    const chips = await screen.findAllByRole('button', { name: 'Copy session ID' });
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('8f2a91bc-1234');
    expect(chips[1]).toHaveTextContent('session-2');
    expect(chips[0].closest('.session-row-status-line')).not.toBeNull();

    await fireEvent.click(chips[0]);
    expect(writeText).toHaveBeenCalledWith('8f2a91bc-1234-5678-9012-abcdefabcdef');
    expect(screen.getByRole('status')).toHaveTextContent('copied');
    // The id stays underneath the overlay, so the chip keeps its width.
    expect(screen.getByText('8f2a91bc-1234')).toBeInTheDocument();
  });

  it('labels only remote sessions inside mixed workspaces', async () => {
    const { container } = render(DesktopSessionList, {
      sessions: [
        { ...sessions[0], sessionId: 'remote-only', title: 'Remote only', cwd: '/remote', location: 'remote' },
        { ...sessions[0], sessionId: 'mixed-remote', title: 'Mixed remote', cwd: '/mixed', location: 'remote' },
        { ...sessions[1], sessionId: 'mixed-local', title: 'Mixed local', cwd: '/mixed', location: 'local' },
        { ...sessions[1], sessionId: 'local-only', title: 'Local only', cwd: '/local', location: 'local' }
      ]
    });

    for (const trigger of container.querySelectorAll<HTMLElement>('.session-workspace-trigger')) {
      if (trigger.getAttribute('aria-expanded') !== 'true') await fireEvent.click(trigger);
    }
    const remotePills = container.querySelectorAll('.session-relationship-badge-remote');
    expect(remotePills).toHaveLength(1);
    expect(remotePills[0]).toHaveTextContent('Remote');
    expect(screen.getByText('Mixed remote').closest('.session-row-title-line')?.querySelector('.session-relationship-badge-remote')).not.toBeNull();
    expect(screen.getByText('Remote only').closest('.session-row-title-line')?.querySelector('.session-relationship-badge-remote')).toBeNull();
    expect(screen.getByText('Mixed local').closest('.session-row-title-line')?.querySelector('.session-relationship-badge-remote')).toBeNull();
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

    expect(screen.queryByText('8f2a91bc')).not.toBeInTheDocument();
    expect(screen.queryByText('8f2a91bc-1234-5678-9012-abcdefabcdef')).not.toBeInTheDocument();

    await fireEvent.click(await screen.findByLabelText('Session actions for Inspect workspace'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy session ID for Inspect workspace' }));

    expect(writeText).toHaveBeenCalledWith('8f2a91bc-1234-5678-9012-abcdefabcdef');
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('opens sessions from the row navigation control', async () => {
    const onOpenSession = vi.fn();
    render(DesktopSessionList, { sessions, onOpenSession });

    await fireEvent.click(await screen.findByRole('button', { name: 'Open session Inspect workspace' }));

    expect(onOpenSession).toHaveBeenCalledWith(sessions[0]);
  });

  it('defaults to Open without confusing an idle completed turn with resolution', async () => {
    const resolved = { ...sessions[0], sessionId: 'resolved', title: 'Resolved task', lifecycle: { ...sessions[0].lifecycle!, session_id: 'resolved', resolved: true } };
    render(DesktopSessionList, { sessions: [...sessions, resolved], catalogComplete: true });
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
    expect(screen.queryByText('Resolved task')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completed' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByText('Resolved task')).toBeInTheDocument();
    expect(screen.queryByText('Inspect workspace')).not.toBeInTheDocument();
  });

  it('combines lifecycle, runtime and location instead of making them exclusive', async () => {
    const mixedSessions: DesktopSessionSummary[] = [
      { ...sessions[0], sessionId: 'local-active', title: 'Local active', status: 'thinking', location: 'local' },
      { ...sessions[0], sessionId: 'remote-active', title: 'Remote active', status: 'thinking', location: 'remote' },
      { ...sessions[0], sessionId: 'remote-waiting', title: 'Remote waiting', status: 'waiting', location: 'remote' }
    ];
    render(DesktopSessionList, { sessions: mixedSessions, showRemoteSessions: true, catalogComplete: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Runtime' })).getByRole('radio', { name: 'Running' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Location' })).getByRole('radio', { name: 'Remote' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.getByText('Remote active')).toBeInTheDocument();
    expect(screen.queryByText('Local active')).not.toBeInTheDocument();
    expect(screen.queryByText('Remote waiting')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears search and secondary filters without losing the lifecycle view', async () => {
    render(DesktopSessionList, { sessions, showRemoteSessions: true, catalogComplete: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Location' })).getByRole('radio', { name: 'Remote' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    await searchFor('missing');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('Search sessions, workspaces, agents…')).toHaveValue('');
    await waitFor(() => expect(screen.getByText('Inspect workspace')).toBeInTheDocument());
  });

  it('hides the location refinement when remote browsing is disabled', async () => {
    const { rerender } = render(DesktopSessionList, { sessions, showRemoteSessions: true, catalogComplete: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Location' })).getByRole('radio', { name: 'Remote' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
    await rerender({ sessions, showRemoteSessions: false, catalogComplete: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByRole('radiogroup', { name: 'Location' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
  });

  it('supports archived + open without coupling archive and resolution', async () => {
    const archived = { ...sessions[0], title: 'Archived open task', lifecycle: { ...sessions[0].lifecycle!, archived: true } };
    render(DesktopSessionList, { sessions: [archived], catalogComplete: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(screen.getByText('Archived open task')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Resolution' })).getByRole('radio', { name: 'Open' }));
    expect(within(screen.getByRole('radiogroup', { name: 'Archived' })).getByRole('radio', { name: 'Only' })).toHaveAttribute('aria-checked', 'true');
    await fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.getByText('Archived open task')).toBeInTheDocument();
  });

  it('keeps refinements in a popover with no disclosure row or default filter count', async () => {
    render(DesktopSessionList, { sessions, catalogComplete: true });
    expect(screen.queryByText('Refine filters')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Session filters' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.input(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'Inspect' } });
    expect(screen.getByRole('button', { name: 'Filters' })).not.toHaveTextContent(/[0-9]/);
    await fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByRole('button', { name: 'Filters' })).not.toHaveTextContent(/[0-9]/);
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Session filters' })).toBeInTheDocument();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(3);
  });

  it('shows a compact applied-filter summary and clears refinements without clearing search or the view', async () => {
    const resolved = { ...sessions[0], lifecycle: { ...sessions[0].lifecycle!, resolved: true }, status: 'thinking' as const, location: 'remote' as const };
    render(DesktopSessionList, { sessions: [resolved], showRemoteSessions: true, catalogComplete: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'Inspect' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Runtime' })).getByRole('radio', { name: 'Running' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Location' })).getByRole('radio', { name: 'Remote' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toHaveTextContent('2');
    expect(screen.getByText('Running · Remote')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear additional filters' }));
    expect(screen.getByRole('textbox', { name: 'Search sessions' })).toHaveValue('Inspect');
    expect(screen.getByRole('button', { name: 'Resolved' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Running · Remote')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('supports radio arrow keys and restores trigger focus when dismissed with Escape', async () => {
    render(DesktopSessionList, { sessions, catalogComplete: true });
    const trigger = screen.getByRole('button', { name: 'Filters' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const runtime = screen.getByRole('radiogroup', { name: 'Runtime' });
    const any = within(runtime).getByRole('radio', { name: 'Any' });
    any.focus();
    await fireEvent.keyDown(any, { key: 'ArrowRight' });
    expect(within(runtime).getByRole('radio', { name: 'Running' })).toHaveAttribute('aria-checked', 'true');
    expect(within(runtime).getByRole('radio', { name: 'Running' })).toHaveFocus();
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Session filters' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('searches beyond the initial workspace display limit and honors restored navigation state', async () => {
    const catalog = Array.from({ length: 25 }, (_, index) => ({ ...sessions[0], sessionId: `task-${index}`, title: `Task ${index}`, updatedAt: `2026-07-${String(25 - index).padStart(2, '0')}T01:00:00Z` }));
    const first = render(DesktopSessionList, { sessions: catalog, catalogComplete: true });
    expect(screen.queryByText('Task 24')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Load 10 more' }));
    await searchFor('Task 24');
    expect(screen.getByText('Task 24')).toBeInTheDocument();
    first.unmount();
    const browserState = { ...createSessionBrowserState(), query: 'Task 24', openGroups: ['/projects/querymt'], groupsInitialized: true, visibleLimits: { '/projects/querymt': 20 } };
    render(DesktopSessionList, { sessions: catalog, catalogComplete: true, browserState });
    expect(screen.getByPlaceholderText('Search sessions, workspaces, agents…')).toHaveValue('Task 24');
    await waitFor(() => expect(screen.getByText('Task 24')).toBeInTheDocument());
  });

  it('temporarily expands matching workspaces and restores their saved expansion after search', async () => {
    const other = { ...sessions[1], cwd: '/projects/other', title: 'Matching session in closed workspace' };
    const { container } = render(DesktopSessionList, { sessions: [sessions[0], other], catalogComplete: true });
    const triggers = () => [...container.querySelectorAll<HTMLElement>('.session-workspace-trigger')];
    await waitFor(() => expect(triggers().map((trigger) => trigger.getAttribute('aria-expanded'))).toEqual(['true', 'false']));
    const search = screen.getByPlaceholderText('Search sessions, workspaces, agents…');
    await fireEvent.input(search, { target: { value: 'Matching session in closed workspace' } });
    await waitFor(() => expect(triggers()).toHaveLength(1));
    expect(triggers()[0]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(other.title)).toBeVisible();
    await fireEvent.click(triggers()[0]);
    expect(triggers()[0]).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.input(search, { target: { value: 'Inspect workspace' } });
    await waitFor(() => expect(triggers()[0]).toHaveAttribute('aria-expanded', 'true'));
    await fireEvent.input(search, { target: { value: '' } });
    await waitFor(() => expect(triggers().map((trigger) => trigger.getAttribute('aria-expanded'))).toEqual(['true', 'false']));
  });

  it('expands new matching workspaces as progressive pages arrive during a search', async () => {
    const other = { ...sessions[1], cwd: '/projects/other', title: 'Later matching session' };
    const browserState = { ...createSessionBrowserState(), query: 'session', openGroups: ['/projects/querymt'], groupsInitialized: true };
    const { container, rerender } = render(DesktopSessionList, { sessions: [], loading: true, catalogComplete: true, browserState });
    await rerender({ sessions: [other], loading: true, catalogComplete: true, browserState });
    const trigger = container.querySelector('.session-workspace-trigger');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText(other.title)).toBeVisible();
    expect(browserState.openGroups).toEqual(['/projects/querymt']);
  });

  it('hides agent names for a single-agent session list while preserving agent search', async () => {
    render(DesktopSessionList, { sessions, showAgentNames: false });

    expect(screen.queryByText('WS-QMT')).not.toBeInTheDocument();
    expect(screen.queryByText('QMTCODE')).not.toBeInTheDocument();

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

    await fireEvent.click(await screen.findByLabelText('Session actions for Inspect workspace'));
    const deleteButton = screen.getByRole('menuitem', { name: 'Delete session Inspect workspace' });

    await fireEvent.click(deleteButton);

    const dialog = screen.getByRole('alertdialog', { name: 'Delete Inspect workspace?' });
    expect(dialog).toHaveTextContent('The session and its history will be permanently removed from WS-QMT.');
    expect(dialog).toHaveTextContent('This cannot be undone');
    expect(onDeleteSession).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    expect(onDeleteSession).toHaveBeenCalledWith(sessions[0]);
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Delete Inspect workspace?' })).not.toBeInTheDocument());
  });

  it('keeps the session when the in-app deletion dialog is cancelled', async () => {
    const onDeleteSession = vi.fn(async () => {});
    render(DesktopSessionList, {
      sessions,
      onDeleteSession,
      canDeleteSession: () => true
    });

    await fireEvent.click(await screen.findByLabelText('Session actions for Inspect workspace'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete session Inspect workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDeleteSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: 'Delete Inspect workspace?' })).not.toBeInTheDocument();
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

    await fireEvent.click(await screen.findByLabelText('Session actions for Inspect workspace'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete session Inspect workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Agent refused to delete the session.');
    expect(screen.getByRole('button', { name: /^Delete$/ })).toBeEnabled();
    expect(screen.getByRole('alertdialog', { name: 'Delete Inspect workspace?' })).toBeInTheDocument();
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
    expect(screen.getByLabelText('10 loaded sessions, total may be incomplete')).toHaveTextContent('10+');
    expect(screen.getByLabelText('10 loaded sessions')).toHaveTextContent('10');
  });

  it('shows the existing full matching count without mounting more rows or searching again', async () => {
    const search = vi.spyOn(SessionSearchClient.prototype, 'search');
    const onLoadMoreWorkspace = vi.fn();
    const catalog = Array.from({ length: 25 }, (_, index) => ({ ...sessions[0], sessionId: `count-${index}`, title: `Count ${index}` }));
    const { container } = render(DesktopSessionList, { sessions: catalog, catalogComplete: true, onLoadMoreWorkspace });
    expect(screen.getByLabelText('25 loaded sessions')).toHaveTextContent(/^25$/);
    expect(container.querySelectorAll('.session-row')).toHaveLength(10);
    expect(search).not.toHaveBeenCalled();
    expect(onLoadMoreWorkspace).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Load 10 more' }));
    expect(screen.getByLabelText('25 loaded sessions')).toHaveTextContent(/^25$/);
    expect(container.querySelectorAll('.session-row')).toHaveLength(20);
    expect(search).not.toHaveBeenCalled();
    expect(onLoadMoreWorkspace).not.toHaveBeenCalled();
    await searchFor('Count 1');
    expect(screen.getByLabelText('11 loaded sessions')).toHaveTextContent(/^11$/);
    expect(container.querySelectorAll('.session-row')).toHaveLength(10);
  });

  it('counts all eligible sessions before limiting the workspace preview', () => {
    const catalog = Array.from({ length: 25 }, (_, index) => ({ ...sessions[0], sessionId: `eligible-${index}`,
      lifecycle: { ...sessions[0].lifecycle!, resolved: index >= 17 } }));
    const { container } = render(DesktopSessionList, { sessions: catalog, catalogComplete: true });
    expect(screen.getByLabelText('17 loaded sessions')).toHaveTextContent(/^17$/);
    expect(container.querySelectorAll('.session-row')).toHaveLength(10);
  });

  it('marks full-catalog counts as lower bounds while loading or after a partial-load failure', async () => {
    const catalog = Array.from({ length: 25 }, (_, index) => ({ ...sessions[0], sessionId: `loading-${index}` }));
    const { rerender, container } = render(DesktopSessionList, { sessions: catalog, catalogComplete: true, loading: true });
    expect(screen.getByLabelText('25 loaded sessions, total may be incomplete')).toHaveTextContent(/^25\+$/);
    await rerender({ sessions: catalog, catalogComplete: true, loading: false, error: 'Later page failed' });
    expect(screen.getByLabelText('25 loaded sessions, total may be incomplete')).toHaveTextContent(/^25\+$/);
    await rerender({ sessions: catalog, catalogComplete: true, loading: false, error: null });
    expect(screen.getByLabelText('25 loaded sessions')).toHaveTextContent(/^25$/);
    expect(container.querySelectorAll('.session-row')).toHaveLength(10);
  });

  it('shows full recent and pinned counts even when only ten rows are displayed', () => {
    const catalog = Array.from({ length: 25 }, (_, index) => ({ ...sessions[0], sessionId: `special-${index}`,
      pin: { session_id: `special-${index}`, pinned: index < 12, pinned_at: index < 12 ? '2026-10-21T10:00:00Z' : null } }));
    const { container } = render(DesktopSessionList, { sessions: catalog, pinnedSessions: catalog.slice(0, 12),
      recentSessionKeys: catalog.map(getSessionKey), catalogComplete: true });
    const groups = container.querySelectorAll('.session-workspace-item');
    expect(within(groups[0] as HTMLElement).getByLabelText('12 loaded sessions')).toHaveTextContent(/^12$/);
    expect(groups[0].querySelectorAll('.session-row')).toHaveLength(10);
    expect(within(groups[1] as HTMLElement).getByLabelText('13 loaded sessions')).toHaveTextContent(/^13$/);
    expect(groups[1].querySelectorAll('.session-row')).toHaveLength(10);
  });

  it('opens only the latest workspace by default and creates a session in its context', async () => {
    const onOpenWorkspace = vi.fn(async () => {});
    const onCreateWorkspaceSession = vi.fn(async () => {});
    render(DesktopSessionList, {
      workspaceGroups: [
        createWorkspaceGroup({ key: '/recent', cwd: '/recent', name: 'recent', latestActivity: '2026-07-19T01:00:00Z' }),
        createWorkspaceGroup({ key: '/older', cwd: '/older', name: 'older', latestActivity: '2026-07-18T01:00:00Z' })
      ],
      onOpenWorkspace,
      onCreateWorkspaceSession
    });

    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledTimes(1));
    expect(onOpenWorkspace).toHaveBeenCalledWith('/recent');
    await fireEvent.click(screen.getByRole('button', { name: 'New session in recent' }));
    expect(onCreateWorkspaceSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/recent' }));
  });

  it('passes the workspace host along when creating a remote session', async () => {
    const onCreateWorkspaceSession = vi.fn();
    const remoteGroup = createWorkspaceGroup({
      key: '/remote', cwd: '/remote', name: 'remote',
      sessions: [{ ...sessions[0], cwd: '/remote', location: 'remote', remoteNodeId: 'peer-1', remoteNodeLabel: 'Laptop' }]
    });
    render(DesktopSessionList, {
      workspaceGroups: [{ ...remoteGroup, location: 'remote', remoteMachines: [{ id: 'peer-1', label: 'Laptop' }] }],
      onCreateWorkspaceSession
    });

    await fireEvent.click(screen.getByRole('button', { name: 'New session in remote' }));
    expect(onCreateWorkspaceSession).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/remote', location: 'remote', remoteMachines: [{ id: 'peer-1', label: 'Laptop' }]
    }));
  });

  it('retries an uninitialized workspace after the catalog generation changes', async () => {
    const onOpenWorkspace = vi.fn(async () => {});
    const { rerender } = render(DesktopSessionList, {
      workspaceGroups: [createWorkspaceGroup({ initialized: false, catalogGeneration: 1 })],
      onOpenWorkspace
    });

    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledTimes(1));
    await rerender({
      workspaceGroups: [createWorkspaceGroup({ initialized: false, catalogGeneration: 2 })],
      onOpenWorkspace
    });
    await waitFor(() => expect(onOpenWorkspace).toHaveBeenCalledTimes(2));
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

describe('DesktopSessionList asynchronous search', () => {
  it('updates input immediately, coalesces keystrokes, and ignores obsolete or cleared results', async () => {
    vi.useFakeTimers();
    const responses: Array<(matches: SessionSearchMatch[]) => void> = [];
    const search = vi.spyOn(SessionSearchClient.prototype, 'search').mockImplementation(() => new Promise((resolve) => responses.push(resolve)));
    const { container } = render(DesktopSessionList, { sessions, catalogComplete: true });
    const input = screen.getByRole('textbox', { name: 'Search sessions' });
    input.focus();
    for (const value of ['F', 'Fi', 'Fix']) await fireEvent.input(input, { target: { value } });
    expect(input).toHaveValue('Fix');
    expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(80);
    expect(search).toHaveBeenCalledExactlyOnceWith('fix');
    await fireEvent.input(input, { target: { value: 'Inspect' } });
    responses[0]([{ key: '/projects/querymt', sessionKeys: [getSessionKey(sessions[1])] }]);
    await tick();
    expect(input).toHaveValue('Inspect');
    expect(screen.getByText('Inspect workspace')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(80);
    expect(search).toHaveBeenCalledTimes(2);
    responses[1]([{ key: '/projects/querymt', sessionKeys: [getSessionKey(sessions[0])] }]);
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(screen.queryByText('Fix tests')).not.toBeInTheDocument();
    expect(container.querySelector('.session-browser-body')).toHaveAttribute('aria-busy', 'false');
    expect(input).toHaveFocus();
    await fireEvent.input(input, { target: { value: 'obsolete after clear' } });
    await vi.advanceTimersByTimeAsync(80);
    await fireEvent.input(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(screen.getByText('Fix tests')).toBeInTheDocument();
    responses[2]([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('Fix tests')).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('does not search during IME composition and searches the committed value afterwards', async () => {
    vi.useFakeTimers();
    const search = vi.spyOn(SessionSearchClient.prototype, 'search').mockResolvedValue([]);
    render(DesktopSessionList, { sessions, catalogComplete: true });
    const input = screen.getByRole('textbox', { name: 'Search sessions' });
    await fireEvent.compositionStart(input);
    await fireEvent.input(input, { target: { value: 'composing' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(input).toHaveValue('composing');
    expect(search).not.toHaveBeenCalled();
    await fireEvent.compositionEnd(input, { target: { value: 'committed' } });
    await vi.advanceTimersByTimeAsync(80);
    expect(search).toHaveBeenCalledExactlyOnceWith('committed');
    expect(input).toHaveValue('committed');
  });

  it('keeps all 70 workspace headers in continuous browse and search results with 7000 roots', async () => {
    const catalog = Array.from({ length: 7000 }, (_, index) => ({ ...sessions[0], sessionId: `root-${index}`, title: `Task ${index}`, cwd: `/projects/workspace-${index % 70}` }));
    const { container } = render(DesktopSessionList, { sessions: catalog, catalogComplete: true });
    expect(container.querySelectorAll('.session-workspace-item')).toHaveLength(70);
    expect(container.querySelectorAll('.session-row')).toHaveLength(10);
    expect(screen.queryByRole('navigation', { name: 'Workspace pages' })).not.toBeInTheDocument();
    await searchFor('Task 6999');
    expect(screen.getByText('Task 6999')).toBeInTheDocument();
    expect(container.querySelectorAll('.session-row')).toHaveLength(1);
    await searchFor('Task');
    expect(container.querySelectorAll('.session-workspace-item')).toHaveLength(70);
    expect(container.querySelectorAll('.session-row')).toHaveLength(700);
    expect(screen.queryByRole('button', { name: 'Next workspaces' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search sessions' })).toHaveValue('Task');
  }, 15_000);

  it('mounts only open workspace rows and restores saved expansion after clearing a search', async () => {
    const catalog = Array.from({ length: 12 }, (_, index) => ({ ...sessions[0], sessionId: `task-${index}`, title: `Task ${index}`, cwd: `/projects/workspace-${index}` }));
    const browserState = { ...createSessionBrowserState(), groupsInitialized: true, openGroups: ['/projects/workspace-11'] };
    const { container } = render(DesktopSessionList, { sessions: catalog, catalogComplete: true, browserState });
    expect(container.querySelectorAll('.session-workspace-item')).toHaveLength(12);
    expect(container.querySelectorAll('.session-row')).toHaveLength(1);
    expect(screen.getByText('Task 11')).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Search sessions' });
    input.focus();
    await searchFor('Task 0');
    expect(screen.getByText('Task 0')).toBeInTheDocument();
    await searchFor('');
    expect(container.querySelectorAll('.session-workspace-item')).toHaveLength(12);
    expect(container.querySelectorAll('.session-row')).toHaveLength(1);
    expect(screen.getByText('Task 11')).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it('appends all rows with the existing load-more action instead of replacing 30-row pages', async () => {
    const catalog = Array.from({ length: 65 }, (_, index) => ({ ...sessions[0], sessionId: `task-${index}`, title: `Task ${index}` }));
    const { container } = render(DesktopSessionList, { sessions: catalog, catalogComplete: true });
    for (let count = 20; count <= 60; count += 10) {
      await fireEvent.click(screen.getByRole('button', { name: 'Load 10 more' }));
      expect(container.querySelectorAll('.session-row')).toHaveLength(count);
      expect(screen.getByText('Task 0')).toBeInTheDocument();
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Load 10 more' }));
    expect(container.querySelectorAll('.session-row')).toHaveLength(65);
    expect(screen.getByText('Task 64')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next 30|Previous 30|Load 10 more/ })).not.toBeInTheDocument();
    await searchFor('Task');
    expect(container.querySelectorAll('.session-row')).toHaveLength(10);
    for (let count = 20; count <= 60; count += 10) {
      await fireEvent.click(screen.getByRole('button', { name: 'Load 10 more' }));
      expect(container.querySelectorAll('.session-row')).toHaveLength(count);
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Load 10 more' }));
    expect(container.querySelectorAll('.session-row')).toHaveLength(65);
    await searchFor('');
    expect(container.querySelectorAll('.session-row')).toHaveLength(65);
  });

  it('reindexes streamed catalog updates, removals, and lifecycle eligibility while searching', async () => {
    const { rerender } = render(DesktopSessionList, { sessions, catalogComplete: true });
    await searchFor('Later');
    expect(screen.getByText('No matching sessions')).toBeInTheDocument();
    const added = { ...sessions[0], sessionId: 'later', title: 'Later result' };
    await rerender({ sessions: [...sessions, added], catalogComplete: true });
    expect(await screen.findByText('Later result')).toBeInTheDocument();
    await rerender({ sessions: [...sessions, { ...added, lifecycle: { ...added.lifecycle!, resolved: true } }], catalogComplete: true });
    await waitFor(() => expect(screen.queryByText('Later result')).not.toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(await screen.findByText('Later result')).toBeInTheDocument();
    await rerender({ sessions, catalogComplete: true });
    await waitFor(() => expect(screen.queryByText('Later result')).not.toBeInTheDocument());
  });

  it('drops pending results after unmount', async () => {
    vi.useFakeTimers();
    let respond!: (matches: SessionSearchMatch[]) => void;
    vi.spyOn(SessionSearchClient.prototype, 'search').mockImplementation(() => new Promise((resolve) => respond = resolve));
    const dispose = vi.spyOn(SessionSearchClient.prototype, 'dispose');
    const { unmount, container } = render(DesktopSessionList, { sessions });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Search sessions' }), { target: { value: 'pending' } });
    await vi.advanceTimersByTimeAsync(80);
    unmount();
    respond([{ key: '/projects/querymt', sessionKeys: [getSessionKey(sessions[0])] }]);
    await tick();
    expect(dispose).toHaveBeenCalledOnce();
    expect(container.querySelector('.session-row')).toBeNull();
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
  catalogGeneration: number;
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
    catalogGeneration: 0,
    ...overrides
  };
}
