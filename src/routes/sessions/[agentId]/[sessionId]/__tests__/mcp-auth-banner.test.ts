import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyActiveSession } from '$lib/domain/session-updates';
import SessionPage from '../+page.svelte';

const goto = vi.hoisted(() => vi.fn(async () => undefined));
const route = vi.hoisted(() => ({ params: { agentId: 'agent-1', sessionId: 'pending-launch-1' } }));
const store = vi.hoisted(() => {
  const state = { data: {} as Record<string, unknown>, fns: {} as Record<string, ReturnType<typeof vi.fn>> };
  // Spies are created on first access, by the page or by an assertion.
  const spy = (key: string) => (state.fns[key] ??= vi.fn(() => (key.startsWith('can') || key.startsWith('is') ? false : undefined)));
  return Object.assign(state, { spy });
});

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: route }));
vi.mock('$lib/stores/sidebar.svelte', () => ({ sidebarStore: { effectiveCollapsed: false, viewportConstrained: false } }));
vi.mock('$lib/stores/chat-preferences.svelte', () => ({
  chatPreferencesStore: { sendShortcut: 'enter', developerMode: false, inputDelivery: 'steer' }
}));
vi.mock('$lib/stores/inbox.svelte', () => ({ inboxStore: { pendingElicitationsForSession: () => [] } }));
// Plain data fields are read as-is; every other member is a spy returning undefined/false.
vi.mock('$lib/stores/agents.svelte', () => ({
  agentsStore: new Proxy({}, {
    get(_target, key: string) {
      if (key in store.data) return store.data[key];
      return store.spy(key);
    }
  })
}));

class ResizeObserverMock { observe() {} disconnect() {} unobserve() {} }

function launch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pending-launch-1', agentId: 'agent-1', cwd: '/tmp/work', status: 'creating', error: null,
    prompt: 'Fix the tests', attachments: [], clientPromptId: 'p1', targetLabel: null, sessionId: null,
    settings: {}, ...overrides
  };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Element.prototype.scrollTo ??= () => {};
  route.params = { agentId: 'agent-1', sessionId: 'pending-launch-1' };
  store.fns = { getSkippedMcpServers: vi.fn(() => []) };
  store.data = {
    activeSession: createEmptyActiveSession(),
    activeSessionId: 'pending-launch-1', activeAgentId: 'agent-1',
    pendingLaunches: { 'pending-launch-1': launch() },
    sessionsByAgent: {}, configs: [], connectionStates: {}, connectedAgents: [],
    activePendingInputs: [], modelsByAgent: {}, modelInfoByAgent: {}, modelLoadingByAgent: {},
    sessionPinPending: {}, sessionPinErrors: {}, sessionLifecyclePending: {}, sessionLifecycleErrors: {},
    sessionConfigPending: {}, promptAttachments: [], composerPrompt: '', error: null, promptFailure: null,
    sessionHistoryLoading: false, forkPending: false, loading: false, inputSubmitPending: false,
    promptRetryPending: false, worktreePending: false, activeSessionAccess: null, activeSessionRuntime: null, activeRunBusy: false,
    activeInputDelivery: 'steer', activeRecentDelegateModels: {}, activeDelegateAssignments: null,
    activeDelegateAssignmentsLoading: false, activeDelegateAssignmentsError: null,
    activeDelegateAssignmentPending: {}, activeDelegateAssignmentConflict: false, promptFocusToken: 0
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Session page MCP sign-in banner', () => {
  const skipped = { server_name: 'linear', provider_id: 'mcp:linear' };

  function openRealSession() {
    route.params = { agentId: 'agent-1', sessionId: 'real-1' };
    store.data.pendingLaunches = {};
    store.data.activeSessionId = 'real-1';
    store.data.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'A', sessionId: 'real-1', title: 'T', cwd: '/tmp/work', updatedAt: null,
      runtimeId: 'agent-1', runtimeName: 'A', source: 'acp', status: 'idle', location: 'local'
    }] };
  }

  it('signs in inline, then offers a new session in the same workspace', async () => {
    openRealSession();
    store.spy('getSkippedMcpServers').mockReturnValue([skipped]);
    store.spy('startProviderSignIn').mockResolvedValue({
      flow_id: 'f1', provider: 'mcp:linear', flow_kind: 'redirect_code', authorization_url: 'https://auth.example/x'
    });
    store.spy('refreshAuthProviders').mockResolvedValue([]);
    store.spy('createSession').mockResolvedValue('new-1');
    render(SessionPage);

    expect(screen.getByTestId('mcp-auth-notice')).toHaveTextContent('needs sign-in');
    await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(store.spy('startProviderSignIn')).toHaveBeenCalledWith('agent-1', 'mcp:linear'));
    await waitFor(() => expect(screen.getByLabelText('Authorization URL')).toHaveValue('https://auth.example/x'));

    // The agent now reports the login: the banner switches to "start a new session".
    store.spy('isMcpServerSignedIn').mockReturnValue(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    store.spy('getSkippedMcpServers').mockReturnValue([{ ...skipped }]);
    cleanup();
    render(SessionPage);
    expect(screen.getByTestId('mcp-auth-notice')).toHaveTextContent('Start a new session');

    await fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    await waitFor(() => expect(store.spy('createSession')).toHaveBeenCalledWith('agent-1', { cwd: '/tmp/work', targetId: 'local' }));
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/sessions/agent-1/new-1'));
  });

  it('shows the error, retry and a Settings link for an unavailable server, and can dismiss it', async () => {
    openRealSession();
    store.spy('getSkippedMcpServers').mockReturnValue([{ ...skipped, error: 'dns failure' }]);
    render(SessionPage);

    expect(screen.getByTestId('mcp-auth-notice')).toHaveTextContent('unavailable: dns failure');
    expect(screen.getByRole('button', { name: 'Retry sign-in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings?section=connectors');

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss linear' }));
    expect(store.spy('dismissSkippedMcpServer')).toHaveBeenCalledWith('agent-1', 'real-1', 'linear');
  });

  it('shows no banner when nothing was skipped', () => {
    openRealSession();
    render(SessionPage);
    expect(screen.queryByTestId('mcp-auth-notice')).not.toBeInTheDocument();
  });
});
