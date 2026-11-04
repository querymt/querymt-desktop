import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const goto = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('$app/navigation', () => ({ goto }));
const openExternalUrl = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('$native', () => ({ suggestWorkspacePaths: vi.fn(async () => []), openExternalUrl }));

function capabilities() {
  return {
    querymt_control_version: 1,
    methods: ['querymt/schedules/list', 'querymt/schedules/create'],
    agent: { kind: 'querymt', version: '1.0.0', display_name: 'QMT Code' },
    transport: { mesh: true, websocket: false },
    features: { models: true, schedules: true, remote_schedules: false, remote_sessions: true, mesh_invites: true, auth: true, mesh: true }
  };
}

function createAgentsStore() {
  return {
    configs: [{ id: 'agent-1', name: 'QMTCODE' }] as Array<{ id: string; name: string }>,
    statuses: { 'agent-1': { state: 'running' } } as Record<string, { state: string }>,
    controlCapabilitiesByAgent: { 'agent-1': capabilities() } as Record<string, ReturnType<typeof capabilities>>,
    sessionsByAgent: {
      'agent-1': [
        { sessionId: 'session-9', title: 'Nightly review', cwd: '/home/me/projects/querymt', updatedAt: '2026-07-28T00:00:00Z' },
        { sessionId: 'abc-1234-xyz', title: 'Release notes', cwd: '/srv/docs', updatedAt: '2026-07-27T00:00:00Z' }
      ]
    } as Record<string, Array<{ sessionId: string; title: string; cwd: string; updatedAt: string }>>,
    composerCwd: '/home/me/projects/querymt',
    getRecentWorkspaces: () => [] as string[],
    createBackgroundSession: vi.fn(async () => ({ sessionId: 'session-new' })),
    createSchedule: vi.fn(async () => ({})),
    deleteSession: vi.fn(async () => undefined)
  };
}

const agentsStore = vi.hoisted(() => ({}) as ReturnType<typeof createAgentsStore>);
vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));

import ScheduleDialog from './ScheduleDialog.svelte';
import { commandPaletteStore } from '$lib/stores/command-palette.svelte';

afterEach(() => {
  cleanup();
  commandPaletteStore.closeSchedule();
});

beforeEach(() => {
  Object.assign(agentsStore, createAgentsStore());
  vi.clearAllMocks();
});

async function openDialog(prefill: Parameters<typeof commandPaletteStore.openSchedule>[0] = { agentId: 'agent-1', cwd: '/home/me/projects/querymt' }) {
  render(ScheduleDialog);
  commandPaletteStore.openSchedule(prefill);
  return await screen.findByRole('dialog');
}

const createButton = () => screen.getByRole('button', { name: 'Create automation' });

describe('ScheduleDialog', () => {
  it('opens with the prompt first and hides the agent select for a single agent', async () => {
    await openDialog();

    expect(screen.getByText('New automation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('What should the agent do each time?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent')).not.toBeInTheDocument();
    expect(screen.getByTestId('schedule-summary')).toHaveTextContent('Every hour');
    // Limits sit beside the footer buttons; with none set there is no summary text.
    const limits = screen.getByRole('button', { name: 'Limits' });
    expect(limits).toHaveTextContent(/^Limits$/);
    expect(limits.closest('footer')).toBeInTheDocument();
    expect(screen.queryByText('No limits')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Max runs')).not.toBeInTheDocument();
  });

  it('keeps Create disabled until there is a prompt and a valid target', async () => {
    await openDialog();
    expect(createButton()).toBeDisabled();

    await fireEvent.input(screen.getByPlaceholderText('What should the agent do each time?'), { target: { value: 'Summarise open PRs' } });
    expect(createButton()).toBeEnabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Minutes' }));
    await fireEvent.input(screen.getByLabelText('Minutes between runs'), { target: { value: '0' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('whole number of minutes');
    expect(createButton()).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Minutes between runs'), { target: { value: '15' } });
    expect(createButton()).toBeEnabled();
  });

  it('disables the cron presets and explains why', async () => {
    await openDialog();

    for (const name of ['Daily', 'Weekdays', 'Custom']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Minutes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Hourly' })).toBeEnabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Why Daily, Weekdays and Custom are disabled' }));
    expect(await screen.findByText(/which the agent does not support yet/)).toBeInTheDocument();
    // The note only says why; cron how-to help belongs to the Custom option itself.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/crontab/i)).not.toBeInTheDocument();
  });

  it('uses the segmented switch style for frequency and target', async () => {
    await openDialog();

    const frequency = screen.getByRole('group', { name: 'Run frequency' });
    expect(frequency).toHaveClass('composer-delivery-switch');
    expect(frequency.querySelectorAll('button')).toHaveLength(5);
    const target = screen.getByRole('group', { name: 'Session target' });
    expect(target).toHaveClass('composer-delivery-switch');
    expect(screen.getByRole('button', { name: 'New session' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(screen.getByRole('button', { name: 'Existing session' }));
    expect(screen.getByRole('button', { name: 'Existing session' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search sessions' })).toBeInTheDocument();
  });

  it('keeps the interval sentence and time zone on separate, labelled controls', async () => {
    await openDialog();
    await fireEvent.click(screen.getByRole('button', { name: 'Minutes' }));

    expect(screen.getByLabelText('Minutes between runs')).toHaveValue(30);
    expect(screen.getByTestId('schedule-summary')).toHaveTextContent('Every 30 minutes');
    expect(screen.getByLabelText('Time zone')).toBeInTheDocument();
  });

  it('defaults to the system time zone and remembers a different choice', async () => {
    localStorage.removeItem('querymt.schedule.timezone');
    const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await openDialog();
    expect(screen.getByLabelText('Time zone')).toHaveTextContent(system);

    const { saveScheduleTimeZone, loadScheduleTimeZone } = await import('$lib/domain/schedule-timezone');
    saveScheduleTimeZone('Asia/Tokyo');
    expect(loadScheduleTimeZone()).toBe('Asia/Tokyo');
    saveScheduleTimeZone('Not/AZone');
    expect(loadScheduleTimeZone()).toBe('Asia/Tokyo');
    localStorage.removeItem('querymt.schedule.timezone');
  });

  it('creates a background session, then the schedule with an interval trigger and limits', async () => {
    await openDialog();
    await fireEvent.input(screen.getByPlaceholderText('What should the agent do each time?'), { target: { value: '  Summarise open PRs ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Minutes' }));
    await fireEvent.input(screen.getByLabelText('Minutes between runs'), { target: { value: '45' } });
    await fireEvent.click(screen.getByText('Limits'));
    await fireEvent.input(screen.getByLabelText('Max runs'), { target: { value: '5' } });

    await fireEvent.click(createButton());

    await waitFor(() => expect(agentsStore.createSchedule).toHaveBeenCalledTimes(1));
    expect(agentsStore.createBackgroundSession).toHaveBeenCalledWith('agent-1', '/home/me/projects/querymt');
    expect(agentsStore.createSchedule).toHaveBeenCalledWith('agent-1', {
      session_id: 'session-new',
      prompt: 'Summarise open PRs',
      trigger: { type: 'interval', seconds: 2700 },
      max_runs: 5
    });
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/automations'));
    expect(commandPaletteStore.scheduleOpen).toBe(false);
    expect(agentsStore.deleteSession).not.toHaveBeenCalled();
  });

  it('attaches to an existing session without creating another one', async () => {
    await openDialog({ agentId: 'agent-1', sessionId: 'session-9', prompt: 'Follow up' });

    expect(screen.getByRole('button', { name: /Existing session/ })).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(createButton());

    await waitFor(() => expect(agentsStore.createSchedule).toHaveBeenCalledTimes(1));
    expect(agentsStore.createBackgroundSession).not.toHaveBeenCalled();
    expect(agentsStore.createSchedule).toHaveBeenCalledWith('agent-1', expect.objectContaining({ session_id: 'session-9', prompt: 'Follow up' }));
  });

  it('removes the session it created when the schedule cannot be created', async () => {
    agentsStore.createSchedule.mockRejectedValueOnce(new Error('Scheduler offline'));
    await openDialog({ agentId: 'agent-1', cwd: '/home/me/projects/querymt', prompt: 'Summarise open PRs' });

    await fireEvent.click(createButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Scheduler offline');
    expect(agentsStore.deleteSession).toHaveBeenCalledWith('agent-1', 'session-new');
    expect(commandPaletteStore.scheduleOpen).toBe(true);
    expect(goto).not.toHaveBeenCalled();
  });

  it('shows the agent reason and copies the full error details', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { RequestError } = await import('@agentclientprotocol/sdk');
    agentsStore.createSchedule.mockRejectedValueOnce(new RequestError(-32602, 'Invalid params', { error: 'missing field `type`' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openDialog({ agentId: 'agent-1', cwd: '/home/me/projects/querymt', prompt: 'Summarise open PRs' });

    await fireEvent.click(createButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid params: missing field `type`');
    await fireEvent.click(screen.getByRole('button', { name: /Copy details/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const report = JSON.parse(writeText.mock.calls[0][0]);
    expect(report).toMatchObject({
      action: 'querymt/schedules/create',
      stage: 'create schedule',
      agentId: 'agent-1',
      request: { session_id: 'session-new', trigger: { type: 'interval', seconds: 3600 } },
      error: { code: -32602, data: { error: 'missing field `type`' } }
    });
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('lets the user dismiss a failed-create error once the details are copied', async () => {
    agentsStore.createSchedule.mockRejectedValueOnce(new Error('Scheduler unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openDialog({ agentId: 'agent-1', cwd: '/home/me/projects/querymt', prompt: 'Run' });

    await fireEvent.click(createButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Scheduler unavailable');

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(commandPaletteStore.scheduleOpen).toBe(true);
  });

  it('reuses a session it could not delete instead of creating another on retry', async () => {
    agentsStore.createSchedule.mockRejectedValueOnce(new Error('Scheduler offline'));
    agentsStore.deleteSession.mockRejectedValueOnce(new Error('Delete unsupported'));
    await openDialog({ agentId: 'agent-1', cwd: '/home/me/projects/querymt', prompt: 'Summarise open PRs' });

    await fireEvent.click(createButton());
    await screen.findByRole('alert');
    await waitFor(() => expect(createButton()).toBeEnabled());
    await fireEvent.click(createButton());

    await waitFor(() => expect(agentsStore.createSchedule).toHaveBeenCalledTimes(2));
    expect(agentsStore.createBackgroundSession).toHaveBeenCalledTimes(1);
    expect(agentsStore.createSchedule).toHaveBeenLastCalledWith('agent-1', expect.objectContaining({ session_id: 'session-new' }));
  });

  it('searches existing sessions by title, session id and workspace', async () => {
    await openDialog({ agentId: 'agent-1', sessionId: null, prompt: 'Run' });
    await fireEvent.click(screen.getByRole('button', { name: /Existing session/ }));

    const search = screen.getByRole('searchbox', { name: 'Search sessions' });
    expect(screen.getAllByRole('option')).toHaveLength(2);

    await fireEvent.input(search, { target: { value: 'release' } });
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([expect.stringContaining('Release notes')]);

    await fireEvent.input(search, { target: { value: 'abc-12' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await fireEvent.input(search, { target: { value: 'projects/querymt' } });
    expect(screen.getByRole('option', { name: /Nightly review/ })).toBeInTheDocument();

    await fireEvent.input(search, { target: { value: 'nothing here' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No sessions match/)).toBeInTheDocument();
  });

  it('picks a searched session with the keyboard without submitting the form', async () => {
    await openDialog({ agentId: 'agent-1', sessionId: null, prompt: 'Run' });
    await fireEvent.click(screen.getByRole('button', { name: /Existing session/ }));
    expect(createButton()).toBeDisabled();

    const search = screen.getByRole('searchbox', { name: 'Search sessions' });
    await fireEvent.input(search, { target: { value: 'release' } });
    await fireEvent.keyDown(search, { key: 'Enter' });

    expect(screen.getByRole('option', { name: /Release notes/ })).toHaveAttribute('aria-selected', 'true');
    expect(createButton()).toBeEnabled();
    expect(agentsStore.createSchedule).not.toHaveBeenCalled();
  });

  it('keeps a single highlighted session row when mouse and arrow keys are mixed', async () => {
    await openDialog({ agentId: 'agent-1', sessionId: null, prompt: 'Run' });
    await fireEvent.click(screen.getByRole('button', { name: /Existing session/ }));

    const rows = () => screen.getAllByRole('option');
    const highlighted = () => rows().filter((row) => row.classList.contains('session-picker-row-highlighted'));
    const search = screen.getByRole('searchbox', { name: 'Search sessions' });

    await fireEvent.mouseMove(rows()[1]);
    expect(highlighted()).toEqual([rows()[1]]);
    await fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(highlighted()).toEqual([rows()[0]]);
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(highlighted()).toHaveLength(1);
  });

  it('explains each limit in a click-to-open help popover', async () => {
    await openDialog();
    await fireEvent.click(screen.getByText('Limits'));

    expect(screen.getByLabelText('Max runs')).toBeInTheDocument();
    expect(screen.getByLabelText('Max steps per run')).toBeInTheDocument();
    expect(screen.getByLabelText('Max cost per run (USD)')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'About max runs' }));
    expect(await screen.findByText(/Stop the automation after it has run this many times/)).toBeInTheDocument();
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await fireEvent.click(screen.getByRole('button', { name: 'About max steps per run' }));
    expect(await screen.findByText(/A step is one model call/)).toBeInTheDocument();
  });

  it('shows an agent select only when several agents can schedule', async () => {
    agentsStore.configs = [...agentsStore.configs, { id: 'agent-2', name: 'Second agent' }];
    agentsStore.statuses = { ...agentsStore.statuses, 'agent-2': { state: 'running' } };
    agentsStore.controlCapabilitiesByAgent = { ...agentsStore.controlCapabilitiesByAgent, 'agent-2': capabilities() };
    await openDialog();

    expect(screen.getByLabelText('Agent')).toBeInTheDocument();
  });

  it('flags invalid limits and blocks creation', async () => {
    await openDialog({ agentId: 'agent-1', cwd: '/home/me/projects/querymt', prompt: 'Run' });

    await fireEvent.click(screen.getByText('Limits'));
    await fireEvent.input(screen.getByLabelText('Max runs'), { target: { value: '0' } });

    expect(await screen.findByText('Enter a whole number of 1 or more.')).toBeInTheDocument();
    expect(screen.getByText('Check the values')).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });
});
