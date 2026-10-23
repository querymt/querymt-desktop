import { describe, expect, it } from 'vitest';
import type { ModelEntry } from '$lib/domain/types';
import { findModelByIdentity, findModelBySelectionKey, getModelSelectionKey, resolveSessionModelKey, modelNodeLabel } from './config-options';

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
  it('resolves the same physical provider from either viewer without confusing identical models', () => {
    const identity = { provider: localModel.provider, model: localModel.model, providerNodeId: 'A' };
    const onA = [localModel, { ...remoteModel, node_id: 'B' }];
    const onB = [localModel, { ...remoteModel, node_id: 'A' }];
    expect(resolveSessionModelKey(onA, identity, { servingNodeId: 'A', ownerNodeId: 'B' })).toBe(localModel.id);
    expect(resolveSessionModelKey(onB, identity, { servingNodeId: 'B', ownerNodeId: 'B' })).toBe(getModelSelectionKey(onB[1]));
    expect(resolveSessionModelKey(onA, { ...identity, providerNodeId: null }, { servingNodeId: 'A', ownerNodeId: 'B' })).toBe(getModelSelectionKey(onA[1]));
    expect(resolveSessionModelKey([localModel], { ...identity, providerNodeId: null }, { servingNodeId: 'A', ownerNodeId: 'B' })).not.toBe(localModel.id);
  });

  it('presents locality relative to the session without rewriting provider identity', () => {
    const location = { servingNodeId: 'A', ownerNodeId: 'node-1', servingNodeLabel: 'Machine A' };
    expect(modelNodeLabel(remoteModel, location)).toBeNull();
    expect(modelNodeLabel(localModel, location)).toBe('Machine A');
    expect(remoteModel.node_id).toBe('node-1');
  });
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
