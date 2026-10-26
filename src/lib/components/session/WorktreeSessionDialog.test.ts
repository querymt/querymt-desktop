import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorktreeSessionDialog from './WorktreeSessionDialog.svelte';

afterEach(cleanup);

describe('WorktreeSessionDialog create mode', () => {
  it('submits name and base ref', async () => {
    const onCreate = vi.fn();
    render(WorktreeSessionDialog, { props: { open: true, mode: 'create', sourceTitle: 'Src', onCreate } });
    await fireEvent.input(screen.getByLabelText('Worktree name'), { target: { value: 'feat' } });
    await fireEvent.input(screen.getByLabelText('Base ref'), { target: { value: 'main' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create and open' }));
    expect(onCreate).toHaveBeenCalledWith({ name: 'feat', baseRef: 'main', includeLocalChanges: false });
  });

  it('blocks submission and explains when base ref and local changes are combined', async () => {
    const onCreate = vi.fn();
    render(WorktreeSessionDialog, { props: { open: true, mode: 'create', sourceTitle: 'Src', onCreate } });
    await fireEvent.input(screen.getByLabelText('Base ref'), { target: { value: 'main' } });
    await fireEvent.click(screen.getByLabelText('Include local changes'));
    expect(screen.getByRole('alert')).toHaveTextContent('not both');
    const submit = screen.getByRole('button', { name: 'Create and open' });
    expect(submit).toBeDisabled();
    await fireEvent.click(submit);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('sends local changes without a base ref', async () => {
    const onCreate = vi.fn();
    render(WorktreeSessionDialog, { props: { open: true, mode: 'create', sourceTitle: 'Src', onCreate } });
    await fireEvent.click(screen.getByLabelText('Include local changes'));
    await fireEvent.click(screen.getByRole('button', { name: 'Create and open' }));
    expect(onCreate).toHaveBeenCalledWith({ name: undefined, baseRef: undefined, includeLocalChanges: true });
  });
});

describe('WorktreeSessionDialog handoff mode', () => {
  it('is clean by default and hides the summary toggle without support', async () => {
    const onHandoff = vi.fn();
    render(WorktreeSessionDialog, { props: { open: true, mode: 'handoff', sourceTitle: 'Src', onHandoff } });
    expect(screen.queryByLabelText('Start with a summary')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Hand off and open' }));
    expect(onHandoff).toHaveBeenCalledWith({ name: undefined, summary: undefined });
  });

  it('offers the summary off by default and sends it only when enabled', async () => {
    const onHandoff = vi.fn();
    render(WorktreeSessionDialog, { props: { open: true, mode: 'handoff', sourceTitle: 'Src', summarySupported: true, onHandoff } });
    const toggle = screen.getByLabelText('Start with a summary') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await fireEvent.click(toggle);
    await fireEvent.click(screen.getByRole('button', { name: 'Hand off and open' }));
    expect(onHandoff).toHaveBeenCalledWith({ name: undefined, summary: true });
  });

  it('stays pending and shows agent refusals', () => {
    render(WorktreeSessionDialog, { props: { open: true, mode: 'handoff', sourceTitle: 'Src', pending: true, error: 'Stop the running turn first.', onHandoff: vi.fn() } });
    expect(screen.getByRole('button', { name: 'Handing off...' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Stop the running turn');
  });
});
