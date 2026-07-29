import { AuthMethod, OAuthStatus, type AuthProviderEntry } from '$lib/querymt/generated/types';

export type ProviderConnectionState = 'attention' | 'setup' | 'connected';
export type ProviderPrimaryAction = 'reconnect' | 'setup' | 'manage';

export function hasUsableProviderCredential(provider: AuthProviderEntry): boolean {
  return provider.oauth_status === OAuthStatus.Connected || provider.has_stored_api_key || provider.has_env_api_key;
}

export function providerConnectionState(provider: AuthProviderEntry): ProviderConnectionState {
  if (hasUsableProviderCredential(provider)) return 'connected';
  if (provider.oauth_status === OAuthStatus.Expired) return 'attention';
  return 'setup';
}

export function providerConnectionSummary(provider: AuthProviderEntry): string {
  if (provider.oauth_status === OAuthStatus.Connected) return 'Connected with OAuth';
  if (provider.has_stored_api_key) return 'Using a key stored in Desktop';
  if (provider.has_env_api_key) return provider.env_var_name ? `Using ${provider.env_var_name}` : 'Using an environment key';
  if (provider.oauth_status === OAuthStatus.Expired) return 'OAuth connection expired';
  if (provider.preferred_method === AuthMethod.EnvVar && provider.env_var_name) return `Set ${provider.env_var_name} to connect`;
  return 'Authentication required';
}

export function providerPrimaryAction(provider: AuthProviderEntry): ProviderPrimaryAction {
  const state = providerConnectionState(provider);
  if (state === 'attention' && provider.supports_oauth) return 'reconnect';
  if (state === 'setup') return 'setup';
  return 'manage';
}

export function sortProvidersByAction(entries: AuthProviderEntry[]): AuthProviderEntry[] {
  const rank: Record<ProviderConnectionState, number> = { attention: 0, setup: 1, connected: 2 };
  return [...entries].sort((left, right) => {
    const stateDifference = rank[providerConnectionState(left)] - rank[providerConnectionState(right)];
    return stateDifference || left.display_name.localeCompare(right.display_name);
  });
}

export function providerAuthMethodOptions(provider: AuthProviderEntry): Array<{ value: AuthMethod | 'auto'; label: string }> {
  const options: Array<{ value: AuthMethod | 'auto'; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: AuthMethod.ApiKey, label: 'API key' }
  ];
  if (provider.supports_oauth) options.push({ value: AuthMethod.OAuth, label: 'OAuth' });
  if (provider.env_var_name) options.push({ value: AuthMethod.EnvVar, label: 'Env var' });
  return options;
}
