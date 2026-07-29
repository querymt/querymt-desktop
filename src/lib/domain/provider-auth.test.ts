import { describe, expect, it } from 'vitest';
import {
  QMT_METHOD_AUTH_CLEAR_API_TOKEN,
  QMT_METHOD_AUTH_SET_API_TOKEN,
  QMT_METHOD_AUTH_SET_METHOD
} from '$lib/querymt/querymt-extensions';
import { AuthMethod, OAuthStatus, type AuthProviderEntry, type CapabilitiesInfo } from '$lib/querymt/generated/types';
import {
  NO_PROVIDER_AUTH_CAPABILITIES,
  canEditAuthMethod,
  canShowClearApiKey,
  canShowSetApiKey,
  providerAuthCapabilitiesFromAgent,
  providerConnectionState,
  providerConnectionSummary,
  providerPrimaryAction,
  providerSupportsApiKey,
  sortProvidersByAction
} from './provider-auth';

function provider(overrides: Partial<AuthProviderEntry> = {}): AuthProviderEntry {
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

function capabilities(methods: string[]): CapabilitiesInfo {
  return {
    querymt_control_version: 1,
    methods,
    features: { models: true, mesh: false, schedules: false, auth: true }
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

describe('provider auth capability gating', () => {
  it('maps agent capability methods to provider control flags', () => {
    expect(providerAuthCapabilitiesFromAgent(null)).toEqual(NO_PROVIDER_AUTH_CAPABILITIES);
    expect(
      providerAuthCapabilitiesFromAgent(
        capabilities([QMT_METHOD_AUTH_SET_API_TOKEN, QMT_METHOD_AUTH_CLEAR_API_TOKEN, QMT_METHOD_AUTH_SET_METHOD])
      )
    ).toEqual({
      canSetApiToken: true,
      canClearApiToken: true,
      canSetAuthMethod: true
    });
    expect(providerAuthCapabilitiesFromAgent(capabilities([QMT_METHOD_AUTH_SET_API_TOKEN]))).toEqual({
      canSetApiToken: true,
      canClearApiToken: false,
      canSetAuthMethod: false
    });
  });

  it('requires a provider env var name for API-key actions', () => {
    expect(providerSupportsApiKey(provider())).toBe(true);
    expect(providerSupportsApiKey(provider({ env_var_name: undefined }))).toBe(false);
    expect(canShowSetApiKey(provider({ env_var_name: undefined }))).toBe(false);
    expect(canShowClearApiKey(provider({ has_stored_api_key: true, env_var_name: undefined }))).toBe(false);
  });

  it('gates set/clear/method controls by agent methods and provider state', () => {
    const full = providerAuthCapabilitiesFromAgent(
      capabilities([QMT_METHOD_AUTH_SET_API_TOKEN, QMT_METHOD_AUTH_CLEAR_API_TOKEN, QMT_METHOD_AUTH_SET_METHOD])
    );
    const oauthOnly = NO_PROVIDER_AUTH_CAPABILITIES;

    expect(canShowSetApiKey(provider(), full)).toBe(true);
    expect(canShowSetApiKey(provider(), oauthOnly)).toBe(false);
    expect(canShowClearApiKey(provider({ has_stored_api_key: true }), full)).toBe(true);
    expect(canShowClearApiKey(provider({ has_stored_api_key: false }), full)).toBe(false);
    expect(canShowClearApiKey(provider({ has_stored_api_key: true }), oauthOnly)).toBe(false);
    expect(canEditAuthMethod(full)).toBe(true);
    expect(canEditAuthMethod(oauthOnly)).toBe(false);
  });
});
