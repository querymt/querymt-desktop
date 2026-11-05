import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpServerList from './McpServerList.svelte';
import { AuthMethod, OAuthStatus, type AuthProviderStatus } from '$lib/querymt/generated/types';

function server(name: string, connected: boolean): AuthProviderStatus {
  return {
    provider: `mcp:${name}`,
    display_name: `MCP: ${name}`,
    oauth_status: connected ? OAuthStatus.Connected : OAuthStatus.NotAuthenticated,
    has_stored_api_key: false,
    has_env_api_key: false,
    supports_oauth: true,
    preferred_method: undefined as unknown as AuthMethod
  };
}

const handlers = () => ({
  onSignIn: vi.fn(),
  onCancelSignIn: vi.fn(),
  onDisconnect: vi.fn(),
  onDialogTrigger: vi.fn()
});

afterEach(() => cleanup());

describe('McpServerList', () => {
  it('lists servers needing sign-in first, by server name, with no provider controls', () => {
    render(McpServerList, { servers: [server('zeta', true), server('linear', false)], ...handlers() });

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['linear', 'zeta']);
    expect(screen.getByText('Sign-in required')).toBeInTheDocument();
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(screen.queryByText(/API key|Authentication method|Provider ID/)).not.toBeInTheDocument();
  });

  it('signs in and out through the given handlers', async () => {
    const h = handlers();
    const linear = server('linear', false);
    const zeta = server('zeta', true);
    render(McpServerList, { servers: [linear, zeta], ...h });

    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(h.onSignIn).toHaveBeenCalledWith(linear);
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(h.onDisconnect).toHaveBeenCalledWith(zeta);
    expect(h.onDialogTrigger).toHaveBeenCalledTimes(2);
  });

  it('shows a cancellable signing-in state for the pending server only', async () => {
    const h = handlers();
    render(McpServerList, {
      servers: [server('linear', false), server('other', false)],
      pendingAction: { provider: 'mcp:linear', action: 'oauth' },
      ...h
    });
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    expect(h.onCancelSignIn).toHaveBeenCalledOnce();
  });
});
