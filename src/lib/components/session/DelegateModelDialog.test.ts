import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DelegateAssignmentSource,
  DelegateReasoningEffort,
  type DelegateAssignmentsInfo
} from '$lib/querymt/generated/types';
import DelegateModelDialog from './DelegateModelDialog.svelte';
import ModelQuickPicker from '$lib/components/primitives/ModelQuickPicker.svelte';
import type { ModelEntry } from '$lib/domain/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  it.each([false, true])('uses session-relative locality for routes, headings and rows without changing identity (recent=%s)', async (recent) => {
    const a: ModelEntry = { id: 'codex/shared', provider: 'codex', model: 'shared', label: 'A model' };
    const b: ModelEntry = { ...a, label: 'B model', node_id: 'B', node_label: 'flkr' };
    const c: ModelEntry = { ...a, label: 'C model', node_id: 'C', node_label: 'third-host' };
    const catalog = [a, b, c];
    const ownerAssignments: DelegateAssignmentsInfo = {
      ...assignments,
      assignments: [
        { ...assignments.assignments[0], model: { model_id: b.id, node_id: 'B' }, source: DelegateAssignmentSource.Override },
        { ...assignments.assignments[0], agent_id: 'reviewer', name: 'Reviewer', model: { model_id: a.id }, source: DelegateAssignmentSource.Override },
        { ...assignments.assignments[0], agent_id: 'auditor', name: 'Auditor', model: { model_id: c.id, node_id: 'C' }, source: DelegateAssignmentSource.Override }
      ],
      orphaned_overrides: []
    };
    const onAssign = vi.fn(async () => true);
    const props = {
      open: true, assignments: ownerAssignments, models: catalog,
      modelLocation: { servingNodeId: 'A', servingNodeLabel: 'lstr', ownerNodeId: 'B' },
      recentModelsByDelegate: { coder: recent ? catalog : [] },
      onAssign, onRefresh: vi.fn()
    };
    const { rerender } = render(DelegateModelDialog, { props });
    const coder = screen.getByRole('button', { name: /Coder coder/ });
    expect(coder.querySelector('.lucide-network')).toBeNull();
    expect(screen.getByRole('button', { name: /Reviewer reviewer/ })).toHaveTextContent('lstr');
    expect(screen.getByRole('button', { name: /Auditor auditor/ })).toHaveTextContent('third-host');
    await fireEvent.click(coder);
    const ownerRow = screen.getByRole('button', { name: /B model/ });
    const viewerRow = screen.getByRole('button', { name: /A model/ });
    expect(ownerRow).toHaveAttribute('aria-pressed', 'true');
    expect(within(ownerRow).queryByLabelText(/Mesh node/)).toBeNull();
    expect(within(viewerRow).getByLabelText('Mesh node lstr')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /C model/ })).getByLabelText('Mesh node third-host')).toBeInTheDocument();
    if (recent) {
      expect(within(screen.getByText('Recent').closest('section')!).getAllByRole('button')).toHaveLength(3);
    } else {
      expect(screen.getByText('codex', { selector: '.delegate-model-picker-group-title > span' })).toBeInTheDocument();
      expect(screen.getByText('codex · lstr')).toBeInTheDocument();
      expect(screen.queryByText('codex · flkr')).toBeNull();
    }
    await fireEvent.click(ownerRow);
    expect(onAssign).toHaveBeenLastCalledWith('coder', { model_id: b.id, node_id: 'B' });
    await fireEvent.click(viewerRow);
    expect(onAssign).toHaveBeenLastCalledWith('coder', { model_id: a.id, node_id: undefined });
    const search = screen.getByLabelText('Search delegate models');
    await fireEvent.input(search, { target: { value: 'lstr' } });
    expect(screen.getByRole('button', { name: /A model/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /B model/ })).toBeNull();
    await fireEvent.input(search, { target: { value: '' } });
    await rerender({ ...props, modelLocation: { ...props.modelLocation, ownerNodeId: 'A' } });
    expect(within(screen.getByRole('button', { name: /A model/ })).queryByLabelText(/Mesh node/)).toBeNull();
    expect(within(screen.getByRole('button', { name: /B model/ })).getByLabelText('Mesh node flkr')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /B model/ })).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /Coder coder/ })).toHaveTextContent('flkr');
    expect(screen.getByRole('button', { name: /Reviewer reviewer/ }).querySelector('.lucide-network')).toBeNull();
    expect(b.node_id).toBe('B');
    expect(a.node_id).toBeUndefined();
  });

  it('uses shared availability blocking and recovers without rewriting the delegate override', async () => {
    const offline: ModelEntry = { ...models[1], availability: 'unavailable' };
    const onAssign = vi.fn(async () => true);
    const props = { open: true, assignments, models: [models[0], offline], onAssign, onRefresh: vi.fn() };
    const { rerender } = render(DelegateModelDialog, { props });
    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/ }));
    const row = screen.getByRole('button', { name: /Grok 4.6/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(within(row).getByLabelText('Mesh node Build server').querySelector('.lucide-network')).toHaveClass('model-availability-warning');
    expect(row.querySelector('.lucide-triangle-alert')).toBeNull();
    const warning = screen.getByRole('img', { name: 'Provider temporarily unavailable. Refresh or check the provider.' });
    expect(warning.closest('.delegate-model-picker-group-title')).not.toBeNull();
    expect(warning.closest('button')).toBeNull();
    await fireEvent.click(row);
    await fireEvent.input(screen.getByLabelText('Search delegate models'), { target: { value: 'grok' } });
    await fireEvent.keyDown(screen.getByLabelText('Search delegate models'), { key: 'Enter' });
    expect(onAssign).not.toHaveBeenCalled();
    await rerender({ ...props, models: [models[0], { ...offline, availability: 'available' }] });
    await fireEvent.click(screen.getByRole('button', { name: /Grok 4.6/ }));
    expect(onAssign).toHaveBeenCalledWith('coder', { model_id: offline.id, node_id: offline.node_id });
  });

  it('uses the normal model picker shell and spacing while retaining the routing overview layout', async () => {
    const normal = render(ModelQuickPicker, { modelOptions: models, selectedModelId: models[0].id, onSelect: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /GPT-5.6 Sol from codex/ }));
    const regular = screen.getByRole('dialog', { name: 'Switch model' });
    const shellClasses = ['app-picker', 'app-picker-model'];
    expect(regular).toHaveClass(...shellClasses);
    const headerClasses = regular.querySelector('header')!.className;
    const bodyClasses = regular.querySelector('.app-picker-body')!.className;
    const footerClasses = regular.querySelector('footer')!.className;
    normal.unmount();
    render(DelegateModelDialog, { props: { open: true, assignments, models, onAssign: vi.fn(), onRefresh: vi.fn() } });
    expect(screen.getByRole('dialog', { name: 'Delegate routing' })).toHaveClass('app-dialog-wide', 'delegate-model-dialog');
    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/ }));
    const delegate = screen.getByRole('dialog', { name: 'Route Coder' });
    expect(delegate).toHaveClass(...shellClasses);
    for (const legacyClass of ['app-dialog', 'app-dialog-wide', 'delegate-model-dialog']) {
      expect(delegate).not.toHaveClass(legacyClass);
    }
    expect(delegate.querySelector('header')).toHaveClass(headerClasses);
    expect(delegate.querySelector('.app-picker-body')).toHaveClass(bodyClasses);
    expect(delegate.querySelector('footer')).toHaveClass(footerClasses);
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('dialog', { name: 'Delegate routing' })).toHaveClass('app-dialog-wide', 'delegate-model-dialog');
  });

  it('wires the same session location into the root and delegate model pickers', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/routes/sessions/[agentId]/[sessionId]/+page.svelte'), 'utf8');
    const context = 'modelLocation={agentsStore.getSessionModelLocation(agentId, sessionId)}';
    expect(page.match(/<SessionComposer[\s\S]*?\/>/)?.[0]).toContain(context);
    expect(page.match(/<DelegateModelDialog[\s\S]*?\/>/)?.[0]).toContain(context);
  });

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
    expect(screen.getByRole('dialog', { name: 'Route Coder' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('dialog', { name: 'Delegate routing' })).toBeTruthy();
  });

  it('shows the selected delegate history with a history icon and keeps other delegates separate', async () => {
    const onAssign = vi.fn(async () => true);
    render(DelegateModelDialog, {
      props: {
        open: true,
        assignments: {
          ...assignments,
          assignments: [...assignments.assignments, { ...assignments.assignments[0], agent_id: 'reviewer', name: 'Reviewer' }]
        },
        models,
        recentModelsByDelegate: { coder: [models[1]], reviewer: [models[0]] },
        onAssign,
        onRefresh: vi.fn()
      }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    const coderRecent = screen.getByText('Recent').closest('section')!;
    expect(coderRecent.querySelector('.lucide-history')).not.toBeNull();
    expect(within(coderRecent).getByRole('button', { name: /Grok 4.6/ })).toBeInTheDocument();
    expect(within(coderRecent).queryByRole('button', { name: /GPT-5.6 Sol/ })).toBeNull();
    expect(document.querySelectorAll('.delegate-model-choice')).toHaveLength(2);
    await fireEvent.click(within(coderRecent).getByRole('button', { name: /Grok 4.6/ }));
    expect(onAssign).toHaveBeenCalledWith('coder', { model_id: models[1].id, node_id: 'node-1' });
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await fireEvent.click(screen.getByRole('button', { name: /Reviewer reviewer/i }));
    const reviewerRecent = screen.getByText('Recent').closest('section')!;
    expect(within(reviewerRecent).getByRole('button', { name: /GPT-5.6 Sol/ })).toBeInTheDocument();
    expect(within(reviewerRecent).queryByRole('button', { name: /Grok 4.6/ })).toBeNull();
    const search = screen.getByLabelText('Search delegate models');
    await fireEvent.input(search, { target: { value: 'Build server' } });
    expect(screen.queryByText('Recent')).toBeNull();
    expect(screen.getByRole('button', { name: /Grok 4.6/ })).toBeInTheDocument();
    await fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Delegate routing' })).toBeInTheDocument();
  });

  it('updates delegate history while open and follows Recent order for keyboard selection', async () => {
    const onAssign = vi.fn(async () => true);
    const { rerender } = render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign, onRefresh: vi.fn() }
    });
    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.queryByText('Recent')).toBeNull();
    await rerender({ recentModelsByDelegate: { coder: [models[1]] } });
    const firstRow = document.querySelector('.delegate-model-choice');
    expect(firstRow).toHaveTextContent('Grok 4.6');
    await fireEvent.keyDown(screen.getByLabelText('Search delegate models'), { key: 'Enter' });
    expect(onAssign).toHaveBeenCalledWith('coder', { model_id: models[1].id, node_id: 'node-1' });
    expect(screen.getByRole('dialog', { name: 'Route Coder' })).toBeInTheDocument();
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
        } as unknown as DelegateAssignmentsInfo,
        models,
        onAssign,
        onRefresh: vi.fn()
      }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.queryByRole('button', { name: 'Delegate reasoning effort' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
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
    expect(screen.getByRole('button', { name: 'Refresh models' })).toBeTruthy();
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

  it('focuses model search when a delegate route is opened', async () => {
    render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign: vi.fn(), onRefresh: vi.fn() }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    await waitFor(() => expect(screen.getByLabelText('Search delegate models')).toHaveFocus());
  });

  it('returns to the routing list when Escape is pressed in model search', async () => {
    render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign: vi.fn(), onRefresh: vi.fn() }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    await fireEvent.keyDown(screen.getByLabelText('Search delegate models'), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Delegate routing' })).toBeTruthy();
    expect(screen.getByText('Saved with this session')).toBeTruthy();
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

  it('returns to the routing list from picker close without closing the dialog', async () => {
    render(DelegateModelDialog, {
      props: { open: true, assignments, models, onAssign: vi.fn(), onRefresh: vi.fn() }
    });

    await fireEvent.click(screen.getByRole('button', { name: /Coder coder/i }));
    expect(screen.getByRole('dialog', { name: 'Route Coder' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Back to delegate routing' }));
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
