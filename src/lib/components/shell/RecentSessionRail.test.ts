import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSessionSummary } from '$lib/domain/types';

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

const agentsStore = vi.hoisted(() => ({
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
  agentsStore.connectedAgents = [];
  agentsStore.agentsNeedingAttention = [];
  inboxStore.actionableItems = [];
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.unstubAllGlobals();
});

describe('RecentSessionRail attention indicators', () => {
  it('shows activity and the shared attention dot together for a session requiring action', () => {
    inboxStore.actionableItems = [{ id: 'request-1', agentId: 'agent-1', sessionId: 'session-1' }];

    const { container } = render(RecentSessionRail, {
      current: 'Sessions',
      sessions: [activeSession]
    });

    const sessionLink = screen.getByRole('link', {
      name: 'Waiting session, Waiting, action required, Ctrl/Cmd+1'
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

  it('keeps only the activity spinner when no session action is required', () => {
    render(RecentSessionRail, { current: 'Sessions', sessions: [activeSession] });

    const sessionLink = screen.getByRole('link', { name: 'Waiting session, Waiting, Ctrl/Cmd+1' });
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

    render(RecentSessionRail, { current: 'Sessions', sessions });

    expect(screen.getAllByRole('link', { name: /Session \d, Waiting/ })).toHaveLength(1);
  });
});
