import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSessionSummary } from '$lib/domain/types';

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

const agentsStore = vi.hoisted(() => ({
  configs: [] as unknown[],
  connectedAgents: [] as unknown[],
  agentsNeedingAttention: [] as unknown[]
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
  status: 'waiting'
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 640 });
  agentsStore.configs = [];
  agentsStore.connectedAgents = [];
  agentsStore.agentsNeedingAttention = [];
  inboxStore.actionableItems = [];
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.unstubAllGlobals();
});

describe('RecentSessionRail navigation', () => {
  it('defaults to a labeled sidebar with grouped navigation and readable sessions', () => {
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });

    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Manage')).toBeInTheDocument();
    expect(screen.getByText('Recent sessions')).toBeInTheDocument();
    expect(screen.getByText('Waiting session')).toBeInTheDocument();
    expect(screen.getByText('work · Waiting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
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
    expect(screen.queryByText('Recent sessions')).not.toBeInTheDocument();
  });

  it('shows the compact brand subtitle only in the expanded sidebar', () => {
    const { rerender } = render(RecentSessionRail, { current: 'Today', sessions: [], collapsed: false });

    expect(screen.getByText('Agents command and control').closest('.app-sidebar-brand-copy')).not.toBeNull();

    rerender({ current: 'Today', sessions: [], collapsed: true });
    expect(screen.queryByText('Agents command and control')).not.toBeInTheDocument();
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
    expect(avatar?.querySelector('.session-identicon-svg')).not.toBeNull();
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
