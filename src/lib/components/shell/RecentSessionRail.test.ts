import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSessionSummary } from '$lib/domain/types';

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

const agentsStore = vi.hoisted(() => ({
  configs: [] as unknown[],
  connectedAgents: [] as unknown[],
  agentsNeedingAttention: [] as unknown[],
  meshNodeCount: 0
}));
const inboxStore = vi.hoisted(() => ({ actionableItems: [] as Array<Record<string, unknown>> }));

vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));
vi.mock('$lib/stores/inbox.svelte', () => ({ inboxStore }));

import RecentSessionRail from './RecentSessionRail.svelte';

const activeSession: DesktopSessionSummary = {
  agentId: 'agent-1',
  agentName: 'QMTCODE',
  sessionId: 'session-1',
  title: 'Waiting session',
  cwd: '/tmp/work',
  updatedAt: '2026-07-18T17:00:00Z',
  runtimeId: 'agent-1',
  runtimeName: 'QMTCODE',
  source: 'acp',
  lifecycle: { session_id: 'session-1', resolved: false, archived: false, resolved_at: null, archived_at: null },
  status: 'waiting'
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 640 });
  agentsStore.configs = [];
  agentsStore.connectedAgents = [];
  agentsStore.agentsNeedingAttention = [];
  agentsStore.meshNodeCount = 0;
  inboxStore.actionableItems = [];
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.unstubAllGlobals();
});

describe('RecentSessionRail pinned sessions', () => {
  const pinned = Array.from({ length: 7 }, (_, index) => ({ ...activeSession, sessionId: `pinned-${index}`, title: `Pinned ${index}`,
    pin: { session_id: `pinned-${index}`, pinned: true, pinned_at: '2026-10-20T10:00:00Z' }
  }));
  it.each([false, true])('defaults to no pinned section and reacts to enabling/disabling it without unpinning (compact=%s)', async (collapsed) => {
    const onVisibleSessionItemsChange = vi.fn();
    const onSetPinned = vi.fn(async () => {});
    const { container, rerender } = render(RecentSessionRail, { current: 'Sessions', sessions: [...pinned, activeSession], pinnedSessions: pinned,
      pinLoadError: 'Pins unavailable', collapsed, onVisibleSessionItemsChange, onSetPinned });
    const selector = collapsed ? '.session-icon-link' : '.app-sidebar-session';
    expect(container.querySelectorAll(selector)).toHaveLength(8);
    expect(screen.queryByText('Pinned', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Pins unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more pinned' })).not.toBeInTheDocument();
    expect(container.querySelector('.session-icon-rail-list [role="separator"]')).toBeNull();
    await rerender({ showPinnedSessions: true });
    await waitFor(() => expect(container.querySelectorAll(selector)).toHaveLength(collapsed ? 8 : 6));
    expect(container.querySelector(selector)).toHaveAccessibleName(/^Pinned 0,/);
    if (collapsed) expect(container.querySelector('.session-icon-rail-list [role="separator"]')).not.toBeNull();
    else expect(screen.getByText('Pinned', { exact: true })).toBeInTheDocument();
    expect(onVisibleSessionItemsChange.mock.lastCall?.[0][0].session.sessionId).toBe('pinned-0');
    await rerender({ showPinnedSessions: false });
    expect(container.querySelectorAll(selector)).toHaveLength(8);
    expect(screen.queryByText('Pinned', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Pins unavailable')).not.toBeInTheDocument();
    expect(container.querySelector('.session-icon-rail-list [role="separator"]')).toBeNull();
    expect(onVisibleSessionItemsChange.mock.lastCall?.[0]).toHaveLength(8);
    expect(onSetPinned).not.toHaveBeenCalled();
    expect(pinned.every((session) => session.pin.pinned)).toBe(true);
  });
  it('shows five pins above Open, reveals more, keeps current pins and excludes duplicates', async () => {
    const { container } = render(RecentSessionRail, { current: 'Sessions', sessions: [...pinned, activeSession], pinnedSessions: pinned, showPinnedSessions: true,
      currentAgentId: 'agent-1', currentSessionId: pinned[0].sessionId });
    const links = container.querySelectorAll('.app-sidebar-session');
    expect(links).toHaveLength(6);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links[0]).toHaveAccessibleName(/^Pinned 0/);
    expect(links[5]).toHaveAccessibleName(/^Waiting session/);
    expect(container.querySelector('.app-sidebar-section-heading')).toHaveTextContent('Pinned');
    await fireEvent.click(screen.getByRole('button', { name: 'Show more pinned' }));
    expect(container.querySelectorAll('.app-sidebar-session')).toHaveLength(8);
  });
  it.each([false, true])('reveals all 22 cached open sessions despite five pins before any server fetch (hasMore=%s)', async (hasMoreSessions) => {
    const open = Array.from({ length: 22 }, (_, index) => ({ ...activeSession, sessionId: `open-${index}`, title: `Open ${String(index).padStart(2, '0')}` }));
    const fivePins = pinned.slice(0, 5);
    const onLoadMoreSessions = vi.fn(async () => {});
    const { container } = render(RecentSessionRail, { current: 'Sessions', sessions: [...fivePins, ...open], pinnedSessions: fivePins,
      showPinnedSessions: true, hasMoreSessions, onLoadMoreSessions });
    const list = container.querySelector<HTMLElement>('.app-sidebar-session-list')!;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => container.querySelectorAll('.app-sidebar-session').length * 80 });
    expect(container.querySelectorAll('.app-sidebar-session')).toHaveLength(25);
    expect(screen.queryByText('Open 20')).not.toBeInTheDocument();
    list.scrollTop = list.scrollHeight - list.clientHeight;
    await fireEvent.scroll(list);
    expect(container.querySelectorAll('.app-sidebar-session')).toHaveLength(27);
    expect(screen.getByText('Open 20')).toBeInTheDocument();
    expect(screen.getByText('Open 21')).toBeInTheDocument();
    expect(onLoadMoreSessions).not.toHaveBeenCalled();
  });
  it.each([false, true])('keeps an older current pin inside the visible limit without reordering pins (compact=%s)', async (collapsed) => {
    const rows = Array.from({ length: 14 }, (_, index) => ({ ...pinned[0], sessionId: `old-pin-${index}`, title: `Pin ${index}`,
      pin: { session_id: `old-pin-${index}`, pinned: true, pinned_at: new Date(Date.UTC(2026, 9, 20, 10) - index * 60_000).toISOString() }
    }));
    const onVisibleSessionItemsChange = vi.fn();
    const { container } = render(RecentSessionRail, { current: 'Sessions', sessions: rows, pinnedSessions: rows, showPinnedSessions: true, collapsed,
      currentAgentId: 'agent-1', currentSessionId: rows[13].sessionId, onVisibleSessionItemsChange });
    const selector = collapsed ? '.session-icon-link' : '.app-sidebar-session';
    await waitFor(() => expect(container.querySelector(`${selector}[aria-current="page"]`)).toHaveAttribute('href', '/sessions/agent-1/old-pin-13'));
    const links = [...container.querySelectorAll(selector)];
    expect(links).toHaveLength(collapsed ? 10 : 5);
    expect(links[0]).toHaveAccessibleName(/^Pin 0,/);
    expect(links.at(-1)).toHaveAccessibleName(/^Pin 13,/);
    expect(onVisibleSessionItemsChange.mock.lastCall?.[0].at(-1).session.sessionId).toBe('old-pin-13');
  });
  it.each([false, true])('keeps resolved pins but never archived or child pins (compact=%s)', (collapsed) => {
    const resolved = { ...pinned[0], lifecycle: { ...pinned[0].lifecycle!, resolved: true } };
    const archived = { ...pinned[1], lifecycle: { ...pinned[1].lifecycle!, archived: true } };
    const child = { ...pinned[2], parentSessionId: 'root' };
    const { container } = render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], pinnedSessions: [resolved, archived, child], showPinnedSessions: true, collapsed });
    const links = container.querySelectorAll('a[href^="/sessions/agent-1/"]');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAccessibleName(/^Pinned 0/);
    expect(container.querySelector('a[href$="pinned-1"]')).toBeNull();
    expect(container.querySelector('a[href$="pinned-2"]')).toBeNull();
    if (collapsed) expect(container.querySelector('.session-icon-rail-list [role="separator"]')).not.toBeNull();
  });
});

describe('RecentSessionRail navigation', () => {
  it('defaults to a labeled sidebar with grouped navigation and readable sessions', () => {
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });

    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Manage')).toBeInTheDocument();
    expect(screen.getByText('Open sessions')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Browse sessions' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sessions' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'View all' })).not.toBeInTheDocument();
    expect(screen.getByText('Waiting session')).toBeInTheDocument();
    expect(screen.getByText('work · Waiting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('shows more than ten sessions without number badges and maps shortcuts only to the first ten', async () => {
    const sessions = Array.from({ length: 25 }, (_, index) => ({
      ...activeSession, sessionId: `session-${index + 1}`, title: `Session ${String(index + 1).padStart(2, '0')}`
    }));
    const onVisibleSessionItemsChange = vi.fn();
    const { container } = render(RecentSessionRail, { current: 'Sessions', sessions, onVisibleSessionItemsChange });
    expect(container.querySelectorAll('.app-sidebar-session')).toHaveLength(20);
    expect(container.querySelectorAll('.app-sidebar-session kbd')).toHaveLength(0);
    const links = [...container.querySelectorAll('.app-sidebar-session')];
    expect(links[0]).toHaveAttribute('aria-keyshortcuts', 'Control+1');
    expect(links[9]).toHaveAttribute('aria-keyshortcuts', 'Control+0');
    expect(links[10]).not.toHaveAttribute('aria-keyshortcuts');
    expect(links[10]).toHaveAccessibleName('Session 11, Waiting');
    await waitFor(() => expect(onVisibleSessionItemsChange).toHaveBeenCalled());
    expect(onVisibleSessionItemsChange.mock.lastCall?.[0]).toHaveLength(10);
  });

  it('reveals cached rows first and requests another page only when scrolling reaches the end', async () => {
    const sessions = Array.from({ length: 45 }, (_, index) => ({
      ...activeSession, sessionId: `session-${index + 1}`, title: `Session ${String(index + 1).padStart(2, '0')}`
    }));
    let release!: () => void;
    const onLoadMoreSessions = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { container, rerender } = render(RecentSessionRail, { current: 'Sessions', sessions, hasMoreSessions: true, onLoadMoreSessions });
    const list = container.querySelector<HTMLElement>('.app-sidebar-session-list')!;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 2000 });
    await fireEvent.scroll(list);
    expect(onLoadMoreSessions).not.toHaveBeenCalled();
    list.scrollTop = 1300;
    await fireEvent.scroll(list);
    expect(container.querySelectorAll('.app-sidebar-session')).toHaveLength(40);
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 4000 });
    expect(onLoadMoreSessions).not.toHaveBeenCalled();
    list.scrollTop = 3300;
    await fireEvent.scroll(list);
    expect(container.querySelectorAll('.app-sidebar-session')).toHaveLength(45);
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 4400 });
    list.scrollTop = 3700;
    await fireEvent.scroll(list);
    await fireEvent.scroll(list);
    expect(onLoadMoreSessions).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Loading more open sessions');
    expect(screen.getByText('Session 01')).toBeInTheDocument();
    release();
    await rerender({ current: 'Sessions', sessions: [...sessions, { ...activeSession, sessionId: 'session-46', title: 'Session 46' }], hasMoreSessions: false, onLoadMoreSessions });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('Session 46')).toBeInTheDocument();
    expect(list.scrollTop).toBe(3700);
  });

  it('fills an underfull sidebar, pauses after a failed page, and allows an explicit retry', async () => {
    const onLoadMoreSessions = vi.fn(async () => {}).mockRejectedValueOnce(new Error('Owner offline'));
    const { container } = render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], hasMoreSessions: true, onLoadMoreSessions });
    const list = container.querySelector<HTMLElement>('.app-sidebar-session-list')!;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 100 });
    await fireEvent.scroll(list);
    expect(await screen.findByText('Owner offline')).toBeInTheDocument();
    await fireEvent.scroll(list);
    expect(onLoadMoreSessions).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onLoadMoreSessions).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText('Owner offline')).not.toBeInTheDocument());
  });

  it('does not fetch pages for the compact rail or hidden mobile sidebar', async () => {
    const onLoadMoreSessions = vi.fn(async () => {});
    const { container } = render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed: true, hasMoreSessions: true, onLoadMoreSessions });
    const list = container.querySelector<HTMLElement>('.app-icon-rail-sessions')!;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 50 });
    window.dispatchEvent(new Event('resize'));
    expect(onLoadMoreSessions).not.toHaveBeenCalled();
  });

  it('includes only known open/unarchived roots without mutating attention requests', () => {
    inboxStore.actionableItems = [{ id: 'permission', agentId: 'agent-1', sessionId: 'resolved' }];
    render(RecentSessionRail, { current: 'Sessions', sessions: [
      activeSession,
      { ...activeSession, sessionId: 'resolved', title: 'Resolved work', lifecycle: { ...activeSession.lifecycle!, resolved: true } },
      { ...activeSession, sessionId: 'archived', title: 'Archived work', lifecycle: { ...activeSession.lifecycle!, archived: true } },
      { ...activeSession, sessionId: 'unknown', title: 'Unknown work', lifecycle: null }
    ] });
    expect(screen.getByText('Waiting session')).toBeInTheDocument();
    expect(screen.queryByText('Resolved work')).not.toBeInTheDocument();
    expect(screen.queryByText('Archived work')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown work')).not.toBeInTheDocument();
    expect(inboxStore.actionableItems).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Inbox, 1 action required' })).toBeInTheDocument();
  });

  it.each([false, true])('exposes the same actions with a keyboard context menu (collapsed=%s)', async (collapsed) => {
    const onSetLifecycle = vi.fn(async () => {});
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed, canManageLifecycle: () => true, onSetLifecycle });
    const link = screen.getByRole('link', { name: 'Waiting session, Waiting, Ctrl+1' });
    link.focus();
    await fireEvent.keyDown(link, { key: 'F10', shiftKey: true });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Mark resolved' }));
    expect(onSetLifecycle).toHaveBeenCalledWith(activeSession, { resolved: true });
    expect(link).toHaveAttribute('href', '/sessions/agent-1/session-1');
  });

  it('replaces the desktop rail with app-style navigation on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 760px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })));

    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed: true });

    const navigation = screen.getByRole('navigation', { name: 'App navigation' });
    expect(within(navigation).getByRole('link', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: 'App navigation and recent sessions' })).not.toBeInTheDocument();

    const moreTrigger = within(navigation).getByLabelText('More sections');
    const morePanel = moreTrigger.closest('details');
    await fireEvent.click(moreTrigger);
    expect(morePanel).toHaveAttribute('open');

    const workspacesLink = within(navigation).getByRole('link', { name: 'Workspaces' });
    expect(workspacesLink).toBeInTheDocument();
    expect(within(navigation).getByRole('link', { name: 'Settings' })).toBeInTheDocument();

    workspacesLink.addEventListener('click', (event) => event.preventDefault(), { once: true });
    await fireEvent.click(workspacesLink);
    expect(morePanel).not.toHaveAttribute('open');
  });

  it('locks the automatic compact rail without showing an unavailable expand control', () => {
    render(RecentSessionRail, {
      current: 'Sessions',
      sessions: [activeSession],
      collapsed: true,
      collapseLocked: true
    });

    expect(screen.getByRole('link', { name: 'Waiting session, Waiting, Ctrl+1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Open sessions')).not.toBeInTheDocument();
  });

  it('shows the compact brand subtitle only in the expanded sidebar', () => {
    const { rerender } = render(RecentSessionRail, { current: 'Start', sessions: [], collapsed: false });

    expect(screen.getByText('Agents command and control').closest('.app-sidebar-brand-copy')).not.toBeNull();

    rerender({ current: 'Start', sessions: [], collapsed: true });
    expect(screen.queryByText('Agents command and control')).not.toBeInTheDocument();
  });

  it.each([false, true])('uses only activity and attention circles for active sessions, without a row highlight (collapsed=%s)', (collapsed) => {
    inboxStore.actionableItems = [{ id: 'request-1', agentId: 'agent-1', sessionId: 'session-1' }];
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed });
    const link = screen.getByRole('link', { name: 'Waiting session, Waiting, action required, Ctrl+1' });
    expect(link).not.toHaveClass('app-sidebar-session-active', 'session-icon-link-active');
    expect(link.querySelector('.app-icon-activity-pill')).toBeNull();
    expect(link.querySelector(collapsed ? '.session-icon-status-active' : '.app-sidebar-session-spinner')).not.toBeNull();
    expect(link.querySelector('.sidebar-attention-dot')).not.toBeNull();
  });

  it('shows activity and the shared attention dot together for a session requiring action', () => {
    inboxStore.actionableItems = [{ id: 'request-1', agentId: 'agent-1', sessionId: 'session-1' }];

    const { container } = render(RecentSessionRail, {
      current: 'Sessions',
      sessions: [activeSession],
      collapsed: true
    });

    const sessionLink = screen.getByRole('link', {
      name: 'Waiting session, Waiting, action required, Ctrl+1'
    });
    expect(sessionLink).toBeInTheDocument();
    expect(sessionLink.querySelector('.session-icon-status-active')).not.toBeNull();
    const sessionDot = sessionLink.querySelector('.sidebar-attention-dot');
    const inboxDot = screen.getByRole('link', { name: 'Inbox, 1 action required' }).querySelector('.sidebar-attention-dot');
    expect(sessionDot).not.toBeNull();
    expect(sessionDot?.className).toBe(inboxDot?.className);
    expect(sessionDot?.parentElement).toHaveClass('session-icon-surface');
    expect(inboxDot?.parentElement).toHaveClass('app-nav-icon-surface');
    expect(container.querySelectorAll('.sidebar-attention-dot')).toHaveLength(2);
  });

  it('keeps stable nested surfaces for the session shape morph', () => {
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed: true });

    const sessionLink = screen.getByRole('link', { name: 'Waiting session, Waiting, Ctrl+1' });
    const surface = sessionLink.querySelector('.session-icon-surface');
    const avatar = surface?.querySelector('.session-icon-avatar');
    expect(sessionLink).toHaveClass('session-icon-link');
    expect(surface).not.toBeNull();
    expect(avatar).not.toBeNull();
    expect(avatar?.querySelector('.hex-identicon svg polygon')).not.toBeNull();
  });

  it('keeps only the activity spinner when no session action is required', () => {
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed: true });

    const sessionLink = screen.getByRole('link', { name: 'Waiting session, Waiting, Ctrl+1' });
    expect(sessionLink.querySelector('.session-icon-status-active')).not.toBeNull();
    expect(sessionLink.querySelector('.sidebar-attention-dot')).toBeNull();
  });

  it('accounts for top and bottom glow clearance when limiting session icons', () => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 88 });
    const sessions = Array.from({ length: 3 }, (_, index) => ({
      ...activeSession,
      sessionId: `session-${index + 1}`,
      title: `Session ${index + 1}`
    }));

    render(RecentSessionRail, { current: 'Sessions', sessions, collapsed: true });

    expect(screen.getAllByRole('link', { name: /Session \d, Waiting/ })).toHaveLength(1);
  });

  it.each([false, true])('never promotes active or attention-requesting children into Open sessions (collapsed=%s)', async (collapsed) => {
    const children: DesktopSessionSummary[] = [
      { ...activeSession, sessionId: 'child-active', title: 'Active child', status: 'thinking', parentSessionId: 'root' },
      { ...activeSession, sessionId: 'child-waiting', title: 'Waiting child', status: 'waiting', forkOrigin: 'delegation' },
      { ...activeSession, sessionId: 'child-attention', title: 'Attention child', status: 'completed', parentSessionId: 'root' },
      { ...activeSession, sessionId: 'fork', title: 'User fork', forkOrigin: 'user' },
      { ...activeSession, sessionId: 'unlisted-child', title: 'Reviewed child', relationshipKnown: false }
    ];
    inboxStore.actionableItems = [{ id: 'child-permission', agentId: 'agent-1', sessionId: 'child-waiting' }];
    const onVisibleSessionItemsChange = vi.fn();
    const root = { ...activeSession, title: 'Task: real root work', sessionKind: 'recurring' };
    const { container } = render(RecentSessionRail, {
      current: 'Sessions', sessions: [...children, root], collapsed,
      attentionSessionKeys: ['agent-1:child-attention'], onVisibleSessionItemsChange
    });

    expect(container.querySelectorAll('a[href^="/sessions/agent-1/"]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Task: real root work, Waiting, Ctrl+1' })).toBeInTheDocument();
    await waitFor(() => expect(onVisibleSessionItemsChange).toHaveBeenCalled());
    expect(onVisibleSessionItemsChange.mock.lastCall?.[0].map((item: { session: DesktopSessionSummary }) => item.session.sessionId)).toEqual(['session-1']);
    expect(inboxStore.actionableItems).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Inbox, 1 action required' })).toBeInTheDocument();
  });

  it('lists only root sessions and hides delegate session summaries', () => {
    const delegateSession: DesktopSessionSummary = {
      ...activeSession,
      sessionId: 'session-task',
      title: 'Task: explore repo',
      parentSessionId: 'session-1'
    };

    render(RecentSessionRail, {
      current: 'Sessions',
      sessions: [delegateSession, activeSession]
    });

    expect(screen.getByRole('link', { name: 'Waiting session, Waiting, Ctrl+1' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Task: explore repo/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Task: explore repo')).not.toBeInTheDocument();
  });
});

describe('RecentSessionRail agents count', () => {
  const twoAgentConfigs = [{ id: 'agent-1' }, { id: 'agent-2' }];
  const statusDescriptionId = 'app-sidebar-agents-status-description';

  function getStatusDescription(): HTMLElement {
    const description = document.getElementById(statusDescriptionId);
    expect(description).not.toBeNull();
    expect(description).toHaveClass('sr-only');
    return description as HTMLElement;
  }

  async function openTooltipViaHover(trigger: HTMLElement): Promise<HTMLElement> {
    await fireEvent.pointerEnter(trigger);
    await waitFor(() => {
      expect(document.querySelector('.app-icon-tooltip')).not.toBeNull();
    });
    return document.querySelector('.app-icon-tooltip') as HTMLElement;
  }

  it('gives the expanded agents link a concise accessible name and a persistent status description', async () => {
    agentsStore.configs = twoAgentConfigs;
    agentsStore.connectedAgents = [{ id: 'agent-1' }];

    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });

    const agentsLink = screen.getByRole('link', { name: 'Agents' });
    expect(agentsLink.getAttribute('aria-describedby')).toBe(statusDescriptionId);
    expect(document.querySelectorAll(`[id="${statusDescriptionId}"]`)).toHaveLength(1);
    expect(getStatusDescription()).toHaveTextContent('1 agent active, 2 agents available');

    expect(agentsLink.querySelector('.app-icon-agent-count')).toBeNull();
    const count = agentsLink.querySelector('.app-sidebar-agents-count');
    expect(count).toHaveTextContent('1 / 2');
    expect(count).toHaveClass('app-sidebar-agents-count-active');
    expect(count?.querySelector('.app-sidebar-agents-count-n')).toHaveTextContent('1');
    expect(count).toHaveAttribute('aria-hidden', 'true');

    const tooltip = await openTooltipViaHover(agentsLink);
    expect(tooltip).toHaveTextContent('1 agent active, 2 agents available');
    expect(agentsLink.getAttribute('aria-describedby')).toBe(statusDescriptionId);

    agentsLink.focus();
    await waitFor(() => {
      expect(document.querySelector('.app-icon-tooltip')).not.toBeNull();
    });
    expect(agentsLink.getAttribute('aria-describedby')).toBe(statusDescriptionId);
  });

  it('keeps attention semantics in the accessible name while the description carries only the count status', async () => {
    agentsStore.configs = twoAgentConfigs;
    agentsStore.connectedAgents = [{ id: 'agent-1' }];
    agentsStore.agentsNeedingAttention = [{ id: 'agent-2' }];

    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });

    const agentsLink = screen.getByRole('link', { name: 'Agents, 1 need attention' });
    expect(agentsLink.getAttribute('aria-describedby')).toBe(statusDescriptionId);
    expect(getStatusDescription().textContent).toBe('1 agent active, 2 agents available');

    const tooltip = await openTooltipViaHover(agentsLink);
    expect(tooltip).toHaveTextContent('1 agent active, 2 agents available');
    expect(tooltip.textContent).not.toContain('need attention');
  });

  it('keeps the collapsed pill limited to the active count with attention intact and a distinct tooltip', async () => {
    agentsStore.configs = twoAgentConfigs;
    agentsStore.connectedAgents = [{ id: 'agent-1' }];
    agentsStore.agentsNeedingAttention = [{ id: 'agent-2' }];

    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed: true });

    const agentsLink = screen.getByRole('link', { name: 'Agents, 1 need attention' });
    const pill = agentsLink.querySelector('.app-icon-agent-count');
    expect(pill).toHaveTextContent('1');
    expect(pill?.textContent).not.toContain('/');
    expect(agentsLink.querySelector('.app-sidebar-agents-count')).toBeNull();
    expect(agentsLink.querySelector('.sidebar-attention-dot')).not.toBeNull();
    expect(agentsLink.getAttribute('aria-describedby')).toBe(statusDescriptionId);
    expect(getStatusDescription().textContent).toBe('1 agent active, 2 agents available');

    const tooltip = await openTooltipViaHover(agentsLink);
    expect(tooltip).toHaveTextContent('Agents, 1 agent active, 2 agents available');
  });

  it('shows the expanded zero-active ratio without green styling and a matching status description', async () => {
    agentsStore.configs = twoAgentConfigs;

    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });

    const agentsLink = screen.getByRole('link', { name: 'Agents' });
    const count = agentsLink.querySelector('.app-sidebar-agents-count');
    expect(count).toHaveTextContent('0 / 2');
    expect(count).not.toHaveClass('app-sidebar-agents-count-active');
    expect(agentsLink.querySelector('.app-icon-agent-count')).toBeNull();
    expect(getStatusDescription().textContent).toBe('0 agents active, 2 agents available');

    const tooltip = await openTooltipViaHover(agentsLink);
    expect(tooltip).toHaveTextContent('0 agents active, 2 agents available');
  });

  it('renders a plain expanded agents link with no ratio, no description, and no tooltip when nothing is configured', async () => {
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });

    const agentsLink = screen.getByRole('link', { name: 'Agents' });
    expect(agentsLink.querySelector('.app-sidebar-agents-count')).toBeNull();
    expect(agentsLink.getAttribute('aria-describedby')).toBeNull();
    expect(document.getElementById(statusDescriptionId)).toBeNull();

    await fireEvent.pointerEnter(agentsLink);
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(document.querySelector('.app-icon-tooltip')).toBeNull();
    expect(agentsLink.getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps the collapsed rail normal when no agents are configured', () => {
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed: true });

    const agentsLink = screen.getByRole('link', { name: 'Agents' });
    expect(agentsLink.querySelector('.app-icon-agent-count')).toBeNull();
    expect(agentsLink.querySelector('.app-sidebar-agents-count')).toBeNull();
    expect(agentsLink.getAttribute('aria-describedby')).toBeNull();
    expect(document.getElementById(statusDescriptionId)).toBeNull();
  });
});

describe('RecentSessionRail Mesh node count', () => {
  const statusDescriptionId = 'app-sidebar-mesh-status-description';

  it.each([1, 3])('explains %i available nodes in an expanded tooltip on hover', async (count) => {
    agentsStore.meshNodeCount = count;
    const status = `${count} ${count === 1 ? 'node' : 'nodes'} available`;
    render(RecentSessionRail, { current: 'Mesh', sessions: [activeSession] });

    const meshLink = screen.getByRole('link', { name: `Mesh, ${count} ${count === 1 ? 'node' : 'nodes'}` });
    expect(meshLink).toHaveAttribute('href', '/mesh');
    expect(meshLink).toHaveAttribute('aria-current', 'page');
    expect(meshLink).toHaveAttribute('aria-describedby', statusDescriptionId);
    expect(document.querySelectorAll(`[id="${statusDescriptionId}"]`)).toHaveLength(1);
    expect(document.getElementById(statusDescriptionId)).toHaveClass('sr-only');
    expect(document.getElementById(statusDescriptionId)).toHaveTextContent(status);
    expect(document.querySelector('.app-icon-tooltip')).toBeNull();

    await fireEvent.pointerEnter(meshLink);
    await waitFor(() => expect(document.querySelector('.app-icon-tooltip')).toHaveTextContent(status));
    expect(document.querySelector('.app-icon-tooltip')).toHaveAttribute('data-side', 'right');
    expect(document.querySelector('.app-icon-tooltip-arrow')).not.toBeNull();
    expect(meshLink).toHaveAttribute('aria-describedby', statusDescriptionId);
  });

  it.each([false, true])('exposes the Mesh count tooltip to keyboard focus (collapsed=%s)', async (collapsed) => {
    agentsStore.meshNodeCount = 2;
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession], collapsed });
    const meshLink = screen.getByRole('link', { name: 'Mesh, 2 nodes' });
    meshLink.focus();
    await waitFor(() => expect(document.querySelector('.app-icon-tooltip'))
      .toHaveTextContent(collapsed ? 'Mesh, 2 nodes available' : '2 nodes available'));
    expect(meshLink).toHaveAttribute('aria-describedby', statusDescriptionId);
    expect(document.querySelectorAll(`[id="${statusDescriptionId}"]`)).toHaveLength(1);
  });

  it('keeps a plain expanded Mesh link when there are no reported nodes', async () => {
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });
    const meshLink = screen.getByRole('link', { name: 'Mesh' });
    expect(meshLink).not.toHaveAttribute('aria-describedby');
    expect(document.getElementById(statusDescriptionId)).toBeNull();
    await fireEvent.pointerEnter(meshLink);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(document.querySelector('.app-icon-tooltip')).toBeNull();
  });

  it('keeps Mesh and Agents status descriptions distinct', () => {
    agentsStore.configs = [{ id: 'agent-1' }];
    agentsStore.connectedAgents = [{ id: 'agent-1' }];
    agentsStore.meshNodeCount = 2;
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });
    const meshLink = screen.getByRole('link', { name: 'Mesh, 2 nodes' });
    const agentsLink = screen.getByRole('link', { name: 'Agents' });
    expect(meshLink).toHaveAccessibleDescription('2 nodes available');
    expect(agentsLink).toHaveAccessibleDescription('1 agent active, 1 agent available');
    expect(meshLink.getAttribute('aria-describedby')).not.toBe(agentsLink.getAttribute('aria-describedby'));
  });

  it('labels the expanded Mesh link with a trailing node count and no icon badge', () => {
    agentsStore.meshNodeCount = 3;

    render(RecentSessionRail, { current: 'Start', sessions: [activeSession] });

    const meshLink = screen.getByRole('link', { name: 'Mesh, 3 nodes' });
    expect(meshLink.querySelector('small')).toHaveTextContent('3');
    expect(meshLink.querySelector('.app-icon-agent-count')).toBeNull();
  });

  it('shows the node count as a badge on the collapsed Mesh icon only', () => {
    agentsStore.meshNodeCount = 2;

    render(RecentSessionRail, { current: 'Start', sessions: [activeSession], collapsed: true });

    const meshLink = screen.getByRole('link', { name: 'Mesh, 2 nodes' });
    const count = meshLink.querySelector('.app-icon-agent-count');
    expect(count).not.toBeNull();
    expect(count).toHaveTextContent('2');
    expect(count).toHaveAttribute('aria-hidden', 'true');
    expect(count?.parentElement).toHaveClass('app-nav-icon-surface');
    expect(meshLink.querySelector('small')).toBeNull();
  });

  it('keeps the singular label for one mesh node', () => {
    agentsStore.meshNodeCount = 1;

    render(RecentSessionRail, { current: 'Start', sessions: [activeSession] });

    expect(screen.getByRole('link', { name: 'Mesh, 1 node' })).toBeInTheDocument();
  });

  it('omits the count badge and suffix when no mesh nodes are available', () => {
    render(RecentSessionRail, { current: 'Start', sessions: [activeSession] });

    const meshLink = screen.getByRole('link', { name: 'Mesh' });
    expect(meshLink.querySelector('small')).toBeNull();
    expect(meshLink.querySelector('.app-icon-agent-count')).toBeNull();
  });
});
