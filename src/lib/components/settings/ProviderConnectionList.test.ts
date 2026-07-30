import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProviderConnectionList from './ProviderConnectionList.svelte';
import {
  FULL_PROVIDER_AUTH_CAPABILITIES,
  NO_PROVIDER_AUTH_CAPABILITIES
} from '$lib/domain/provider-auth';
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
    env_var_name: 'ANTHROPIC_API_KEY',
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

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Attention',
      'Setup',
      'Connected'
    ]);
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Manage' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Connection details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set API key' })).not.toBeInTheDocument();
  });

  it('reveals credential controls and technical details on request', async () => {
    render(ProviderConnectionList, {
      providers: [provider({ env_var_name: 'ANTHROPIC_API_KEY' })],
      authCapabilities: FULL_PROVIDER_AUTH_CAPABILITIES,
      ...handlers
    });

    const setupButton = screen.getByRole('button', { name: 'Set up' });
    await fireEvent.click(setupButton);

    expect(setupButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Authentication method for Anthropic')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with OAuth' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set API key' })).toBeInTheDocument();

    await fireEvent.click(setupButton);
    expect(setupButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Authentication method for Anthropic')).not.toBeInTheDocument();
  });

  it('hides API-key actions when the agent only advertises OAuth auth methods', async () => {
    render(ProviderConnectionList, {
      providers: [provider({ has_stored_api_key: true })],
      authCapabilities: NO_PROVIDER_AUTH_CAPABILITIES,
      ...handlers
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    expect(screen.getByRole('button', { name: 'Sign in with OAuth' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect OAuth' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace API key' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear API key' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Authentication method for Anthropic')).toBeDisabled();
  });

  it('hides API-key actions for OAuth-only providers without an env var name', async () => {
    render(ProviderConnectionList, {
      providers: [provider({ env_var_name: undefined, has_stored_api_key: true })],
      authCapabilities: FULL_PROVIDER_AUTH_CAPABILITIES,
      ...handlers
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    expect(screen.getByRole('button', { name: 'Sign in with OAuth' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace API key' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear API key' })).not.toBeInTheDocument();
  });

  it('keeps pending state local to the affected provider', () => {
    render(ProviderConnectionList, {
      providers: [
        provider({ provider: 'anthropic' }),
        provider({ provider: 'google', display_name: 'Google', supports_oauth: false })
      ],
      pendingAction: { provider: 'anthropic', action: 'oauth' },
      ...handlers
    });

    const signingInButton = screen.getByRole('button', { name: 'Signing in…' });
    const setupButton = screen.getByRole('button', { name: 'Set up' });

    expect(signingInButton).toBeDisabled();
    expect(signingInButton).toHaveClass('action-btn-compact', 'provider-connection-action');
    expect(setupButton).toBeEnabled();
    expect(setupButton).toHaveClass('action-btn-compact', 'provider-connection-action');
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toHaveClass('icon-btn-compact');
  });
});
