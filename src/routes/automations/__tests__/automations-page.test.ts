import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AutomationsPage from '../+page.svelte';
import type { ScheduleInfo } from '$lib/querymt/generated/types';

function capabilities() {
  return {
    querymt_control_version: 1,
    methods: [
      'querymt/schedules/list',
      'querymt/schedules/create',
      'querymt/schedules/pause',
      'querymt/schedules/resume',
      'querymt/schedules/trigger',
      'querymt/schedules/delete'
    ],
    agent: { kind: 'querymt', version: '1.0.0', display_name: 'QMT Code' },
    transport: { mesh: true, websocket: false },
    features: { models: true, schedules: true, remote_schedules: false, remote_sessions: true, mesh_invites: true, auth: true, mesh: true }
  };
}

function schedule(overrides: Partial<ScheduleInfo>): ScheduleInfo {
  return {
    public_id: 'schedule-active',
    task_public_id: 'task-1',
    session_public_id: 'session-1',
    trigger: { kind: 'cron', expr: '0 * * * *' },
    state: 'active',
    next_run_at: '2026-07-29T00:00:00Z',
    run_count: 2,
    consecutive_failures: 0,
    max_runtime_seconds: 300,
    created_at: '2026-07-28T00:00:00Z',
    updated_at: '2026-07-28T00:00:00Z',
    ...overrides
  };
}

function createAgentsStore() {
  return {
    configs: [{ id: 'agent-1', name: 'QMTCODE', transport: 'stdio', commandLine: 'qmtcode', enabled: true, autoStart: true }] as Array<{ id: string; name: string; transport: string; commandLine: string; enabled: boolean; autoStart: boolean }>,
    controlCapabilitiesByAgent: { 'agent-1': capabilities() } as Record<string, ReturnType<typeof capabilities>>,
    controlHealthByAgent: { 'agent-1': { state: 'ready', summary: 'All controls available.', missingMethods: [], missingFeatures: [] } } as Record<string, { state: string; summary: string; missingMethods: string[]; missingFeatures: string[] }>,
    schedulesByAgent: {
      'agent-1': {
        schedules: [
          schedule({ public_id: 'schedule-paused', state: 'paused', trigger: { kind: 'cron', expr: '0 9 * * 1-5' } }),
          schedule({ public_id: 'schedule-attention', consecutive_failures: 3, trigger: { kind: 'cron', expr: '0 9 * * *' } }),
          schedule({})
        ]
      }
    } as Record<string, { schedules: ScheduleInfo[] }>,
    refreshSchedulesForAgent: vi.fn(async () => undefined),
    runScheduleAction: vi.fn(async () => undefined)
  };
}

const agentsStore = vi.hoisted(() => createAgentsStore());
const commandPaletteStore = vi.hoisted(() => ({ openSchedule: vi.fn() }));
vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));
vi.mock('$lib/stores/command-palette.svelte', () => ({ commandPaletteStore }));

afterEach(() => cleanup());

beforeEach(() => {
  Object.assign(agentsStore, createAgentsStore());
  vi.clearAllMocks();
});

describe('Automations page', () => {
  it('groups status by urgency and hides a redundant single-agent selector', () => {
    render(AutomationsPage);

    expect(screen.queryByLabelText('Automation agent')).not.toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Needs attention', 'Active', 'Paused']);
    expect(screen.queryByRole('heading', { name: 'Agent' })).not.toBeInTheDocument();
  });

  it('shows the agent selector only when multiple agents support schedules', () => {
    agentsStore.configs = [...agentsStore.configs, { ...agentsStore.configs[0], id: 'agent-2', name: 'Second agent' }];
    agentsStore.controlCapabilitiesByAgent = { ...agentsStore.controlCapabilitiesByAgent, 'agent-2': capabilities() };
    agentsStore.controlHealthByAgent = { ...agentsStore.controlHealthByAgent, 'agent-2': agentsStore.controlHealthByAgent['agent-1'] };

    render(AutomationsPage);

    expect(screen.getByLabelText('Automation agent')).toBeInTheDocument();
  });

  it('opens create from the header with clean selected-agent context', async () => {
    render(AutomationsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(commandPaletteStore.openSchedule).toHaveBeenCalledWith({ agentId: 'agent-1', sessionId: null, cwd: null, prompt: null, nodeId: null });
  });

  it('shows only the state-appropriate primary actions', () => {
    render(AutomationsPage);

    expect(screen.getByRole('button', { name: 'Resume Weekdays at 09:00' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause Weekdays at 09:00' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause Every hour' })).toBeInTheDocument();
  });

  it('runs an action for only the selected schedule', async () => {
    render(AutomationsPage);

    await fireEvent.click(screen.getByRole('button', { name: 'Pause Every hour' }));
    expect(agentsStore.runScheduleAction).toHaveBeenCalledWith('agent-1', 'pause', 'schedule-active', undefined);
  });

  it('confirms destructive deletion before invoking the store action', async () => {
    render(AutomationsPage);

    await fireEvent.click(screen.getByLabelText('More actions for Every hour'));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Every hour' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete automation');
    expect(agentsStore.runScheduleAction).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(agentsStore.runScheduleAction).toHaveBeenCalledWith('agent-1', 'delete', 'schedule-active', undefined));
  });

  it('keeps a full create action in the empty state', async () => {
    agentsStore.schedulesByAgent = { 'agent-1': { schedules: [] } };
    render(AutomationsPage);

    expect(screen.getByText('No automations yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Create automation' })).toHaveLength(2);
  });

  it('shows a focused unavailable state when no agents support schedules', () => {
    agentsStore.configs = [];
    agentsStore.controlCapabilitiesByAgent = {};
    agentsStore.controlHealthByAgent = {};

    render(AutomationsPage);

    expect(screen.getByText('Automations are not available')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Active' })).not.toBeInTheDocument();
  });
});
