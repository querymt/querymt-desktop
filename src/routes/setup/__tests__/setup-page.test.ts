import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadinessCheck, ReadinessReport } from '$lib/domain/readiness';

const goto = vi.hoisted(() => vi.fn(async () => undefined));

function report(statuses: Partial<Record<ReadinessCheck['id'], ReadinessCheck['status']>> = {}): ReadinessReport {
  const ids: ReadinessCheck['id'][] = ['agent', 'providers', 'models', 'model'];
  const checks = ids.map((id) => ({
    id,
    title: id,
    status: statuses[id] ?? 'ok',
    reason: statuses[id] && statuses[id] !== 'ok' ? `${id} problem` : null,
    action: statuses[id] === 'blocked' && id === 'agent' ? { kind: 'retry-agent' as const, agentId: 'agent-1' } : null
  }));
  return { agentId: 'agent-1', checks, setupComplete: checks.every((c) => c.status === 'ok' || c.status === 'not_applicable') };
}

const agentsStore = vi.hoisted(() => ({
  readiness: null as unknown as ReadinessReport,
  primaryAgentId: 'agent-1',
  configs: [{ id: 'agent-1', name: 'QMTCODE', transport: 'stdio', commandLine: 'qmtcode --acp', enabled: true, autoStart: true }],
  statuses: { 'agent-1': { agentId: 'agent-1', state: 'running', version: '1.2.3', programSource: 'bundled' } } as Record<string, unknown>,
  authProvidersByAgent: {} as Record<string, unknown[]>,
  controlCapabilitiesByAgent: {} as Record<string, unknown>,
  modelsByAgent: { 'agent-1': [] } as Record<string, unknown[]>,
  modelInfoByAgent: {},
  modelLoadingByAgent: {},
  getRecentModels: vi.fn(() => []),
  getLaunchModelId: vi.fn(() => ''),
  chooseLaunchModel: vi.fn(),
  refreshModelsForAgent: vi.fn(),
  restartConfiguredAgent: vi.fn(async () => undefined),
  startConfiguredAgent: vi.fn(async () => undefined),
  refreshAgent: vi.fn(async () => undefined),
  createConfig: vi.fn((name: string, transport: string, endpoint: string) => ({ id: 'new-agent', name, transport, commandLine: endpoint, enabled: true, autoStart: true })),
  saveConfig: vi.fn(),
  updateConfig: vi.fn(),
  requestPromptFocus: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));
vi.mock('$lib/stores/appearance.svelte', () => ({
  ACCENT_PRESETS: [{ id: 'orange', label: 'Orange', light: '#f97316', dark: '#fb923c' }],
  appearanceStore: { initialize: vi.fn(), themeMode: 'system', accent: 'orange', resolvedTheme: 'dark', setThemeMode: vi.fn(), setAccentColor: vi.fn() }
}));

import SetupPage from '../+page.svelte';
import { ONBOARDING_STORAGE_KEY } from '$lib/domain/onboarding';

beforeEach(() => {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  agentsStore.readiness = report();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const onboarding = () => JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? 'null');

describe('setup wizard', () => {
  it('shows the steps in order with the boot mark', () => {
    render(SetupPage);
    const steps = screen.getByRole('list', { name: 'Setup progress' });
    expect(steps).toHaveTextContent(/Welcome.*Appearance.*Agent.*Providers.*Model.*Done/);
    expect(screen.getByTestId('boot-mark')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome to QueryMT' })).toBeInTheDocument();
  });

  it('offers theme and accent on the Appearance step', async () => {
    render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Application theme' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Accent color' })).toBeInTheDocument();
  });

  it('skips the whole wizard and records it', async () => {
    render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(onboarding()).toMatchObject({ skippedAt: expect.any(String), completedAt: null });
    expect(goto).toHaveBeenCalledWith('/');
  });

  it('shows agent failures with retry', async () => {
    agentsStore.readiness = report({ agent: 'blocked', providers: 'not_applicable', models: 'not_applicable', model: 'not_applicable' });
    render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('agent problem');
    expect(screen.getByTestId('boot-mark')).toHaveAttribute('data-state', 'failed');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(agentsStore.restartConfiguredAgent).toHaveBeenCalledWith('agent-1');
  });

  it('adds and starts an agent inside the wizard when none is configured', async () => {
    const base = report({ agent: 'blocked', providers: 'not_applicable', models: 'not_applicable', model: 'not_applicable' });
    agentsStore.readiness = {
      ...base,
      agentId: null,
      checks: base.checks.map((c) => (c.id === 'agent' ? { ...c, reason: 'No agent is configured.', action: { kind: 'open-agents' as const } } : c))
    };
    render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('link', { name: 'Open Agents' })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add agent' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('qmtcode --acp')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Add and start agent' }));
    await vi.waitFor(() => expect(agentsStore.startConfiguredAgent).toHaveBeenCalledWith('new-agent'));
    expect(agentsStore.createConfig).toHaveBeenCalledWith('QMTCODE', 'stdio', 'qmtcode --acp');
    expect(agentsStore.saveConfig).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Agent' })).toBeInTheDocument();
  });

  it('edits and restarts a failing agent inside the wizard', async () => {
    agentsStore.readiness = report({ agent: 'blocked', providers: 'not_applicable', models: 'not_applicable', model: 'not_applicable' });
    render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }));
    const command = screen.getByDisplayValue('qmtcode --acp');
    await fireEvent.input(command, { target: { value: '/opt/qmtcode --acp' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save and restart' }));
    await vi.waitFor(() => expect(agentsStore.restartConfiguredAgent).toHaveBeenCalledWith('agent-1'));
    expect(agentsStore.updateConfig).toHaveBeenCalledWith('agent-1', expect.objectContaining({ commandLine: '/opt/qmtcode --acp' }));
  });

  it('animates the boot mark while the agent is starting', async () => {
    agentsStore.readiness = report({ agent: 'pending', providers: 'not_applicable', models: 'not_applicable', model: 'not_applicable' });
    render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('progressbar', { name: 'Connecting to QueryMT' })).toBeInTheDocument();
    expect(screen.getByTestId('setup-boot-log')).toHaveTextContent('Starting agent…');
  });

  it('lists skipped steps on Done and finishes onto the start screen', async () => {
    agentsStore.readiness = report({ providers: 'blocked', models: 'blocked', model: 'not_applicable' });
    render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('heading', { name: 'Choose a model' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    const summary = screen.getByTestId('setup-summary');
    expect(summary.querySelector('[data-check="providers"]')).toHaveTextContent('Skipped, not set up');
    expect(summary.querySelector('[data-check="agent"]')).toHaveTextContent('Ready');
    await fireEvent.click(screen.getByRole('button', { name: 'Start using QueryMT' }));
    expect(onboarding()).toMatchObject({ completedAt: expect.any(String) });
    expect(goto).toHaveBeenCalledWith('/');
    expect(agentsStore.requestPromptFocus).toHaveBeenCalled();
  });

  it('enables Continue on Providers once a provider is connected', async () => {
    agentsStore.readiness = report({ providers: 'blocked' });
    const view = render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    view.unmount();
    agentsStore.readiness = report();
    render(SetupPage);
    await fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});
