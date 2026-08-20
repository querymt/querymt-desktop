import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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
        lastError: null as string | null
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
        missingMethods: [] as string[],
        missingFeatures: [] as string[]
      }
    },
    agentErrors: { 'agent-1': null as string | null },
    loading: false,
    error: null as string | null,
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
  it('uses one page title without a redundant configured-agents heading', () => {
    render(AgentsPage);

    expect(screen.getByRole('heading', { level: 1, name: 'Agents' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Configured agents' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Configured agents' })).toBeInTheDocument();
  });

  it('offers the primary setup action when no agents are configured', async () => {
    agentsStore.configs = [];
    agentsStore.statuses = {} as typeof agentsStore.statuses;
    agentsStore.sessionsByAgent = {} as typeof agentsStore.sessionsByAgent;

    render(AgentsPage);

    expect(screen.getByText('No agents configured')).toBeInTheDocument();
    expect(screen.getByText('Add a local ACP command or connect to an ACP WebSocket endpoint.')).toBeInTheDocument();
    await fireEvent.click(screen.getAllByRole('button', { name: 'Add agent' })[1]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows a stable loading state before agent configuration is available', () => {
    agentsStore.configs = [];
    agentsStore.statuses = {} as typeof agentsStore.statuses;
    agentsStore.sessionsByAgent = {} as typeof agentsStore.sessionsByAgent;
    agentsStore.loading = true;

    render(AgentsPage);

    expect(screen.getByLabelText('Loading agents')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No agents configured')).not.toBeInTheDocument();
  });

  it('provides recovery when agent initialization fails', async () => {
    agentsStore.configs = [];
    agentsStore.statuses = {} as typeof agentsStore.statuses;
    agentsStore.sessionsByAgent = {} as typeof agentsStore.sessionsByAgent;
    agentsStore.error = 'Agent service unavailable.';

    render(AgentsPage);

    expect(screen.getByRole('alert')).toHaveTextContent('Agents could not be loaded');
    expect(screen.getByRole('alert')).toHaveTextContent('Agent service unavailable.');
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(agentsStore.initialize).toHaveBeenCalledOnce();
  });

  it('renders a simple agent row without verbose details by default', () => {
    render(AgentsPage);

    expect(screen.getByRole('button', { name: 'Add agent' })).not.toHaveClass('icon-btn-primary');
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
    expect(screen.getByRole('dialog', { name: 'Edit agent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument();
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

  it('shows unique actionable diagnostics when ACP control is failing', async () => {
    agentsStore.statuses['agent-1'] = {
      ...agentsStore.statuses['agent-1'],
      state: 'failed',
      message: 'Agent failed to initialize.',
      lastError: 'Agent failed to initialize.'
    };
    agentsStore.connectionStates['agent-1'] = 'failed';
    agentsStore.controlHealthByAgent['agent-1'] = {
      state: 'failed',
      summary: 'Agent failed to initialize.',
      missingMethods: ['session/list'],
      missingFeatures: []
    };
    agentsStore.agentErrors['agent-1'] = 'Agent failed to initialize.';

    const { container } = render(AgentsPage);

    expect(container.querySelector('.status-dot-degraded')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Details for QMTCODE' }));
    const drawer = screen.getByRole('dialog', { name: 'QMTCODE' });
    expect(within(drawer).getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument();
    expect(within(drawer).getAllByText('Agent failed to initialize.')).toHaveLength(1);
    expect(within(drawer).getByText('Connection to this agent failed.')).toBeInTheDocument();
    expect(within(drawer).getByText('session/list')).toBeInTheDocument();
  });

  it('keeps delete visible with the other row actions', async () => {
    render(AgentsPage);

    const deleteButton = screen.getByRole('button', { name: 'Delete QMTCODE' });
    expect(deleteButton).toHaveClass('icon-btn-danger');
    expect(screen.queryByLabelText('More actions for QMTCODE')).not.toBeInTheDocument();
    await fireEvent.click(deleteButton);

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete QMTCODE?');
  });

  it('opens a structured details drawer without listing individual sessions', async () => {
    render(AgentsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Details for QMTCODE' }));

    const drawer = screen.getByRole('dialog', { name: 'QMTCODE' });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agent overview' })).toHaveTextContent('Runtime');
    expect(screen.getByRole('region', { name: 'Agent overview' })).toHaveTextContent('Connection');
    expect(screen.getByLabelText('1 session')).toBeInTheDocument();
    expect(screen.queryByText('Investigate auth issue')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Control health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Capabilities' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Diagnostics' })).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime state')).not.toBeInTheDocument();
    expect(screen.queryByText('All controls available.')).not.toBeInTheDocument();
    expect(screen.getByText('QMT Code')).toBeInTheDocument();
    expect(screen.getByText('Process ID').nextElementSibling).toHaveTextContent('1234');
    expect(screen.getByRole('heading', { name: 'Runtime logs' }).nextElementSibling).toHaveTextContent('1 entry retained');
    expect(screen.queryByRole('log', { name: 'QMTCODE runtime logs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Search logs' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Open log console' }));

    expect(screen.getByRole('dialog', { name: 'QMTCODE runtime logs' })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'QMTCODE runtime logs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy all logs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy log entry/ })).not.toBeInTheDocument();
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'QMTCODE runtime logs' })).getByRole('button', { name: 'Close expanded logs' }));
    expect(screen.queryByRole('dialog', { name: 'QMTCODE runtime logs' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'QMTCODE' })).toBeInTheDocument();
  });
});
