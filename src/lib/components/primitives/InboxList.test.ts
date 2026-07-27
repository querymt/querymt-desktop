import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InboxList from './InboxList.svelte';
import type { InboxItem } from '$lib/domain/types';

const request: InboxItem = {
  id: 'request-1',
  agentId: 'agent-1',
  agentName: 'QMTCODE',
  sessionId: 'session-1',
  type: 'permission',
  title: 'Allow command?',
  detail: 'Run npm test',
  owner: 'QMTCODE',
  severity: 'medium',
  status: 'pending',
  actions: [{ id: 'allow', label: 'Allow', kind: 'allow_once' }]
};

afterEach(cleanup);

describe('InboxList states', () => {
  it('shows a calm all-clear state when connected with no requests', () => {
    render(InboxList, { items: [] });

    expect(screen.getByText('No requests need attention')).toBeInTheDocument();
    expect(screen.getByText('New permission and input requests will appear here.')).toBeInTheDocument();
  });

  it('distinguishes initial loading from the empty state', () => {
    render(InboxList, { items: [], loading: true });

    expect(screen.getByLabelText('Loading requests')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No requests need attention')).not.toBeInTheDocument();
  });

  it('offers agent recovery while disconnected', async () => {
    const onOpenAgents = vi.fn();
    render(InboxList, { items: [], disconnected: true, onOpenAgents });

    expect(screen.getByText('No agents connected')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Open agents' }));
    expect(onOpenAgents).toHaveBeenCalledOnce();
  });

  it('keeps requests visible when connection refresh fails', async () => {
    const onRetry = vi.fn();
    render(InboxList, { items: [request], error: 'Connection lost.', onRetry });

    expect(screen.getByText('Allow command?')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Request status may be out of date.');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
