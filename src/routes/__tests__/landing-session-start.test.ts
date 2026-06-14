import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from '../+page.svelte';

function createAgentsStore() {
  return {
    configs: [
      {
        id: 'agent-1',
        name: 'QMTCODE',
        commandLine: '/usr/local/bin/qmtcode --acp',
        enabled: true,
        autoStart: true
      }
    ],
    statuses: {
      'agent-1': {
        agentId: 'agent-1',
        state: 'running',
        commandLine: '/usr/local/bin/qmtcode --acp',
        pid: 1234,
        version: '1.0.0',
        message: 'Running',
        lastError: null
      }
    },
    meshNodesByAgent: {},
    activeSessionId: null as string | null,
    activeAgentId: null as string | null,
    activeSession: { runState: 'idle' },
    composerCwd: '/tmp/work',
    composerPrompt: '',
    composerModelId: 'anthropic/claude-sonnet-4',
    composerProfileId: 'default',
    composerTargetId: 'local',
    promptAttachments: [],
    promptFocusToken: 0,
    loading: false,
    error: null as string | null,
    modelsByAgent: {
      'agent-1': [
        {
          id: 'anthropic/claude-sonnet-4',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          label: 'Claude Sonnet 4'
        }
      ]
    },
    modelInfoByAgent: { 'agent-1': {} },
    modelLoadingByAgent: { 'agent-1': false },
    setComposerCwd: vi.fn((value: string) => {
      agentsStore.composerCwd = value;
    }),
    setComposerPrompt: vi.fn((value: string) => {
      agentsStore.composerPrompt = value;
    }),
    setComposerModel: vi.fn(async (value: string) => {
      agentsStore.composerModelId = value;
    }),
    refreshModelsForAgent: vi.fn(async () => undefined),
    addPromptAttachments: vi.fn(),
    removePromptAttachment: vi.fn(),
    setComposerProfile: vi.fn(),
    setComposerTarget: vi.fn(),
    createSession: vi.fn(async () => 'session-1'),
    startSessionWithPrompt: vi.fn(async () => 'session-1'),
    getRecentModels: vi.fn(() => []),
    getRecentWorkspaces: vi.fn(() => []),
    getProfileOptions: vi.fn(() => []),
    getTargetOptions: vi.fn(() => [{ id: 'local', label: 'Local' }])
  };
}

const goto = vi.hoisted(() => vi.fn(async () => undefined));
const agentsStore = vi.hoisted(() => createAgentsStore());

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));
vi.mock('$lib/stores/inbox.svelte', () => ({ inboxStore: { pendingCount: 0 } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.assign(agentsStore, createAgentsStore());
});

describe('Landing page session start', () => {
  it('opens the new session as soon as session creation resolves', async () => {
    agentsStore.startSessionWithPrompt.mockResolvedValue('session-1');

    render(LandingPage);

    const prompt = screen.getByPlaceholderText('Ask QueryMT to inspect, change, debug, explain, or plan something.');
    await fireEvent.input(prompt, { target: { value: 'Fix the failing tests' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(agentsStore.setComposerPrompt).toHaveBeenCalledWith('Fix the failing tests');
    expect(agentsStore.startSessionWithPrompt).toHaveBeenCalledWith('agent-1');
    await waitFor(() => {
      expect(goto).toHaveBeenCalledWith('/sessions/agent-1/session-1');
    });
  });
});
