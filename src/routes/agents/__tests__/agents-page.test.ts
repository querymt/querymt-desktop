import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsPage from '../+page.svelte';

function createAgentsStore() {
  return {
    configs: [
      {
        id: 'agent-1',
        name: 'QMTCODE',
        transport: 'stdio',
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
    sessionsByAgent: {
      'agent-1': [
        {
          agentId: 'agent-1',
          agentName: 'QMTCODE',
          sessionId: 'session-1',
          title: 'Investigate auth issue',
          cwd: '/tmp/work',
          updatedAt: null,
          runtimeId: 'local',
          runtimeName: 'Local',
          source: 'acp',
          status: 'active'
        }
      ]
    },
    logsByAgent: {
      'agent-1': [{ stream: 'stdout', timestamp: '2026-06-11T12:00:00Z', message: 'ready' }]
    },
    connectionStates: { 'agent-1': 'initialized' },
    controlCapabilitiesByAgent: {
      'agent-1': {
        querymt_control_version: 1,
        methods: [],
        agent: { kind: 'querymt', version: '1.0.0', display_name: 'QMT Code' },
        transport: { mesh: true, websocket: false },
        features: {
          models: true,
          schedules: true,
          remote_sessions: true,
          mesh_invites: false,
          auth: true,
          mesh: true
        }
      }
    },
    controlHealthByAgent: {
      'agent-1': {
        state: 'ready',
        summary: 'All controls available.',
        missingMethods: [],
        missingFeatures: []
      }
    },
    agentErrors: { 'agent-1': null },
    initialize: vi.fn(async () => undefined),
    refreshCapabilities: vi.fn(async () => undefined),
    startConfiguredAgent: vi.fn(async () => undefined),
    stopConfiguredAgent: vi.fn(async () => undefined),
    restartConfiguredAgent: vi.fn(async () => undefined),
    deleteConfig: vi.fn(async () => undefined),
    updateConfig: vi.fn(),
    createConfig: vi.fn((name: string, transport: 'stdio' | 'websocket', endpoint: string) => ({
      id: 'agent-2',
      name,
      transport,
      commandLine: transport === 'stdio' ? endpoint : '',
      websocketUrl: transport === 'websocket' ? endpoint : undefined,
      enabled: true,
      autoStart: true
    })),
    saveConfig: vi.fn(),
    refreshAgent: vi.fn(async () => undefined)
  };
}

const agentsStore = vi.hoisted(() => createAgentsStore());
vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  Object.assign(agentsStore, createAgentsStore());
});

describe('Agents page', () => {
  it('renders a simple agent row without verbose details by default', () => {
    render(AgentsPage);

    expect(screen.getByText('QMTCODE')).toBeInTheDocument();
    expect(screen.getByText('/usr/local/bin/qmtcode --acp')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.queryByText('Missing methods:')).not.toBeInTheDocument();
    expect(screen.queryByText('QMT Code logs')).not.toBeInTheDocument();
  });

  it('opens the add dialog and saves a new agent after typing', async () => {
    render(AgentsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Add agent' }));
    await fireEvent.input(screen.getByPlaceholderText('Agent name'), { target: { value: 'QueryMT Dev' } });
    await fireEvent.input(screen.getByPlaceholderText('/path/to/executable --acp'), {
      target: { value: '/opt/querymt --acp' }
    });
    await fireEvent.click(screen.getAllByRole('button', { name: 'Add agent' })[1]);

    expect(agentsStore.createConfig).toHaveBeenCalledWith('QueryMT Dev', 'stdio', '/opt/querymt --acp');
    expect(agentsStore.saveConfig).toHaveBeenCalled();
    expect(agentsStore.refreshAgent).toHaveBeenCalled();
    expect(agentsStore.startConfiguredAgent).toHaveBeenCalledWith('agent-2');
  });

  it('opens edit dialog prefilled and saves updates', async () => {
    render(AgentsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Edit QMTCODE' }));
    const nameInput = screen.getByDisplayValue('QMTCODE');
    const commandInput = screen.getByDisplayValue('/usr/local/bin/qmtcode --acp');
    expect(commandInput).toHaveAttribute('autocomplete', 'off');
    expect(commandInput).toHaveAttribute('autocorrect', 'off');
    expect(commandInput).toHaveAttribute('autocapitalize', 'off');
    expect(commandInput).not.toHaveAttribute('spellcheck', 'true');
    await fireEvent.input(nameInput, { target: { value: 'QMTCODE Local' } });
    await fireEvent.input(commandInput, { target: { value: '/usr/bin/qmtcode --acp --mesh' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(agentsStore.updateConfig).toHaveBeenCalledWith('agent-1', {
      name: 'QMTCODE Local',
      transport: 'stdio',
      commandLine: '/usr/bin/qmtcode --acp --mesh',
      websocketUrl: undefined
    });
    expect(agentsStore.refreshAgent).toHaveBeenCalled();
  });

  it('shows degraded runtime state when ACP control is failing', () => {
    agentsStore.connectionStates['agent-1'] = 'failed';
    agentsStore.controlHealthByAgent['agent-1'] = {
      state: 'failed',
      summary: 'Agent failed to initialize.',
      missingMethods: [],
      missingFeatures: []
    };

    const { container } = render(AgentsPage);

    expect(container.querySelector('.status-dot-degraded')).toBeTruthy();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('opens the details drawer for extended information', async () => {
    render(AgentsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Details for QMTCODE' }));

    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('Capabilities')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('QMT Code')).toBeInTheDocument();
    expect(screen.getByText('Investigate auth issue')).toBeInTheDocument();
    expect(screen.getByText('QMTCODE logs')).toBeInTheDocument();
  });
});
