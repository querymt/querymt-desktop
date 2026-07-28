import { describe, expect, it } from 'vitest';
import { AuthMethod, OAuthStatus, type AuthProviderEntry } from '$lib/querymt/generated/types';
import { providerConnectionState, providerConnectionSummary, providerPrimaryAction, sortProvidersByAction } from './provider-auth';

function provider(overrides: Partial<AuthProviderEntry> = {}): AuthProviderEntry {
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

describe('provider auth presentation', () => {
  it('classifies usable credentials before expired OAuth', () => {
    expect(providerConnectionState(provider({ oauth_status: OAuthStatus.Expired, has_stored_api_key: true }))).toBe('connected');
    expect(providerConnectionState(provider({ oauth_status: OAuthStatus.Expired }))).toBe('attention');
    expect(providerConnectionState(provider())).toBe('setup');
  });

  it('describes the active credential source', () => {
    expect(providerConnectionSummary(provider({ oauth_status: OAuthStatus.Connected }))).toBe('Connected with OAuth');
    expect(providerConnectionSummary(provider({ has_stored_api_key: true }))).toBe('Using a key stored in Desktop');
    expect(providerConnectionSummary(provider({ has_env_api_key: true, env_var_name: 'ANTHROPIC_API_KEY' }))).toBe('Using ANTHROPIC_API_KEY');
    expect(providerConnectionSummary(provider({ oauth_status: OAuthStatus.Expired }))).toBe('OAuth connection expired');
  });

  it('selects one primary action from connection state', () => {
    expect(providerPrimaryAction(provider({ oauth_status: OAuthStatus.Expired }))).toBe('reconnect');
    expect(providerPrimaryAction(provider())).toBe('setup');
    expect(providerPrimaryAction(provider({ has_stored_api_key: true }))).toBe('manage');
  });

  it('sorts attention and setup before connected providers', () => {
    const sorted = sortProvidersByAction([
      provider({ provider: 'connected', display_name: 'Connected', has_stored_api_key: true }),
      provider({ provider: 'setup', display_name: 'Setup' }),
      provider({ provider: 'attention', display_name: 'Attention', oauth_status: OAuthStatus.Expired })
    ]);
    expect(sorted.map((entry) => entry.provider)).toEqual(['attention', 'setup', 'connected']);
  });
});
