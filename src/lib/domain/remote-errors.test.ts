import { RequestError } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import {
  RemoteNodeUpgradeRequiredError,
  mapRemoteUpgradeRequired,
  toRemoteNodeUpgradeRequired
} from './remote-errors';

describe('remote upgrade-required errors', () => {
  it('maps the agent upgrade-required category to a typed error naming the node', () => {
    const raw = new RequestError(-32603, "remote node 'nas' must be upgraded: it does not support session interactions", {
      category: 'remote_upgrade_required',
      node: 'nas',
      message: "remote node 'nas' must be upgraded"
    });

    const mapped = toRemoteNodeUpgradeRequired(raw);

    expect(mapped).toBeInstanceOf(RemoteNodeUpgradeRequiredError);
    expect(mapped?.node).toBe('nas');
    expect(mapped?.message).toContain('Remote node "nas" must be upgraded');
    expect(mapped?.cause).toBe(raw);
  });

  it('leaves unrelated errors untouched', () => {
    const transport = new RequestError(-32603, 'remote transport failed', { category: 'remote_transport' });
    const plain = new Error('boom');

    expect(toRemoteNodeUpgradeRequired(transport)).toBeNull();
    expect(mapRemoteUpgradeRequired(transport)).toBe(transport);
    expect(mapRemoteUpgradeRequired(plain)).toBe(plain);
  });

  it('falls back to a generic node label when the agent omits it', () => {
    const mapped = toRemoteNodeUpgradeRequired({ data: { category: 'remote_upgrade_required' } });
    expect(mapped?.message).toContain('"unknown node"');
  });
});
