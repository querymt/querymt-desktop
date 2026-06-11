import { describe, expect, it } from 'vitest';
import { normalizeQuerymtModelsResponse, toAcpExtensionMethod } from './querymt-extensions';

const model = {
  id: 'anthropic/claude-sonnet-4',
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  label: 'Claude Sonnet 4'
};

describe('toAcpExtensionMethod', () => {
  it('uses the desktop ACP extension method prefix', () => {
    expect(toAcpExtensionMethod('querymt/models')).toBe('_querymt/models');
  });
});

describe('normalizeQuerymtModelsResponse', () => {
  it('supports direct model responses', () => {
    expect(normalizeQuerymtModelsResponse({ models: [model] }).models).toEqual([model]);
  });

  it('supports wrapped all_models_list responses', () => {
    expect(
      normalizeQuerymtModelsResponse({
        type: 'all_models_list',
        data: { models: [model] }
      }).models
    ).toEqual([model]);
  });
});
