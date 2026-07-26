import { describe, expect, it } from 'vitest';
import type { ModelEntry } from '$lib/domain/types';
import { findModelByIdentity, findModelBySelectionKey, getModelSelectionKey } from './config-options';

const localModel: ModelEntry = {
  id: 'anthropic/claude-sonnet-4',
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  label: 'Claude Sonnet 4'
};

const remoteModel: ModelEntry = {
  ...localModel,
  node_id: 'node-1',
  node_label: 'Build server'
};

describe('model selection identity', () => {
  it('uses the ACP model id for local models and a node-aware key for mesh models', () => {
    expect(getModelSelectionKey(localModel)).toBe(localModel.id);
    expect(getModelSelectionKey(remoteModel)).not.toBe(remoteModel.id);
    expect(getModelSelectionKey(remoteModel)).toContain('node-1');
  });

  it('resolves legacy raw ids to the local model when local and mesh entries collide', () => {
    expect(findModelBySelectionKey([remoteModel, localModel], localModel.id)).toBe(localModel);
    expect(findModelBySelectionKey([localModel, remoteModel], getModelSelectionKey(remoteModel))).toBe(remoteModel);
  });

  it('uses provider, model, and node to restore an exact mesh model', () => {
    expect(
      findModelByIdentity([localModel, remoteModel], {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        providerNodeId: 'node-1'
      })
    ).toBe(remoteModel);
    expect(
      findModelByIdentity([remoteModel, localModel], {
        provider: 'anthropic',
        model: 'claude-sonnet-4'
      })
    ).toBe(localModel);
  });
});
