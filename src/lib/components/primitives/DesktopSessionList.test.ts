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
});
