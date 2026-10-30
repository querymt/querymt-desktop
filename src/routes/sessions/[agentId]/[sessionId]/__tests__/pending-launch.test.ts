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
  store.fns = {};
  store.data = {
    activeSession: createEmptyActiveSession(),
    activeSessionId: 'pending-launch-1', activeAgentId: 'agent-1',
    pendingLaunches: { 'pending-launch-1': launch() },
    sessionsByAgent: {}, configs: [], connectionStates: {}, connectedAgents: [],
    activePendingInputs: [], modelsByAgent: {}, modelInfoByAgent: {}, modelLoadingByAgent: {},
    sessionPinPending: {}, sessionPinErrors: {}, sessionLifecyclePending: {}, sessionLifecycleErrors: {},
    sessionConfigPending: {}, promptAttachments: [], composerPrompt: '', error: null, promptFailure: null,
    sessionHistoryLoading: false, forkPending: false, loading: false, inputSubmitPending: false,
    promptRetryPending: false, worktreePending: false, activeSessionAccess: null, activeSessionRuntime: null,
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

describe('Session page pending launch', () => {
  it('shows the creating placeholder without loading the session or rendering the composer', async () => {
    render(SessionPage);
    await waitFor(() => expect(store.spy('showPendingLaunch')).toHaveBeenCalledWith('pending-launch-1'));

    expect(store.spy('loadSession')).not.toHaveBeenCalled();
    expect(screen.queryByTestId('launch-error')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/reply/i)).not.toBeInTheDocument();
    expect(goto).not.toHaveBeenCalled();
  });

  it('replaces the URL with the real session id, using the launch agent, once session/new answered', async () => {
    store.data.pendingLaunches = { 'pending-launch-1': launch({ agentId: 'agent-2', sessionId: 'real-1' }) };
    render(SessionPage);

    await waitFor(() => expect(goto).toHaveBeenCalledWith('/sessions/agent-2/real-1', { replaceState: true }));
    expect(goto).toHaveBeenCalledOnce();
  });

  it('sends a stale placeholder URL back to the launcher', async () => {
    store.data.pendingLaunches = {};
    render(SessionPage);

    await waitFor(() => expect(goto).toHaveBeenCalledWith('/', { replaceState: true }));
  });

  it('offers Retry and Back to launcher for a failed launch', async () => {
    store.data.pendingLaunches = { 'pending-launch-1': launch({ status: 'failed', error: 'node unreachable' }) };
    render(SessionPage);

    const alert = screen.getByTestId('launch-error');
    expect(alert).toHaveTextContent('node unreachable');

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(store.spy('retryLaunch')).toHaveBeenCalledWith('pending-launch-1');

    await fireEvent.click(screen.getByRole('button', { name: 'Back to launcher' }));
    expect(store.spy('discardLaunch')).toHaveBeenCalledWith('pending-launch-1');
    expect(goto).toHaveBeenCalledWith('/');
  });

  it('keeps the real session composer disabled while the launch is still setting up', async () => {
    route.params = { agentId: 'agent-1', sessionId: 'real-1' };
    store.data.pendingLaunches = {};
    store.data.activeSessionId = 'real-1';
    store.data.sessionsByAgent = { 'agent-1': [{
      agentId: 'agent-1', agentName: 'A', sessionId: 'real-1', title: 'T', cwd: '/tmp/work', updatedAt: null,
      runtimeId: 'agent-1', runtimeName: 'A', source: 'acp', status: 'idle', location: 'local'
    }] };
    store.spy('isLaunchSettingUp').mockReturnValue(true);
    render(SessionPage);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled());
  });
});
