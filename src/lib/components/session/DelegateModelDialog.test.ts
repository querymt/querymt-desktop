import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DelegateAssignmentSource,
  DelegateReasoningEffort,
  type DelegateAssignmentsInfo
} from '$lib/querymt/generated/types';
import DelegateModelDialog from './DelegateModelDialog.svelte';

const models = [
  { id: 'codex/gpt-5.6-sol', provider: 'codex', model: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'xai/grok-4.6', provider: 'xai', model: 'grok-4.6', label: 'Grok 4.6', node_id: 'node-1', node_label: 'Build server' }
];

const assignments: DelegateAssignmentsInfo = {
  version: 1,
  reasoning_effort_supported: true,
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
    configured_default_model_id: 'codex/gpt-5.6-sol',
    reasoning_effort: null
  }],
  orphaned_overrides: [{
    agent_id: 'removed-reviewer',
    model: { model_id: 'legacy/reviewer' },
    reasoning_effort: DelegateReasoningEffort.Low
  }]
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
    expect(screen.getByText('Profile default')).toBeTruthy();
    expect(screen.queryByText('Override')).toBeNull();
    expect(screen.queryByText('Profile')).toBeNull();
    expect(screen.getByText('removed-reviewer')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.getByRole('dialog', { name: 'Route Coder' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Delegate routing' })).toBeNull();
    expect(screen.queryByText('Saved with this session')).toBeNull();
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
    const overridePill = screen.getByText('Override');
    expect(overridePill.classList.contains('delegate-model-source')).toBe(true);
    expect(overridePill.closest('.delegate-model-route-name')?.querySelector('.delegate-model-route-model')?.textContent).toBe('missing/model');
    expect(screen.queryByText('Profile')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.getByText(/Current override unavailable/i)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Use profile default/i }));
    expect(onAssign).toHaveBeenCalledWith('coder', null);
    expect(screen.getByRole('dialog', { name: 'Route Coder' })).toBeTruthy();
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
    expect(onAssign).toHaveBeenCalledWith('removed-reviewer', null, null);
  });

  it('selects explicit reasoning and can restore session inheritance', async () => {
    const onAssign = vi.fn(async () => true);
    render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign, onRefresh: vi.fn() }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    const reasoningSelect = screen.getByRole('button', { name: 'Delegate reasoning effort' });
    Object.defineProperties(reasoningSelect, {
      hasPointerCapture: { value: () => false },
      releasePointerCapture: { value: () => undefined }
    });
    await fireEvent.pointerDown(reasoningSelect, { button: 0, pointerType: 'mouse' });
    const highOption = await screen.findByRole('option', { name: 'High' });
    await fireEvent.pointerDown(highOption, { button: 0, pointerType: 'mouse' });
    await fireEvent.pointerUp(highOption, { button: 0, pointerType: 'mouse' });
    expect(onAssign).toHaveBeenLastCalledWith('coder', null, DelegateReasoningEffort.High);

    await fireEvent.pointerDown(reasoningSelect, { button: 0, pointerType: 'mouse' });
    const inheritOption = await screen.findByRole('option', { name: 'Inherit' });
    await fireEvent.pointerDown(inheritOption, { button: 0, pointerType: 'mouse' });
    await fireEvent.pointerUp(inheritOption, { button: 0, pointerType: 'mouse' });
    expect(onAssign).toHaveBeenLastCalledWith('coder', null, null);
  });

  it('hides reasoning controls and preserves model-only orphan cleanup for an older backend', async () => {
    const onAssign = vi.fn(async () => true);
    render(DelegateModelDialog, {
      props: {
        open: true,
        assignments: {
          ...assignments,
          reasoning_effort_supported: undefined,
          assignments: assignments.assignments.map(({ reasoning_effort: _, ...assignment }) => assignment),
          orphaned_overrides: assignments.orphaned_overrides.map(({ reasoning_effort: _, ...assignment }) => assignment)
        },
        models,
        onAssign,
        onRefresh: vi.fn()
      }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.queryByRole('button', { name: 'Delegate reasoning effort' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Delegate routing' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /removed-reviewer/i }));
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

  it('returns to the routing list from picker Escape without closing the dialog', async () => {
    render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign: vi.fn(), onRefresh: vi.fn() }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.getByRole('dialog', { name: 'Route Coder' })).toBeTruthy();

    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Delegate routing' })).toBeTruthy();
    expect(screen.getByText('Saved with this session')).toBeTruthy();
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

  it('fuzzy-matches models by name, provider, and remote host', async () => {
    render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign: vi.fn(), onRefresh: vi.fn() }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    const search = screen.getByLabelText('Search delegate models');
    const choice = (name: RegExp) =>
      screen.queryAllByRole('button').find((button) => button.classList.contains('delegate-model-choice') && name.test(button.textContent ?? ''));

    await fireEvent.input(search, { target: { value: 'grk' } });
    expect(choice(/Grok 4.6/i)).toBeTruthy();
    expect(choice(/GPT-5.6 Sol/i)).toBeUndefined();

    await fireEvent.input(search, { target: { value: 'xai' } });
    expect(choice(/Grok 4.6/i)).toBeTruthy();
    expect(choice(/GPT-5.6 Sol/i)).toBeUndefined();

    await fireEvent.input(search, { target: { value: 'build' } });
    expect(choice(/Grok 4.6/i)).toBeTruthy();
    expect(choice(/GPT-5.6 Sol/i)).toBeUndefined();

    await fireEvent.input(search, { target: { value: 'codex sol' } });
    expect(choice(/GPT-5.6 Sol/i)).toBeTruthy();
    expect(choice(/Grok 4.6/i)).toBeUndefined();
  });
});
