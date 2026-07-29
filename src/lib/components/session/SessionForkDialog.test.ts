import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionForkDialog from './SessionForkDialog.svelte';

const target = {
  messageId: 'assistant-1',
  prompt: 'Refactor the session store',
  response: 'Implemented the refactor.',
  includesResponse: true
};

afterEach(cleanup);

describe('SessionForkDialog', () => {
  it('explains the branch and confirms creation', async () => {
    const onConfirm = vi.fn();
    render(SessionForkDialog, { props: { open: true, sourceTitle: 'Original session', target, onConfirm } });

    expect(screen.getByText(/new independent session will branch from Original session/i)).toBeTruthy();
    expect(screen.getByText('Implemented the refactor.')).toBeTruthy();
    expect(screen.getByText(/source and current workspace stay unchanged/i)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Create and open fork' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('blocks duplicate creation while pending', () => {
    render(SessionForkDialog, { props: { open: true, sourceTitle: 'Original', target, pending: true, onConfirm: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Creating fork...' })).toHaveProperty('disabled', true);
  });
});
