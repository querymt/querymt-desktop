import { open } from '@tauri-apps/plugin-shell';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../+page.svelte';

const agentsStore = vi.hoisted(() => ({
  configs: [{ id: 'agent-1', name: 'QMTCODE' }],
  controlCapabilitiesByAgent: {
    'agent-1': {
      querymt_control_version: 1,
      methods: [],
      features: { models: true, mesh: false, schedules: false, auth: true }
    }
  },
  authProvidersByAgent: {
    'agent-1': [
      {
        provider: 'anthropic',
        display_name: 'Anthropic',
        oauth_status: 'not_authenticated',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: true,
        preferred_method: 'api_key'
      }
    ]
  },
  authLoadingByAgent: { 'agent-1': false },
  authErrorsByAgent: { 'agent-1': null },
  modelLoadingByAgent: { 'agent-1': false },
  pluginUpdateStatusByAgent: { 'agent-1': null as null | {
    plugin_name: string;
    image_reference: string;
    phase: string;
    bytes_downloaded: number;
    bytes_total?: number;
    percent?: number;
    message?: string;
  } },
  lastPluginUpdateByAgent: { 'agent-1': null },
  refreshAuthProviders: vi.fn(async () => []),
  refreshModelsForAgent: vi.fn(async () => []),
  updatePluginsForAgent: vi.fn(async () => []),
  startProviderSignIn: vi.fn(async () => ({
    flow_id: 'flow-1',
    provider: 'anthropic',
    flow_kind: 'device_poll'
  })),
  completeProviderSignIn: vi.fn(async () => ({ success: true, message: 'signed in' })),
  disconnectProvider: vi.fn(async () => ({ success: true })),
  setProviderApiToken: vi.fn(async () => ({ success: true })),
  clearProviderApiToken: vi.fn(async () => ({ success: true })),
  setProviderAuthMethod: vi.fn(async () => ({ success: true })),
  refreshManagedProfiles: vi.fn(async () => {})
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(async () => {})
}));

vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));

vi.mock('$lib/stores/appearance.svelte', () => ({
  appearanceStore: {
    themeMode: 'system',
    resolvedTheme: 'light',
    initialized: true,
    initialize: vi.fn(),
    setThemeMode: vi.fn()
  }
}));

Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn(async () => {})
  },
  configurable: true
});

vi.mock('$lib/stores/window-decorations.svelte', () => ({
  windowDecorationsStore: {
    mode: 'os',
    supported: true,
    initialized: true,
    error: null,
    initialize: vi.fn(async () => {}),
    toggleCustomTitlebar: vi.fn(async () => {})
  }
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  agentsStore.authProvidersByAgent['agent-1'] = [
    {
      provider: 'anthropic',
      display_name: 'Anthropic',
      oauth_status: 'not_authenticated',
      has_stored_api_key: false,
      has_env_api_key: false,
      supports_oauth: true,
      preferred_method: 'api_key'
    }
  ];
  agentsStore.pluginUpdateStatusByAgent['agent-1'] = null;
  agentsStore.refreshAuthProviders = vi.fn(async () => []);
  agentsStore.startProviderSignIn = vi.fn(async () => ({
    flow_id: 'flow-1',
    provider: 'anthropic',
    flow_kind: 'device_poll'
  }));
});

describe('Settings provider controls', () => {
  it('keeps API key entry interactive and saves through the store', async () => {
    render(SettingsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Set API key' }));
    const input = screen.getByPlaceholderText('Paste API key');
    await fireEvent.input(input, { target: { value: 'sk-test' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(agentsStore.setProviderApiToken).toHaveBeenCalledWith('agent-1', 'anthropic', 'sk-test');
  });

  it('checks device-poll OAuth completion without pasted input', async () => {
    agentsStore.startProviderSignIn = vi.fn(async () => ({
      flow_id: 'flow-1',
      provider: 'anthropic',
      authorization_url: 'https://example.com/device',
      flow_kind: 'device_poll'
    }));

    render(SettingsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.queryByPlaceholderText('https://... or pasted code')).not.toBeInTheDocument();
    expect(screen.getByText(/Open or copy the device authorization URL/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Authorization URL' })).toHaveValue('https://example.com/device');

    await fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/device');

    await fireEvent.click(screen.getByRole('button', { name: 'Check authentication' }));

    expect(agentsStore.startProviderSignIn).toHaveBeenCalledWith('agent-1', 'anthropic');
    expect(agentsStore.completeProviderSignIn).toHaveBeenCalledWith('agent-1', 'flow-1', '');
  });

  it('requires pasted input for manual redirect OAuth completion', async () => {
    agentsStore.startProviderSignIn = vi.fn(async () => ({
      flow_id: 'flow-manual',
      provider: 'anthropic',
      flow_kind: 'redirect_code'
    }));

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const completeButton = screen.getByRole('button', { name: 'Complete sign-in' });
    expect(completeButton).toBeDisabled();

    const textarea = screen.getByPlaceholderText('https://... or pasted code');
    await fireEvent.input(textarea, { target: { value: 'https://localhost/callback?code=abc' } });
    await fireEvent.click(completeButton);

    expect(agentsStore.completeProviderSignIn).toHaveBeenCalledWith(
      'agent-1',
      'flow-manual',
      'https://localhost/callback?code=abc'
    );
  });

  it('opens browser and allows manual completion during redirect OAuth polling', async () => {
    agentsStore.startProviderSignIn = vi.fn(async () => ({
      flow_id: 'flow-2',
      provider: 'anthropic',
      authorization_url: 'https://example.com/oauth',
      flow_kind: 'redirect_code'
    }));
    agentsStore.refreshAuthProviders = vi.fn(async () => [
      { provider: 'anthropic', oauth_status: 'not_authenticated', supports_oauth: true }
    ]) as any;

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(open).not.toHaveBeenCalled();
    await fireEvent.click(await screen.findByRole('button', { name: 'Open in browser' }));
    expect(open).toHaveBeenCalledWith('https://example.com/oauth');

    const textarea = screen.getByPlaceholderText('https://... or pasted code');
    await fireEvent.input(textarea, { target: { value: 'manual-code' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Complete sign-in' }));

    expect(agentsStore.completeProviderSignIn).toHaveBeenCalledWith('agent-1', 'flow-2', 'manual-code');
  });

  it('allows cancelling an in-progress redirect OAuth wait', async () => {
    agentsStore.authProvidersByAgent['agent-1'] = [
      {
        provider: 'anthropic',
        display_name: 'Anthropic',
        oauth_status: 'not_authenticated',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: true,
        preferred_method: 'oauth'
      },
      {
        provider: 'google',
        display_name: 'Google',
        oauth_status: null as any,
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: false,
        preferred_method: 'api_key'
      }
    ];
    agentsStore.startProviderSignIn = vi.fn(async () => ({
      flow_id: 'flow-3',
      provider: 'anthropic',
      authorization_url: 'https://example.com/oauth',
      flow_kind: 'redirect_code'
    }));
    agentsStore.refreshAuthProviders = vi.fn(async () => [
      { provider: 'anthropic', oauth_status: 'not_authenticated', supports_oauth: true }
    ]) as any;

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const cancelButtons = await screen.findAllByRole('button', { name: 'Cancel sign-in' });
    expect(cancelButtons[0]).toBeEnabled();
    expect(cancelButtons[1]).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Signing in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set API key' })).toBeDisabled();

    await fireEvent.click(cancelButtons[1]);

    expect(await screen.findByText('Cancelled sign-in for Anthropic.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('renders live plugin update progress without blocking controls', async () => {
    agentsStore.pluginUpdateStatusByAgent['agent-1'] = {
      plugin_name: 'anthropic',
      image_reference: 'registry.example/anthropic:latest',
      phase: 'pulling',
      bytes_downloaded: 5,
      bytes_total: 10,
      percent: 50,
      message: 'Downloading layers'
    };

    render(SettingsPage);

    expect(screen.getByText('Plugin update in progress')).toBeInTheDocument();
    expect(screen.getByText('anthropic - pulling')).toBeInTheDocument();
    expect(screen.getByText('50% complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set API key' })).toBeEnabled();
  });
});
