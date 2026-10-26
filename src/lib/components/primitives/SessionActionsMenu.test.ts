import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionActionsMenu from './SessionActionsMenu.svelte';

const session = {
  sessionId: 'session-1', title: 'Lifecycle task',
  lifecycle: { session_id: 'session-1', resolved: false, archived: false, resolved_at: null, archived_at: null }
};

afterEach(cleanup);

describe('SessionActionsMenu', () => {
  it.each([false, true])('offers the confirmed pin toggle without lifecycle side effects (pinned=%s)', async (pinned) => {
    const onSetPinned = vi.fn(async () => {});
    const onSetLifecycle = vi.fn(async () => {});
    render(SessionActionsMenu, { session: { ...session, pin: { session_id: session.sessionId, pinned, pinned_at: pinned ? '2026-10-20T10:00:00Z' : null } }, canPin: true, onSetPinned, onSetLifecycle });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: pinned ? 'Unpin session' : 'Pin session' }));
    expect(onSetPinned).toHaveBeenCalledExactlyOnceWith(!pinned);
    expect(onSetLifecycle).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('keeps pin errors visible and does not offer pins for unsupported owners', async () => {
    const onSetPinned = vi.fn(async () => { throw new Error('Owner offline'); });
    const view = render(SessionActionsMenu, { session, canPin: false, onSetPinned });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    expect(screen.queryByRole('menuitem', { name: 'Pin session' })).not.toBeInTheDocument();
    await view.rerender({ canPin: true });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Pin session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Owner offline');
  });

  it('shows actions without explanatory commentary', async () => {
    render(SessionActionsMenu, { session, canManage: true, onSetLifecycle: vi.fn(async () => {}) });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    const menu = screen.getByRole('menu');
    expect(menu.querySelector('.session-actions-hint')).toBeNull();
    expect(menu).not.toHaveTextContent('Changes organization, not execution.');
    expect(screen.getByRole('menuitem', { name: 'Mark resolved' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
  });

  it.each([
    ['Mark resolved', false, false, { resolved: true }],
    ['Reopen', true, true, { resolved: false }],
    ['Archive', true, false, { archived: true }],
    ['Restore', true, true, { archived: false }]
  ] as const)('sends only the %s patch without a confirmation dialog', async (label, resolved, archived, patch) => {
    const onSetLifecycle = vi.fn(async () => {});
    render(SessionActionsMenu, { session: { ...session, lifecycle: { ...session.lifecycle, resolved, archived } }, canManage: true, onSetLifecycle });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(onSetLifecycle).toHaveBeenCalledExactlyOnceWith(patch);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('supports opening, selecting and closing with the keyboard', async () => {
    const onSetLifecycle = vi.fn(async () => {});
    render(SessionActionsMenu, { session, canManage: true, onSetLifecycle });
    const trigger = screen.getByRole('button', { name: 'Session actions for Lifecycle task' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const resolve = await screen.findByRole('menuitem', { name: 'Mark resolved' });
    await waitFor(() => expect(resolve).toHaveFocus());
    await fireEvent.keyDown(resolve, { key: 'Enter' });
    expect(onSetLifecycle).toHaveBeenCalledWith({ resolved: true });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('keeps an actionable error visible and permits retry without navigation', async () => {
    const onSetLifecycle = vi.fn(async () => {}).mockRejectedValueOnce(new Error('Owner is offline'));
    render(SessionActionsMenu, { session, canManage: true, onSetLifecycle });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Owner is offline');
    expect(screen.getByRole('alert')).toHaveTextContent('Retry the action');
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onSetLifecycle).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('prevents repeated and conflicting writes while saving', async () => {
    let release!: () => void;
    const onSetLifecycle = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(SessionActionsMenu, { session, canManage: true, onSetLifecycle });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Mark resolved' }));
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Mark resolved' }));
    expect(onSetLifecycle).toHaveBeenCalledOnce();
    release();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it.each([false, true])('does not fabricate controls for unsupported or unknown state (%s)', async (canManage) => {
    const onSetLifecycle = vi.fn(async () => {});
    render(SessionActionsMenu, { session: { ...session, lifecycle: null }, canManage, onSetLifecycle });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    expect(screen.getByText(/Lifecycle controls unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark resolved' })).not.toBeInTheDocument();
    expect(onSetLifecycle).not.toHaveBeenCalled();
  });
});

describe('SessionActionsMenu worktree entries', () => {
  it('shows worktree actions only when the caller enables them', async () => {
    const view = render(SessionActionsMenu, { session });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    expect(screen.queryByRole('menuitem', { name: 'New worktree session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Hand off worktree' })).not.toBeInTheDocument();
    const onCreateWorktree = vi.fn();
    const onHandoffWorktree = vi.fn();
    await view.rerender({ onCreateWorktree, onHandoffWorktree });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'New worktree session' }));
    expect(onCreateWorktree).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Lifecycle task' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Hand off worktree' }));
    expect(onHandoffWorktree).toHaveBeenCalledOnce();
  });
});

