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
        preferred_method: 'oauth'
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
  setProviderAuthMethod: vi.fn(async () => ({ success: true }))
}));

vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));

Object.defineProperty(window, 'open', {
  value: vi.fn(),
  writable: true
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

  it('opens manual OAuth completion in-app for non-redirect flows', async () => {
    render(SettingsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const textarea = screen.getByPlaceholderText('https://... or pasted code');
    await fireEvent.input(textarea, { target: { value: 'device-code' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Complete sign-in' }));

    expect(agentsStore.startProviderSignIn).toHaveBeenCalledWith('agent-1', 'anthropic');
    expect(agentsStore.completeProviderSignIn).toHaveBeenCalledWith('agent-1', 'flow-1', 'device-code');
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
