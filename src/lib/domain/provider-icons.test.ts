import { describe, expect, it } from 'vitest';
import { modelSelectionTooltip, providerIconHref, providerIconId } from './provider-icons';

describe('providerIconId', () => {
  it('maps built-in provider ids onto sprite symbols, including renamed crates', () => {
    expect(providerIconId('xai')).toBe('xai');
    expect(providerIconId('Anthropic')).toBe('anthropic');
    expect(providerIconId('kimi-code')).toBe('kimi');
    expect(providerIconId('mrs')).toBe('mistral-rs');
    expect(providerIconId('llama.cpp')).toBe('llama-cpp');
  });

  it('does not invent an icon for a custom provider name', () => {
    expect(providerIconId('my-gateway')).toBeNull();
    expect(providerIconId('')).toBeNull();
    expect(providerIconId(null)).toBeNull();
  });

  it('describes the selected model and provider without needing a visible suffix', () => {
    expect(modelSelectionTooltip({ model: 'grok-4.7', provider: 'xai', label: 'grok-4.7' })).toBe('grok-4.7 from xai');
    expect(
      modelSelectionTooltip(
        { model: 'grok-4.6', provider: 'xai', label: 'Grok 4.6', node_label: 'Build server' },
        'Quorum'
      )
    ).toBe('Grok 4.6 from xai on Build server · Quorum');
    expect(providerIconHref('xai')).toBe('#querymt-provider-xai');
  });
});
