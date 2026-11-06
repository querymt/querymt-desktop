import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthFlowKind } from '$lib/querymt/querymt-extensions';

const store = vi.hoisted(() => ({
  startProviderSignIn: vi.fn(),
  completeProviderSignIn: vi.fn(),
  refreshAuthProviders: vi.fn()
}));
vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore: store }));
vi.mock('$native', () => ({ openExternalUrl: vi.fn(async () => {}) }));

import { OAuthSignInFlow } from './oauth-sign-in.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  store.startProviderSignIn.mockResolvedValue({
    flow_id: 'f1', provider: 'mcp:linear', flow_kind: OAuthFlowKind.RedirectCode, authorization_url: 'https://auth/x'
  });
});

describe('OAuthSignInFlow', () => {
  it('closes and reports the id once polling sees the login connected', async () => {
    store.refreshAuthProviders.mockResolvedValue([{ provider: 'mcp:linear', oauth_status: 'connected' }]);
    const onConnected = vi.fn();
    const flow = new OAuthSignInFlow(onConnected);

    await flow.start('agent-1', 'mcp:linear', 'linear');

    expect(store.startProviderSignIn).toHaveBeenCalledWith('agent-1', 'mcp:linear');
    expect(onConnected).toHaveBeenCalledWith('mcp:linear');
    expect(flow.open).toBe(false);
    expect(flow.error).toBeNull();
  });

  it('completes with a pasted callback', async () => {
    store.refreshAuthProviders.mockResolvedValue([]);
    store.completeProviderSignIn.mockResolvedValue({ success: true, provider: 'mcp:linear' });
    const onConnected = vi.fn();
    const flow = new OAuthSignInFlow(onConnected);

    const started = flow.start('agent-1', 'mcp:linear', 'linear');
    await vi.waitFor(() => expect(flow.authorizationUrl).toBe('https://auth/x'));
    expect(flow.open).toBe(true);
    expect(flow.submitDisabled).toBe(true);
    flow.needsCallbackInput = true;
    flow.value = 'http://127.0.0.1:47821/callback?code=abc&state=s';
    await flow.submit();

    expect(store.completeProviderSignIn).toHaveBeenCalledWith('agent-1', 'f1', 'http://127.0.0.1:47821/callback?code=abc&state=s');
    expect(onConnected).toHaveBeenCalledWith('mcp:linear');
    await started;
  });

  it('records the error and closes when the flow cannot start', async () => {
    store.startProviderSignIn.mockRejectedValue(new Error('unknown OAuth MCP server: nope'));
    const flow = new OAuthSignInFlow();
    await flow.start('agent-1', 'mcp:nope', 'nope');
    expect(flow.open).toBe(false);
    expect(flow.error).toBe('unknown OAuth MCP server: nope');
  });

  it('cancel stops polling without reporting a connection', async () => {
    store.refreshAuthProviders.mockResolvedValue([]);
    const onConnected = vi.fn();
    const flow = new OAuthSignInFlow(onConnected);
    const started = flow.start('agent-1', 'mcp:linear', 'linear');
    await vi.waitFor(() => expect(store.refreshAuthProviders).toHaveBeenCalled());
    flow.cancel();
    await started;
    expect(flow.open).toBe(false);
    expect(onConnected).not.toHaveBeenCalled();
  });
});
