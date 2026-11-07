import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadinessReport } from '$lib/domain/readiness';

const goto = vi.hoisted(() => vi.fn(async () => undefined));
const agentsStore = vi.hoisted(() => ({ restartConfiguredAgent: vi.fn(async () => undefined), refreshModelsForAgent: vi.fn(async () => undefined) }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/stores/agents.svelte', () => ({ agentsStore }));

import SetupChecklist from './SetupChecklist.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const report: ReadinessReport = {
  agentId: 'a',
  setupComplete: false,
  checks: [
    { id: 'agent', title: 'Agent', status: 'ok', reason: null, action: null },
    { id: 'providers', title: 'Providers', status: 'blocked', reason: 'No provider is connected.', action: { kind: 'open-providers', agentId: 'a' } },
    { id: 'models', title: 'Models', status: 'pending', reason: 'Loading models…', action: null },
    { id: 'model', title: 'Model', status: 'not_applicable', reason: null, action: null }
  ]
};

describe('SetupChecklist', () => {
  it('lists only open checks with their fix action', async () => {
    render(SetupChecklist, { report });
    const card = screen.getByTestId('setup-checklist');
    expect(card.querySelector('[data-check="agent"]')).toBeNull();
    expect(card.querySelector('[data-check="model"]')).toBeNull();
    expect(card).toHaveTextContent('No provider is connected.');
    expect(card).toHaveTextContent('Loading models…');
    expect(screen.getByRole('link', { name: 'Run setup' })).toHaveAttribute('href', '/setup');
    await fireEvent.click(screen.getByRole('button', { name: 'Connect provider' }));
    expect(goto).toHaveBeenCalledWith('/settings?section=providers');
  });

  it('renders nothing when setup is complete', () => {
    render(SetupChecklist, { report: { ...report, setupComplete: true, checks: report.checks.map((c) => ({ ...c, status: 'ok' as const })) } });
    expect(screen.queryByTestId('setup-checklist')).toBeNull();
  });

  it('retries a failed agent', async () => {
    render(SetupChecklist, {
      report: { ...report, checks: [{ id: 'agent', title: 'Agent', status: 'blocked', reason: 'boom', action: { kind: 'retry-agent', agentId: 'a' } }] }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(agentsStore.restartConfiguredAgent).toHaveBeenCalledWith('a');
  });
});
