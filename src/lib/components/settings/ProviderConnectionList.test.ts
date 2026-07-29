import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProviderConnectionList from './ProviderConnectionList.svelte';
import { AuthMethod, OAuthStatus, type AuthProviderEntry } from '$lib/querymt/generated/types';

function provider(overrides: Partial<AuthProviderEntry>): AuthProviderEntry {
  return {
    provider: 'anthropic',
    display_name: 'Anthropic',
    oauth_status: OAuthStatus.NotAuthenticated,
    has_stored_api_key: false,
    has_env_api_key: false,
    supports_oauth: true,
    preferred_method: AuthMethod.ApiKey,
    ...overrides
  };
}

const handlers = {
  onSignIn: vi.fn(),
  onCancelSignIn: vi.fn(),
  onDisconnect: vi.fn(),
  onSetApiKey: vi.fn(),
  onClearApiKey: vi.fn(),
  onAuthMethodChange: vi.fn(),
  onDialogTrigger: vi.fn()
};

afterEach(() => cleanup());

describe('ProviderConnectionList', () => {
  it('orders actionable providers first and exposes one primary action', () => {
    render(ProviderConnectionList, {
      providers: [
        provider({ provider: 'connected', display_name: 'Connected', has_stored_api_key: true }),
        provider({ provider: 'setup', display_name: 'Setup' }),
        provider({ provider: 'attention', display_name: 'Attention', oauth_status: OAuthStatus.Expired })
      ],
      ...handlers
    });

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Attention', 'Setup', 'Connected']);
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set API key' })).not.toBeInTheDocument();
  });

  it('reveals credential controls and technical details on request', async () => {
    render(ProviderConnectionList, {
      providers: [provider({ env_var_name: 'ANTHROPIC_API_KEY' })],
      ...handlers
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));

    expect(screen.getByLabelText('Authentication method for Anthropic')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with OAuth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set API key' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Authentication method for Anthropic')).not.toBeInTheDocument();
  });

  it('keeps pending state local to the affected provider', () => {
    render(ProviderConnectionList, {
      providers: [provider({ provider: 'anthropic' }), provider({ provider: 'google', display_name: 'Google', supports_oauth: false })],
      pendingAction: { provider: 'anthropic', action: 'oauth' },
      ...handlers
    });

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set up' })).toBeEnabled();
  });
});
