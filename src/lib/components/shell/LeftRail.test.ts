import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const agentsStore = vi.hoisted(() => ({
  connectedAgents: [] as unknown[],
  agentsNeedingAttention: [] as unknown[]
}));
const inboxStore = vi.hoisted(() => ({ actionableItems: [] as unknown[] }));

vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));
vi.mock('$lib/stores/inbox.svelte', () => ({ inboxStore }));

import LeftRail from './LeftRail.svelte';

afterEach(cleanup);

beforeEach(() => {
  agentsStore.connectedAgents = [];
  agentsStore.agentsNeedingAttention = [];
  inboxStore.actionableItems = [];
});

describe('LeftRail Inbox attention', () => {
  it('hides the attention dot when no Inbox action is required', () => {
    const { container } = render(LeftRail, { current: 'Today', collapsed: true });

    expect(container.querySelector('.sidebar-attention-dot')).toBeNull();
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('shows the attention dot and action count in the accessible label', () => {
    inboxStore.actionableItems = [{ id: 'one' }, { id: 'two' }];

    const { container } = render(LeftRail, { current: 'Today', collapsed: true });

    expect(container.querySelector('.sidebar-attention-dot')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Inbox, 2 actions required' })).toBeInTheDocument();
  });

  it('uses the same attention dot for Agents needing attention', () => {
    agentsStore.connectedAgents = [{ id: 'agent-1' }];
    agentsStore.agentsNeedingAttention = [{ id: 'agent-2' }];

    const { container } = render(LeftRail, { current: 'Today', collapsed: true });

    expect(container.querySelectorAll('.sidebar-attention-dot')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Agents, 1 online, 1 need attention' })).toBeInTheDocument();
  });
});
