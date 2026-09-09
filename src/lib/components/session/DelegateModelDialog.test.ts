import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelegateAssignmentSource, type DelegateAssignmentsInfo } from '$lib/querymt/generated/types';
import DelegateModelDialog from './DelegateModelDialog.svelte';

const models = [
  { id: 'codex/gpt-5.6-sol', provider: 'codex', model: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'xai/grok-4.6', provider: 'xai', model: 'grok-4.6', label: 'Grok 4.6', node_id: 'node-1', node_label: 'Build server' }
];

const assignments: DelegateAssignmentsInfo = {
  version: 1,
  session_id: 'session-1',
  profile_id: 'quorum',
  revision: 4,
  durable: true,
  editable: true,
  assignments: [{
    agent_id: 'coder',
    name: 'Coder',
    description: 'Writes focused implementation patches',
    model: null,
    source: DelegateAssignmentSource.ProfileDefault,
    configured_default_model_id: 'codex/gpt-5.6-sol'
  }],
  orphaned_overrides: [{ agent_id: 'removed-reviewer', model: { model_id: 'legacy/reviewer' } }]
};

afterEach(cleanup);

describe('DelegateModelDialog', () => {
  it('shows durable routes and sends the selected local or mesh identity', async () => {
    const onAssign = vi.fn(async () => true);
    render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign, onRefresh: vi.fn() }
    });

    expect(screen.getByText('Saved with this session')).toBeTruthy();
    expect(screen.getByText('revision 4')).toBeTruthy();
    expect(screen.getByText('Writes focused implementation patches')).toBeTruthy();
    expect(screen.getByText('removed-reviewer')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.getByText('Use profile default')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Grok 4.6/i }));

    expect(onAssign).toHaveBeenCalledWith('coder', { model_id: 'xai/grok-4.6', node_id: 'node-1' });
  });

  it('preserves unavailable overrides and offers an explicit reset', async () => {
    const onAssign = vi.fn(async () => true);
    render(DelegateModelDialog, {
      props: {
        open: true,
        assignments: {
          ...assignments,
          assignments: [{
            ...assignments.assignments[0],
            model: { model_id: 'missing/model', node_id: 'offline-node' },
            source: DelegateAssignmentSource.Override
          }],
          orphaned_overrides: []
        },
        models,
        onAssign,
        onRefresh: vi.fn()
      }
    });

    expect(screen.getByText('missing/model')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.getByText(/Current override unavailable/i)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Use profile default/i }));
    expect(onAssign).toHaveBeenCalledWith('coder', null);
  });

  it('makes orphan cleanup explicit and does not expose replacement models', async () => {
    const onAssign = vi.fn(async () => true);
    render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign, onRefresh: vi.fn() }
    });

    await fireEvent.click(screen.getByRole('button', { name: /removed-reviewer/i }));
    expect(screen.getByText('Saved route for removed role')).toBeTruthy();
    expect(screen.queryByLabelText('Search delegate models')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear saved route' }));
    expect(onAssign).toHaveBeenCalledWith('removed-reviewer', null);
  });

  it('locks nested picker actions if a refresh makes the session read-only', async () => {
    const onAssign = vi.fn(async () => true);
    const { rerender } = render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign, onRefresh: vi.fn(), onRefreshModels: vi.fn() }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    await rerender({
      open: true,
      assignments: { ...assignments, editable: false },
      models,
      onAssign,
      onRefresh: vi.fn(),
      onRefreshModels: vi.fn()
    });

    const defaultButton = screen.getByRole('button', { name: /Use profile default/i });
    const modelButton = screen.getByRole('button', { name: /Grok 4.6/i });
    expect(defaultButton).toHaveProperty('disabled', true);
    expect(modelButton).toHaveProperty('disabled', true);
    await fireEvent.click(defaultButton);
    await fireEvent.click(modelButton);
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('shows conflict recovery and locks delegated child routes', () => {
    render(DelegateModelDialog, {
      props: {
        open: true,
        assignments: { ...assignments, editable: false },
        models,
        conflict: true,
        onAssign: vi.fn(),
        onRefresh: vi.fn()
      }
    });

    expect(screen.getByText(/Assignments changed elsewhere/i)).toBeTruthy();
    expect(screen.getByText(/Configure routing on its parent session/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Coder coder/i })).toHaveProperty('disabled', true);
  });
});
