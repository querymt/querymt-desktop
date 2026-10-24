import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModelQuickPicker from './ModelQuickPicker.svelte';
import ModelPickerPanel, { type ModelPickerReasoningControl } from './ModelPickerPanel.svelte';
import { getModelSelectionKey } from '$lib/querymt/config-options';
import type { ModelEntry } from '$lib/domain/types';

const anthropic: ModelEntry = {
  id: 'anthropic/claude-sonnet-4',
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  label: 'Claude Sonnet 4'
};

const custom: ModelEntry = {
  id: 'custom/gateway',
  provider: 'my-gateway',
  model: 'gateway-model',
  label: 'Gateway model'
};

const remote: ModelEntry = {
  id: 'xai/grok-4.7',
  provider: 'xai',
  model: 'grok-4.7',
  label: 'grok-4.7',
  node_id: 'node-1',
  node_label: 'Build server'
};

afterEach(() => {
  cleanup();
  document.getElementById('querymt-provider-sprite')?.remove();
  vi.useRealTimers();
});

function renderPicker(props: Record<string, unknown> = {}) {
  return render(ModelQuickPicker, {
    modelOptions: [anthropic, custom, remote],
    onSelect: () => {},
    ...props
  });
}

describe('ModelPickerPanel provider headings', () => {
  it.each([false, true])('uses session-relative hostname badges in every row (recent=%s)', async (recent) => {
    const onSelect = vi.fn();
    const lstr: ModelEntry = { id: 'codex/gpt-6.1-sol', provider: 'codex', model: 'gpt-6.1-sol' };
    const flkr: ModelEntry = { ...lstr, node_id: 'B', node_label: 'flkr' };
    const props = {
      models: [lstr, flkr], recentModels: recent ? [flkr, lstr] : [],
      modelLocation: { servingNodeId: 'A', servingNodeLabel: 'lstr', ownerNodeId: 'B' },
      selectedModelId: getModelSelectionKey(flkr), onSelect
    };
    const { rerender } = render(ModelPickerPanel, props);
    const rows = screen.getAllByRole('button', { name: /gpt-6.1-sol/ });
    const ownerRow = rows.find((row) => row.getAttribute('aria-pressed') === 'true')!;
    const viewerRow = rows.find((row) => row.getAttribute('aria-pressed') === 'false')!;
    expect(within(ownerRow).queryByLabelText(/Mesh node/)).not.toBeInTheDocument();
    expect(within(viewerRow).getByLabelText('Mesh node lstr')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mesh node flkr')).not.toBeInTheDocument();
    if (!recent) {
      expect(screen.getByText('codex · lstr')).toBeInTheDocument();
      expect(screen.getByText('codex', { selector: '.delegate-model-picker-group-title > span' })).toBeInTheDocument();
    }
    await fireEvent.click(ownerRow);
    expect(onSelect).toHaveBeenLastCalledWith(flkr);
    await fireEvent.click(viewerRow);
    expect(onSelect).toHaveBeenLastCalledWith(lstr);
    // Viewing an A-owned session reverses locality, not provider identities.
    await rerender({ ...props, modelLocation: { ...props.modelLocation, ownerNodeId: 'A' } });
    expect(screen.queryByLabelText('Mesh node lstr')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Mesh node flkr')).toBeInTheDocument();
    expect(flkr.node_id).toBe('B');
    expect(lstr.node_id).toBeUndefined();
  });

  it('searches by the displayed serving hostname without changing the selected provider node', async () => {
    const lstr: ModelEntry = { ...anthropic };
    const flkr: ModelEntry = { ...remote, node_id: 'B', node_label: 'flkr' };
    const onSelect = vi.fn();
    render(ModelPickerPanel, {
      models: [lstr, flkr], recentModels: [lstr, flkr], query: 'lstr',
      modelLocation: { servingNodeId: 'A', servingNodeLabel: 'lstr', ownerNodeId: 'B' }, onSelect
    });
    const row = screen.getByRole('button', { name: /Claude Sonnet 4/ });
    expect(screen.queryByRole('button', { name: /grok-4.7/ })).not.toBeInTheDocument();
    expect(within(row).getByLabelText('Mesh node lstr')).toBeInTheDocument();
    await fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(lstr);
    expect(lstr.node_id).toBeUndefined();
  });

  it('shows provider marks before labels, including mesh groups, with a custom-provider fallback', () => {
    const codex: ModelEntry = { id: 'codex/gpt-5.5', provider: 'codex', model: 'gpt-5.5' };
    render(ModelPickerPanel, { models: [codex, anthropic, remote, custom], onSelect: () => {} });

    for (const [label, iconId] of [['codex', 'codex'], ['anthropic', 'anthropic'], ['xai · Build server', 'xai']]) {
      const heading = screen.getByText(label).closest('.delegate-model-picker-group-title');
      const icon = heading?.firstElementChild;
      expect(heading).toHaveStyle({ display: 'flex', alignItems: 'center', gap: '0.4rem' });
      expect(icon?.tagName.toLowerCase()).toBe('svg');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('width', '12');
      expect(icon).toHaveAttribute('height', '12');
      expect(icon?.querySelector('use')).toHaveAttribute('href', `#querymt-provider-${iconId}`);
      expect(document.getElementById(`querymt-provider-${iconId}`)).not.toBeNull();
    }

    const customHeading = screen.getByText('my-gateway').closest('.delegate-model-picker-group-title');
    expect(customHeading?.firstElementChild).toHaveClass('lucide-bot');
    expect(customHeading?.querySelector('use')).toBeNull();
  });
});

describe('model catalog availability', () => {
  const hint = 'Provider temporarily unavailable. Refresh or check the provider.';

  it.each([false, true])('retains unavailable rows and selection but blocks clicks and Enter, then recovers (recent=%s)', async (recent) => {
    const offline: ModelEntry = { ...remote, availability: 'unavailable' };
    const local: ModelEntry = { ...remote, node_id: undefined, node_label: undefined };
    const other: ModelEntry = { ...remote, node_id: 'node-2', node_label: 'Other server', availability: 'unknown' };
    const props = { models: [offline, local, other], recentModels: recent ? [offline] : [],
      selectedModelId: getModelSelectionKey(offline), onSelect: vi.fn(), onRefresh: vi.fn(), searchLabel: 'Models' };
    const { rerender } = render(ModelPickerPanel, props);
    const rows = document.querySelectorAll<HTMLButtonElement>('.delegate-model-choice');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute('aria-disabled', 'true');
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    const warning = within(rows[0]).getByLabelText('Provider temporarily unavailable');
    expect(warning).toHaveClass('model-availability-warning');
    expect(warning.parentElement).toHaveAttribute('title', hint);
    expect(rows[0]).not.toHaveTextContent('Unavailable');
    await fireEvent.click(rows[0]);
    const search = screen.getByLabelText('Models');
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(props.onSelect).not.toHaveBeenCalled();
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(props.onSelect).toHaveBeenLastCalledWith(local);
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(props.onSelect).toHaveBeenLastCalledWith(other);
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    expect(props.onRefresh).toHaveBeenCalledOnce();
    if (!recent) {
      await fireEvent.pointerEnter(screen.getByRole('button', { name: hint }));
      expect(await screen.findByText(hint, { selector: '.app-tooltip-content' })).toBeInTheDocument();
    }
    const recovered: ModelEntry = { ...offline, availability: 'available' };
    await rerender({ ...props, models: [recovered, local, other] });
    const restored = document.querySelector<HTMLButtonElement>('.delegate-model-choice')!;
    expect(restored).toHaveAttribute('aria-disabled', 'false');
    expect(restored).toHaveAttribute('aria-pressed', 'true');
    expect(within(restored).queryByLabelText('Provider temporarily unavailable')).toBeNull();
    await fireEvent.click(restored);
    expect(props.onSelect).toHaveBeenLastCalledWith(recovered);
  });

  it('skips an unavailable row between healthy choices in both keyboard directions', async () => {
    const onSelect = vi.fn();
    render(ModelPickerPanel, { models: [anthropic, { ...remote, availability: 'unavailable' }, custom], onSelect, searchLabel: 'Models' });
    const search = screen.getByLabelText('Models');
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(custom);
    await fireEvent.keyDown(search, { key: 'ArrowUp' });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(anthropic);
  });

  it('keeps an unavailable selected model visible in the trigger and allows opening to refresh', async () => {
    const offline: ModelEntry = { ...remote, availability: 'unavailable' };
    const props = { modelOptions: [offline], selectedModelId: getModelSelectionKey(offline), onSelect: vi.fn() };
    const { rerender } = renderPicker(props);
    const trigger = screen.getByRole('button', { name: `${remote.label}. ${hint}` });
    expect(trigger).toHaveTextContent(remote.label!);
    expect(trigger.querySelector('.model-availability-warning')).not.toBeNull();
    expect(trigger).not.toBeDisabled();
    await fireEvent.pointerEnter(trigger);
    expect(await screen.findByText(`${remote.label}. ${hint}`, { selector: '.app-tooltip-content' })).toBeInTheDocument();
    await fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    await fireEvent.click(within(dialog).getByRole('button', { name: /grok-4.7/ }));
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    await rerender({ ...props, modelOptions: [{ ...offline, availability: 'available' }] });
    expect(screen.getByRole('button', { name: 'grok-4.7 from xai on Build server' }).querySelector('.model-availability-warning')).toBeNull();
  });
});

describe('ModelQuickPicker recent models', () => {
  it('shows Recent first with a history icon, preserves recency, and avoids duplicate provider rows', async () => {
    renderPicker({ recentModels: [remote, anthropic] });
    await fireEvent.click(screen.getByRole('button', { name: 'Select model' }));

    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    const headings = dialog.querySelectorAll('.delegate-model-picker-group-title');
    expect(headings[0]).toHaveTextContent('Recent');
    expect(headings[0].firstElementChild).toHaveClass('lucide-history');
    expect(headings[0].firstElementChild).toHaveAttribute('width', '12');
    expect(headings[0]).toHaveStyle({ display: 'flex', alignItems: 'center' });
    const recentSection = headings[0].closest('section')!;
    expect(within(recentSection).getAllByRole('button').map((row) => row.textContent)).toEqual([
      expect.stringContaining('grok-4.7'),
      expect.stringContaining('Claude Sonnet 4')
    ]);
    expect(dialog.querySelectorAll('.delegate-model-choice')).toHaveLength(3);
    expect(headings).toHaveLength(2);
    expect(headings[1]).toHaveTextContent('my-gateway');
  });

  it('keeps local and mesh identities distinct and ignores unavailable or duplicate recent entries', async () => {
    const local: ModelEntry = { ...remote, node_id: undefined, node_label: undefined };
    const unavailable: ModelEntry = { ...remote, node_id: 'offline-node' };
    const onSelect = vi.fn();
    renderPicker({
      modelOptions: [local, remote],
      recentModels: [unavailable, remote, remote],
      selectedModelId: getModelSelectionKey(remote),
      onSelect
    });
    await fireEvent.click(screen.getByRole('button', { name: 'grok-4.7 from xai on Build server' }));

    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    const recentSection = within(dialog).getByText('Recent').closest('section')!;
    const recentRow = within(recentSection).getByRole('button');
    expect(recentRow).toHaveAttribute('aria-pressed', 'true');
    expect(within(recentRow).getByLabelText('Mesh node Build server')).toBeInTheDocument();
    const localSection = within(dialog).getByText('xai', { selector: '.delegate-model-picker-group-title > span' }).closest('section')!;
    expect(within(localSection).getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    expect(dialog.querySelectorAll('.delegate-model-choice')).toHaveLength(2);

    await fireEvent.click(recentRow);
    expect(onSelect).toHaveBeenCalledWith(getModelSelectionKey(remote));
  });

  it('searches recent models by family and modality and hides Recent when nothing in it matches', async () => {
    const familyModel: ModelEntry = { ...remote, family: 'nebula' };
    renderPicker({
      modelOptions: [anthropic, custom, familyModel],
      recentModels: [familyModel],
      modelInfo: {
        [getModelSelectionKey(familyModel)]: { capabilities: { modalities: { input: ['text', 'image'], output: ['text'] } } }
      }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Select model' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    const search = within(dialog).getByPlaceholderText('Search models, providers, nodes…');

    await fireEvent.input(search, { target: { value: 'nebula' } });
    expect(within(dialog).getByText('Recent')).toBeInTheDocument();
    expect(dialog.querySelectorAll('.delegate-model-choice')).toHaveLength(1);
    await fireEvent.input(search, { target: { value: 'image' } });
    expect(within(dialog).getByText('Recent')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /grok-4.7/ })).toBeInTheDocument();
    expect(dialog.querySelectorAll('.delegate-model-choice')).toHaveLength(1);
    await fireEvent.input(search, { target: { value: 'gateway' } });
    expect(within(dialog).queryByText('Recent')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Gateway model/ })).toBeInTheDocument();
    await fireEvent.input(search, { target: { value: 'no-such-model-xyz' } });
    expect(dialog.querySelectorAll('.delegate-model-choice')).toHaveLength(0);
    expect(within(dialog).getByText(/No models match/)).toBeInTheDocument();
  });

  it('uses visual row order for keyboard navigation across Recent and provider sections', async () => {
    const onSelect = vi.fn();
    renderPicker({ recentModels: [remote], onSelect });
    await fireEvent.click(screen.getByRole('button', { name: 'Select model' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    const search = within(dialog).getByPlaceholderText('Search models, providers, nodes…');
    const rows = dialog.querySelectorAll('.delegate-model-choice');
    expect(rows[0]).toHaveTextContent('grok-4.7');
    expect(rows[0]).toHaveClass('delegate-model-choice-highlighted');
    expect(Array.from(rows, (row) => row.getAttribute('data-model-index'))).toEqual(['0', '1', '2']);

    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(rows[1]).toHaveClass('delegate-model-choice-highlighted');
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(anthropic.id);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not show an empty Recent section when no history is available', async () => {
    renderPicker({ recentModels: [] });
    await fireEvent.click(screen.getByRole('button', { name: 'Select model' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    expect(within(dialog).queryByText('Recent')).not.toBeInTheDocument();
    expect(dialog.querySelectorAll('.delegate-model-choice')).toHaveLength(3);
  });
});

describe('ModelQuickPicker dialog', () => {
  it('closes with Done without changing the selection and restores trigger focus', async () => {
    const onSelect = vi.fn();
    renderPicker({ selectedModelId: anthropic.id, onSelect });
    const trigger = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic' });

    await fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog', { name: 'Switch model' })).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('refreshes from the search bar and disables refresh while loading', async () => {
    const onRefresh = vi.fn();
    const { rerender } = renderPicker({ selectedModelId: anthropic.id, onRefresh });

    await fireEvent.click(screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    const refresh = within(dialog).getByRole('button', { name: 'Refresh models' });
    const search = within(dialog).getByPlaceholderText('Search models, providers, nodes…');
    expect(refresh.closest('.app-picker-search-shell')).toBe(search.closest('.app-picker-search-shell'));
    expect(refresh.closest('.app-picker-header')).toBeNull();
    await fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(dialog).toBeInTheDocument();

    await rerender({ loading: true });
    expect(refresh).toBeDisabled();
    expect(refresh.querySelector('.animate-spin')).not.toBeNull();
    refresh.click();
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

describe('ModelQuickPicker reasoning badge', () => {
  function reasoningControl(value = 'high'): ModelPickerReasoningControl {
    return {
      title: 'Reasoning effort',
      description: 'Adjust reasoning for the next reply',
      value,
      options: ['auto', 'low', 'medium', 'high', 'max'].map((level) => ({
        value: level, label: level[0].toUpperCase() + level.slice(1)
      })),
      ariaLabel: 'Reasoning effort',
      onChange: vi.fn()
    };
  }

  it.each(['auto', 'low', 'medium', 'high', 'max'])('shows the supported %s label with its level-specific palette hook', (level) => {
    renderPicker({ selectedModelId: anthropic.id, reasoning: reasoningControl(level) });
    const label = level[0].toUpperCase() + level.slice(1);
    const button = screen.getByRole('button', { name: `Claude Sonnet 4 from anthropic; reasoning effort: ${label}` });
    const badge = button.querySelector('.composer-reasoning-badge');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('data-level', level);
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveClass('composer-model-pill-with-reasoning');
    expect(button.querySelector('use')).toHaveAttribute('href', '#querymt-provider-anthropic');
    expect(within(button).queryByRole('button')).toBeNull();
  });

  it('uses the actual option label, including unfamiliar reasoning levels', () => {
    const reasoning = { ...reasoningControl('adaptive'), options: [{ value: 'adaptive', label: 'Adaptive' }] };
    renderPicker({ selectedModelId: anthropic.id, reasoning });
    const badge = screen.getByText('Adaptive', { selector: '.composer-reasoning-badge' });
    expect(badge).toHaveAttribute('data-level', 'adaptive');
  });

  it('normalizes color hooks without changing backend values or the actual label', () => {
    const reasoning = { ...reasoningControl(' HIGH '), options: [{ value: ' HIGH ', label: 'High' }] };
    renderPicker({ selectedModelId: anthropic.id, reasoning });
    expect(screen.getByText('High', { selector: '.composer-reasoning-badge' })).toHaveAttribute('data-level', 'high');
    expect(reasoning.value).toBe(' HIGH ');
  });

  it('preserves long option labels in the accessible name', () => {
    const label = 'Adaptive reasoning with extended deliberation';
    const reasoning = { ...reasoningControl('adaptive'), options: [{ value: 'adaptive', label }] };
    renderPicker({ selectedModelId: anthropic.id, reasoning });
    const button = screen.getByRole('button', { name: `Claude Sonnet 4 from anthropic; reasoning effort: ${label}` });
    expect(button.querySelector('.composer-reasoning-badge')).toHaveTextContent(label);
  });

  it('does not open a disabled model picker when the attached badge is clicked', async () => {
    renderPicker({ selectedModelId: anthropic.id, reasoning: reasoningControl(), disabled: true });
    const button = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic; reasoning effort: High' });
    expect(button).toBeDisabled();
    button.click();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button.querySelector('.composer-reasoning-badge')).toHaveTextContent('High');
  });

  it('removes the badge and its accessible suffix when reasoning is no longer supported', async () => {
    const { rerender } = renderPicker({ selectedModelId: anthropic.id, reasoning: reasoningControl() });
    expect(screen.getByRole('button', { name: /reasoning effort: High/ })).toBeInTheDocument();
    await rerender({ reasoning: null });
    const button = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic' });
    expect(button.querySelector('.composer-reasoning-badge')).toBeNull();
    expect(button).not.toHaveClass('composer-model-pill-with-reasoning');
  });

  it.each([
    { reasoning: null, selectedModelId: anthropic.id },
    { reasoning: reasoningControl('unsupported'), selectedModelId: anthropic.id },
    { reasoning: { ...reasoningControl(), options: [] }, selectedModelId: anthropic.id },
    { reasoning: reasoningControl(), selectedModelId: '' },
    { reasoning: reasoningControl(), selectedModelId: 'missing/model' }
  ])('hides the badge when reasoning or the selected model cannot be resolved: %j', (props) => {
    const { container } = renderPicker(props);
    expect(container.querySelector('.composer-reasoning-badge')).toBeNull();
    expect(container.querySelector('.composer-model-pill-with-reasoning')).toBeNull();
  });

  it('updates with confirmed reasoning and opens the existing picker when the badge is clicked', async () => {
    const { rerender } = renderPicker({ selectedModelId: anthropic.id, reasoning: reasoningControl() });
    await rerender({ reasoning: reasoningControl('max') });
    const button = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic; reasoning effort: Max' });
    await fireEvent.click(within(button).getByText('Max'));
    const dialog = screen.getByRole('dialog', { name: 'Switch model' });
    expect(within(dialog).getByRole('button', { name: 'Reasoning effort' })).toHaveTextContent('Max');
    await fireEvent.keyDown(within(dialog).getByPlaceholderText('Search models, providers, nodes…'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('retains the current badge during a pending write without enabling known-provider tooltips', async () => {
    vi.useFakeTimers();
    renderPicker({ selectedModelId: anthropic.id, reasoning: { ...reasoningControl(), pending: true }, loading: true });
    const button = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic; reasoning effort: High' });
    expect(button.querySelector('.composer-reasoning-badge')).toHaveTextContent('High');
    await fireEvent.pointerEnter(button);
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.app-tooltip-content')).toBeNull();
  });
});

describe('ModelQuickPicker trigger', () => {
  it('keeps the robot icon only while no model is selected', () => {
    renderPicker();

    const button = screen.getByRole('button', { name: 'Select model' });
    expect(button.querySelector('.lucide-bot')).not.toBeNull();
    expect(button.querySelector('.composer-provider-icon')).toBeNull();
    expect(button).not.toHaveAttribute('aria-label');
  });

  it('replaces the robot with the provider mark without showing a tooltip', async () => {
    vi.useFakeTimers();
    renderPicker({ selectedModelId: anthropic.id });

    const button = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic' });
    expect(button.querySelector('.lucide-bot')).toBeNull();
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#querymt-provider-anthropic');
    expect(button).toHaveTextContent('Claude Sonnet 4');
    expect(button).not.toHaveTextContent('anthropic');
    expect(document.getElementById('querymt-provider-sprite')?.querySelector('#querymt-provider-anthropic')).not.toBeNull();

    await fireEvent.pointerEnter(button);
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.app-tooltip-content')).toBeNull();
    await fireEvent.focus(button);
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.app-tooltip-content')).toBeNull();
  });

  it('uses the robot for a custom provider and shows the provider on the hover label', async () => {
    renderPicker({ selectedModelId: custom.id });

    const button = screen.getByRole('button', { name: 'Gateway model from my-gateway' });
    expect(button.querySelector('.lucide-bot')).not.toBeNull();
    expect(button.querySelector('.composer-provider-icon')).toBeNull();
    expect(button).not.toHaveTextContent('my-gateway');
    await fireEvent.pointerEnter(button);
    expect(await screen.findByText('Gateway model from my-gateway', { selector: '.app-tooltip-content' })).toBeInTheDocument();
  });

  it('shows the unavailable-model tooltip when using the generic icon', async () => {
    renderPicker({ selectedModelId: 'missing/model' });
    const button = screen.getByRole('button', { name: 'missing/model (unavailable)' });
    expect(button.querySelector('.lucide-bot')).not.toBeNull();
    await fireEvent.pointerEnter(button);
    expect(await screen.findByText('missing/model (unavailable)', { selector: '.app-tooltip-content' })).toBeInTheDocument();
  });

  it('hides an open fallback tooltip when switching to a matching provider icon', async () => {
    const { rerender } = renderPicker({ selectedModelId: custom.id });
    await fireEvent.pointerEnter(screen.getByRole('button', { name: 'Gateway model from my-gateway' }));
    expect(await screen.findByText('Gateway model from my-gateway', { selector: '.app-tooltip-content' })).toBeInTheDocument();

    await rerender({ selectedModelId: anthropic.id });
    expect(document.querySelector('.app-tooltip-content')).toBeNull();
    expect(screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic' })).toBeInTheDocument();
  });

  it.each([
    { selectedModelId: custom.id, loading: true, name: 'Gateway model from my-gateway' },
    { selectedModelId: undefined, loading: false, name: 'Select model' }
  ])('does not show a tooltip without a selected generic icon: %j', async ({ name, ...props }) => {
    vi.useFakeTimers();
    renderPicker(props);
    const button = screen.getByRole('button', { name });
    await fireEvent.pointerEnter(button);
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector('.app-tooltip-content')).toBeNull();
  });

  it('keeps the mesh glyph without putting the provider name back in the pill', () => {
    renderPicker({ selectedModelId: getModelSelectionKey(remote) });

    const button = screen.getByRole('button', { name: 'grok-4.7 from xai on Build server' });
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#querymt-provider-xai');
    expect(button.querySelector('.lucide-network')).not.toBeNull();
    expect(button).not.toHaveTextContent('xai');
    expect(button).not.toHaveTextContent('Build server');
  });
});
