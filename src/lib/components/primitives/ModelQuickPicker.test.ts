import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ModelQuickPicker from './ModelQuickPicker.svelte';
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
});

function renderPicker(props: Record<string, unknown> = {}) {
  return render(ModelQuickPicker, {
    modelOptions: [anthropic, custom, remote],
    onSelect: () => {},
    ...props
  });
}

describe('ModelQuickPicker trigger', () => {
  it('keeps the robot icon only while no model is selected', () => {
    renderPicker();

    const button = screen.getByRole('button', { name: 'Select model' });
    expect(button.querySelector('.lucide-bot')).not.toBeNull();
    expect(button.querySelector('.composer-provider-icon')).toBeNull();
    expect(button).not.toHaveAttribute('aria-label');
  });

  it('replaces the robot with the provider mark and hides the provider name', async () => {
    renderPicker({ selectedModelId: anthropic.id });

    const button = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic' });
    expect(button.querySelector('.lucide-bot')).toBeNull();
    expect(button.querySelector('use')?.getAttribute('href')).toBe('#querymt-provider-anthropic');
    expect(button).toHaveTextContent('Claude Sonnet 4');
    expect(button).not.toHaveTextContent('anthropic');
    expect(document.getElementById('querymt-provider-sprite')?.querySelector('#querymt-provider-anthropic')).not.toBeNull();

    await fireEvent.pointerEnter(button);
    expect(await screen.findByText('Claude Sonnet 4 from anthropic', { selector: '.app-tooltip-content' })).toBeInTheDocument();
  });

  it('uses the robot for a custom provider and keeps the provider on the hover label', () => {
    renderPicker({ selectedModelId: custom.id });

    const button = screen.getByRole('button', { name: 'Gateway model from my-gateway' });
    expect(button.querySelector('.lucide-bot')).not.toBeNull();
    expect(button.querySelector('.composer-provider-icon')).toBeNull();
    expect(button).not.toHaveTextContent('my-gateway');
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
