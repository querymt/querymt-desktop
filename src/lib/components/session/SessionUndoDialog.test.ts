import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionUndoDialog from './SessionUndoDialog.svelte';

afterEach(cleanup);

describe('SessionUndoDialog', () => {
  it('describes a targeted rollback and confirms it', async () => {
    const onConfirm = vi.fn();
    render(SessionUndoDialog, {
      open: true,
      prompt: 'Refactor the session store',
      affectedTurns: 3,
      onConfirm
    });

    expect(screen.getByText(/This rolls back this turn and 2 later turns/)).toBeTruthy();
    expect(screen.getByText('Refactor the session store')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('blocks duplicate submission while undo is pending', () => {
    render(SessionUndoDialog, {
      open: true,
      prompt: 'Change files',
      affectedTurns: 1,
      pending: true,
      onConfirm: vi.fn()
    });

    expect(screen.getByRole('button', { name: 'Undoing...' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
  });
});
