import { open } from '@tauri-apps/plugin-shell';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../+page.svelte';

const chatPreferencesStore = vi.hoisted(() => ({
  sendShortcut: 'enter',
  imageSendMode: 'image',
  developerMode: false,
  initialized: true,
  initialize: vi.fn(),
  setSendShortcut: vi.fn(),
  setImageSendMode: vi.fn(),
  setDeveloperMode: vi.fn()
}));

const agentsStore = vi.hoisted(() => ({
  configs: [{ id: 'agent-1', name: 'QMTCODE' }],
  controlCapabilitiesByAgent: {
    'agent-1': {
      querymt_control_version: 1,
      methods: [
        'querymt/auth/status',
        'querymt/auth/start',
        'querymt/auth/complete',
        'querymt/auth/logout',
        'querymt/auth/setApiToken',
        'querymt/auth/clearApiToken',
        'querymt/auth/setMethod'
      ],
      features: { models: true, mesh: false, schedules: false, auth: true }
    }
  } as Record<string, { querymt_control_version: number; methods: string[]; features: { models: boolean; mesh: boolean; schedules: boolean; auth: boolean } }>,
  authProvidersByAgent: {
    'agent-1': [
      {
        provider: 'anthropic',
        display_name: 'Anthropic',
        oauth_status: 'not_authenticated',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: true,
        preferred_method: 'api_key',
        env_var_name: 'ANTHROPIC_API_KEY'
      }
    ]
  },
  authLoadingByAgent: { 'agent-1': false },
  authErrorsByAgent: { 'agent-1': null },
  modelsByAgent: { 'agent-1': [{ id: 'model-1', label: 'Model 1' }, { id: 'model-2', label: 'Model 2' }] },
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

vi.mock('$lib/stores/chat-preferences.svelte', () => ({ chatPreferencesStore }));

Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn(async () => {})
  },
  configurable: true
});

const windowDecorationsStore = vi.hoisted(() => ({
  mode: 'os',
  supported: true,
  initialized: true,
  error: null,
  initialize: vi.fn(async () => {}),
  toggleCustomTitlebar: vi.fn(async () => {})
}));

vi.mock('$lib/stores/window-decorations.svelte', () => ({ windowDecorationsStore }));

beforeEach(() => {
  window.history.replaceState({}, '', '/settings');
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  agentsStore.authProvidersByAgent['agent-1'] = [
    {
      provider: 'anthropic',
      display_name: 'Anthropic',
      oauth_status: 'not_authenticated',
      has_stored_api_key: false,
      has_env_api_key: false,
      supports_oauth: true,
      preferred_method: 'api_key',
      env_var_name: 'ANTHROPIC_API_KEY'
    }
  ];
  agentsStore.pluginUpdateStatusByAgent['agent-1'] = null;
  agentsStore.lastPluginUpdateByAgent['agent-1'] = null;
  agentsStore.configs = [{ id: 'agent-1', name: 'QMTCODE' }];
  agentsStore.controlCapabilitiesByAgent = {
    'agent-1': {
      querymt_control_version: 1,
      methods: [
        'querymt/auth/status',
        'querymt/auth/start',
        'querymt/auth/complete',
        'querymt/auth/logout',
        'querymt/auth/setApiToken',
        'querymt/auth/clearApiToken',
        'querymt/auth/setMethod'
      ],
      features: { models: true, mesh: false, schedules: false, auth: true }
    }
  };
  agentsStore.refreshAuthProviders = vi.fn(async () => []);
  agentsStore.setProviderApiToken = vi.fn(async () => ({ success: true }));
  agentsStore.disconnectProvider = vi.fn(async () => ({ success: true }));
  agentsStore.clearProviderApiToken = vi.fn(async () => ({ success: true }));
  agentsStore.completeProviderSignIn = vi.fn(async () => ({ success: true, message: 'signed in' }));
  agentsStore.startProviderSignIn = vi.fn(async () => ({
    flow_id: 'flow-1',
    provider: 'anthropic',
    flow_kind: 'device_poll'
  }));
  chatPreferencesStore.sendShortcut = 'enter';
});

describe('Settings controls', () => {
  it('opens an addressable settings destination from the URL', async () => {
    window.history.replaceState({}, '', '/settings?section=profiles');
    render(SettingsPage);

    expect(await screen.findByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Profiles/ })).toHaveAttribute('aria-current', 'page');
  });

  it('updates the URL without adding history entries when switching destinations', async () => {
    render(SettingsPage);

    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));

    expect(window.location.search).toBe('?section=providers');
    expect(screen.getByRole('heading', { name: 'Providers' })).toBeInTheDocument();
  });

  it('keeps casual preferences visible and advanced window controls collapsed by default', async () => {
    render(SettingsPage);

    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Custom titlebar')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByText('Custom titlebar')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    const titlebarSwitch = screen.getByRole('switch', { name: 'Custom titlebar' });
    expect(titlebarSwitch).not.toBeChecked();

    await fireEvent.click(titlebarSwitch);
    expect(windowDecorationsStore.toggleCustomTitlebar).toHaveBeenCalledWith(true);
  });

  it('defaults to Enter and updates the send shortcut preference', async () => {
    render(SettingsPage);

    const shortcutSelect = screen.getByRole('button', { name: 'Send messages with' });
    expect(shortcutSelect).toHaveTextContent('Enter');
    expect(screen.getByText('Choose the shortcut that submits a message.')).toBeInTheDocument();

    await fireEvent.pointerDown(shortcutSelect, { button: 0, pointerType: 'mouse' });
    const shiftEnterOption = await screen.findByRole('option', { name: 'Shift+Enter' });
    await fireEvent.pointerDown(shiftEnterOption, { button: 0, pointerType: 'mouse' });
    await fireEvent.pointerUp(shiftEnterOption, { button: 0, pointerType: 'mouse' });

    expect(chatPreferencesStore.setSendShortcut).toHaveBeenCalledWith('shift-enter');
  });

  it('updates the default image attachment encoding', async () => {
    render(SettingsPage);

    await fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));

    const encodingSelect = screen.getByRole('button', { name: 'Image attachment encoding' });
    expect(encodingSelect).toHaveTextContent('Native image');

    await fireEvent.pointerDown(encodingSelect, { button: 0, pointerType: 'mouse' });
    const resourceOption = await screen.findByRole('option', { name: 'Embedded resource' });
    await fireEvent.pointerDown(resourceOption, { button: 0, pointerType: 'mouse' });
    await fireEvent.pointerUp(resourceOption, { button: 0, pointerType: 'mouse' });

    expect(chatPreferencesStore.setImageSendMode).toHaveBeenCalledWith('resource');
  });

  it('toggles developer mode from the advanced section', async () => {
    render(SettingsPage);

    await fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));

    const developerSwitch = screen.getByRole('switch', { name: 'Developer mode' });
    expect(developerSwitch).not.toBeChecked();

    await fireEvent.click(developerSwitch);
    expect(chatPreferencesStore.setDeveloperMode).toHaveBeenCalledWith(true);
  });

  it('offers Cmd+Enter on macOS', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(SettingsPage);

    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Send messages with' }), {
      button: 0,
      pointerType: 'mouse'
    });

    expect(await screen.findByRole('option', { name: 'Cmd+Enter' })).toBeInTheDocument();
  });

  it('compacts provider scope and maintenance around an authentication overview', async () => {
    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));

    expect(screen.queryByLabelText('Provider agent')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Provider overview' })).toHaveTextContent('Needs setup1');
    expect(screen.getByRole('region', { name: 'Provider overview' })).toHaveTextContent('Models2');
    expect(screen.queryByRole('heading', { name: 'Authentication' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advanced maintenance/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /Advanced maintenance/ }));
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.getByText('2 available models for the selected agent.')).toBeInTheDocument();
  });

  it('shows provider agent scope only when more than one auth agent exists', async () => {
    agentsStore.configs = [...agentsStore.configs, { id: 'agent-2', name: 'Second agent' }];
    agentsStore.controlCapabilitiesByAgent = {
      ...agentsStore.controlCapabilitiesByAgent,
      'agent-2': { querymt_control_version: 1, methods: [], features: { models: true, mesh: false, schedules: false, auth: true } }
    };

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));

    expect(screen.getByLabelText('Provider agent')).toBeInTheDocument();
  });

  it('keeps API key entry interactive and saves through the store', async () => {
    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));

    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set API key' }));
    const input = screen.getByPlaceholderText('Paste API key');
    await fireEvent.input(input, { target: { value: 'sk-test' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    expect(agentsStore.setProviderApiToken).toHaveBeenCalledWith('agent-1', 'anthropic', 'sk-test');
  });

  it('hides API key controls when the agent does not advertise token mutation methods', async () => {
    agentsStore.controlCapabilitiesByAgent = {
      'agent-1': {
        querymt_control_version: 1,
        methods: ['querymt/auth/status', 'querymt/auth/start', 'querymt/auth/complete', 'querymt/auth/logout'],
        features: { models: true, mesh: false, schedules: false, auth: true }
      }
    };

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));

    expect(screen.getByRole('button', { name: 'Sign in with OAuth' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set API key' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Authentication method for Anthropic')).toBeDisabled();
  });

  it('names the API key dialog, focuses its input, and restores focus after Escape', async () => {
    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    const trigger = screen.getByRole('button', { name: 'Set API key' });

    await fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Set API key' })).toHaveAttribute('data-blocking-overlay', 'true');
    await waitFor(() => expect(screen.getByPlaceholderText('Paste API key')).toHaveFocus());

    await fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set API key' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('places provider dialogs in the app overlay target when context provides one', async () => {
    const overlayTarget = document.createElement('div');
    document.body.append(overlayTarget);

    render(SettingsPage, {
      context: new Map([['app-overlay-target', () => overlayTarget]])
    });
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set API key' }));

    expect(overlayTarget).toContainElement(screen.getByRole('dialog', { name: 'Set API key' }));
    overlayTarget.remove();
  });

  it('clears API key input state when the dialog is dismissed', async () => {
    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    const trigger = screen.getByRole('button', { name: 'Set API key' });

    await fireEvent.click(trigger);
    await fireEvent.input(screen.getByPlaceholderText('Paste API key'), { target: { value: 'discard-me' } });
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set API key' })).not.toBeInTheDocument());

    await fireEvent.click(trigger);
    expect(screen.getByPlaceholderText('Paste API key')).toHaveValue('');
  });

  it('keeps the API key dialog open while saving', async () => {
    let resolveSave!: (result: { success: boolean }) => void;
    agentsStore.setProviderApiToken = vi.fn(() => new Promise((resolve) => (resolveSave = resolve))) as any;

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set API key' }));
    await fireEvent.input(screen.getByPlaceholderText('Paste API key'), { target: { value: 'sk-test' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Set API key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close API key dialog' })).toBeDisabled();

    resolveSave({ success: true });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set API key' })).not.toBeInTheDocument());
  });

  it('checks device-poll OAuth completion without pasted input', async () => {
    agentsStore.startProviderSignIn = vi.fn(async () => ({
      flow_id: 'flow-1',
      provider: 'anthropic',
      authorization_url: 'https://example.com/device',
      flow_kind: 'device_poll'
    }));

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));

    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with OAuth' }));
    expect(screen.queryByPlaceholderText('https://... or pasted code')).not.toBeInTheDocument();
    expect(screen.getByText(/Approve access for Anthropic in your browser/)).toBeInTheDocument();
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
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with OAuth' }));

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
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with OAuth' }));

    expect(open).not.toHaveBeenCalled();
    await fireEvent.click(await screen.findByRole('button', { name: 'Open in browser' }));
    expect(open).toHaveBeenCalledWith('https://example.com/oauth');

    const textarea = screen.getByPlaceholderText('https://... or pasted code');
    await fireEvent.input(textarea, { target: { value: 'manual-code' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Complete sign-in' }));

    expect(agentsStore.completeProviderSignIn).toHaveBeenCalledWith('agent-1', 'flow-2', 'manual-code');
  });

  it('cancels in-progress OAuth polling when Escape dismisses the dialog', async () => {
    agentsStore.startProviderSignIn = vi.fn(async () => ({
      flow_id: 'flow-escape',
      provider: 'anthropic',
      authorization_url: 'https://example.com/oauth',
      flow_kind: 'redirect_code'
    }));
    agentsStore.refreshAuthProviders = vi.fn(async () => [
      { provider: 'anthropic', oauth_status: 'not_authenticated', supports_oauth: true }
    ]) as any;

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with OAuth' }));

    expect(await screen.findByRole('dialog', { name: 'Sign in to Anthropic' })).toHaveAttribute('data-blocking-overlay', 'true');
    await fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in to Anthropic' })).not.toBeInTheDocument());
    expect(await screen.findByText('Cancelled sign-in for Anthropic.')).toBeInTheDocument();
    expect(agentsStore.disconnectProvider).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Sign in with OAuth' })).toBeEnabled();
  });

  it('restores focus to a replacement primary Reconnect after cancelling OAuth', async () => {
    agentsStore.authProvidersByAgent['agent-1'] = [
      {
        provider: 'anthropic',
        display_name: 'Anthropic',
        oauth_status: 'expired',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: true,
        preferred_method: 'oauth'
      }
    ];
    agentsStore.startProviderSignIn = vi.fn(async () => ({
      flow_id: 'flow-reconnect',
      provider: 'anthropic',
      authorization_url: 'https://example.com/oauth',
      flow_kind: 'redirect_code'
    }));
    agentsStore.refreshAuthProviders = vi.fn(async () => [
      { provider: 'anthropic', oauth_status: 'expired', supports_oauth: true }
    ]) as any;

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    const originalReconnect = screen.getByRole('button', { name: 'Reconnect' });
    const providerRow = screen.getByRole('heading', { name: 'Anthropic' }).closest('article');

    await fireEvent.click(originalReconnect);

    expect(await screen.findByRole('dialog', { name: 'Sign in to Anthropic' })).toBeInTheDocument();
    expect(originalReconnect.isConnected).toBe(false);
    await fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in to Anthropic' })).not.toBeInTheDocument());
    const replacementReconnect = await screen.findByRole('button', { name: 'Reconnect' });
    await waitFor(() => expect(replacementReconnect).toHaveFocus());
    expect(providerRow).toContainElement(replacementReconnect);
    expect(document.body).not.toHaveFocus();
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
        preferred_method: 'oauth',
        env_var_name: 'ANTHROPIC_API_KEY'
      },
      {
        provider: 'google',
        display_name: 'Google',
        oauth_status: null as any,
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: false,
        preferred_method: 'api_key',
        env_var_name: 'GOOGLE_API_KEY'
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
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getAllByRole('button', { name: 'Set up' })[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in with OAuth' }));

    const dialogCancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(dialogCancel).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set API key' })).toBeDisabled();

    await fireEvent.click(dialogCancel);

    expect(await screen.findByText('Cancelled sign-in for Anthropic.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sign in with OAuth' })).toBeEnabled();
  });

  it('uses named confirmations and defaults focus to their safe actions', async () => {
    agentsStore.authProvidersByAgent['agent-1'] = [
      {
        provider: 'anthropic',
        display_name: 'Anthropic',
        oauth_status: 'connected',
        has_stored_api_key: true,
        has_env_api_key: false,
        supports_oauth: true,
        preferred_method: 'oauth',
        env_var_name: 'ANTHROPIC_API_KEY'
      }
    ];

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    const disconnectTrigger = screen.getByRole('button', { name: 'Disconnect OAuth' });
    await fireEvent.click(disconnectTrigger);
    expect(screen.getByRole('alertdialog', { name: 'Disconnect Anthropic?' })).toHaveAccessibleDescription('OAuth access will be removed. You can sign in again at any time.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(disconnectTrigger).toHaveFocus());

    const clearTrigger = screen.getByRole('button', { name: 'Clear API key' });
    await fireEvent.click(clearTrigger);
    expect(screen.getByRole('alertdialog', { name: 'Remove the stored Anthropic key?' })).toHaveAccessibleDescription('The key will be removed from the desktop keyring. Environment variables are not changed.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(clearTrigger).toHaveFocus());
  });

  it('focuses the provider row primary action after clear-key loses its opening button', async () => {
    const connectedProvider = {
      provider: 'anthropic',
      display_name: 'Anthropic',
      oauth_status: 'connected',
      has_stored_api_key: true,
      has_env_api_key: false,
      supports_oauth: true,
      preferred_method: 'oauth',
      env_var_name: 'ANTHROPIC_API_KEY'
    };
    agentsStore.authProvidersByAgent['agent-1'] = [connectedProvider];
    let clearTrigger!: HTMLElement;
    agentsStore.clearProviderApiToken = vi.fn(async () => {
      clearTrigger.remove();
      return { success: true };
    });

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    const providerRow = screen.getByRole('heading', { name: 'Anthropic' }).closest('article');
    clearTrigger = screen.getByRole('button', { name: 'Clear API key' });
    await fireEvent.click(clearTrigger);

    await fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Remove the stored Anthropic key?' })).not.toBeInTheDocument());
    expect(clearTrigger.isConnected).toBe(false);
    const primaryAction = screen.getByRole('button', { name: 'Manage' });
    await waitFor(() => expect(primaryAction).toHaveFocus());
    expect(providerRow).toContainElement(primaryAction);
    expect(document.body).not.toHaveFocus();
  });

  it('keeps destructive confirmations open while their actions are pending', async () => {
    let resolveDisconnect!: (result: { success: boolean }) => void;
    agentsStore.authProvidersByAgent['agent-1'] = [
      {
        provider: 'anthropic',
        display_name: 'Anthropic',
        oauth_status: 'connected',
        has_stored_api_key: false,
        has_env_api_key: false,
        supports_oauth: true,
        preferred_method: 'oauth'
      }
    ];
    agentsStore.disconnectProvider = vi.fn(() => new Promise((resolve) => (resolveDisconnect = resolve))) as any;

    render(SettingsPage);
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Disconnect OAuth' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog', { name: 'Disconnect Anthropic?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);

    resolveDisconnect({ success: true });
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Disconnect Anthropic?' })).not.toBeInTheDocument());
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
    await fireEvent.click(screen.getByRole('button', { name: /Providers/ }));

    expect(screen.queryByText('Downloading layers')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /Advanced maintenance/ }));
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('pulling · 50%')).toBeInTheDocument();
    expect(screen.getByText('Downloading layers')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(screen.getByRole('button', { name: 'Set API key' })).toBeEnabled();
  });
});
