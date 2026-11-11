import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpdatePrompt from './UpdatePrompt.svelte';

const openExternalUrl = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$native', () => ({ openExternalUrl }));

const updatesStore = vi.hoisted(() => ({
  prompt: null as Record<string, unknown> | null,
  progress: null as { received: number; total: number | null } | null,
  actionError: null as string | null,
  state: { kind: 'idle' } as Record<string, unknown>,
  install: vi.fn(async () => {}),
  restart: vi.fn(async () => {}),
  later: vi.fn(),
  skip: vi.fn(async () => {})
}));
vi.mock('$lib/stores/updates.svelte', () => ({ updatesStore }));

const available = (overrides: Record<string, unknown> = {}) => ({
  kind: 'available',
  version: '0.1.11',
  notes: null,
  date: null,
  qmtcodeVersion: '0.5.3',
  canInstall: true,
  releaseUrl: 'https://github.com/querymt/querymt-desktop/releases/tag/v0.1.11',
  skipped: false,
  ...overrides
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  updatesStore.prompt = null;
  updatesStore.progress = null;
  updatesStore.actionError = null;
  updatesStore.state = { kind: 'idle' };
});

describe('UpdatePrompt', () => {
  it('renders nothing without a pending update', () => {
    render(UpdatePrompt);
    expect(screen.queryByRole('region', { name: 'Update available' })).not.toBeInTheDocument();
  });

  it('self-install variant installs and then restarts', async () => {
    updatesStore.prompt = available();
    updatesStore.install.mockImplementationOnce(async () => {
      updatesStore.state = { kind: 'installed', version: '0.1.11' };
    });
    render(UpdatePrompt);

    expect(screen.getByText('QueryMT 0.1.11 is available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View release' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Install & restart' }));
    await waitFor(() => expect(updatesStore.restart).toHaveBeenCalled());
    expect(updatesStore.install).toHaveBeenCalled();
  });

  it('does not restart when the install failed', async () => {
    updatesStore.prompt = available();
    render(UpdatePrompt);

    await fireEvent.click(screen.getByRole('button', { name: 'Install & restart' }));
    await waitFor(() => expect(updatesStore.install).toHaveBeenCalled());
    expect(updatesStore.restart).not.toHaveBeenCalled();
  });

  it('postpones with Later and skips with Skip this version', async () => {
    updatesStore.prompt = available();
    render(UpdatePrompt);

    await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(updatesStore.later).toHaveBeenCalledWith('0.1.11');

    await fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }));
    expect(updatesStore.skip).toHaveBeenCalledWith('0.1.11');
  });

  it('notify-only variant links to the release instead of installing', async () => {
    updatesStore.prompt = available({ canInstall: false });
    render(UpdatePrompt);

    expect(screen.queryByRole('button', { name: 'Install & restart' })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot update itself/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'View release' }));
    expect(openExternalUrl).toHaveBeenCalledWith(
      'https://github.com/querymt/querymt-desktop/releases/tag/v0.1.11'
    );
    expect(updatesStore.install).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip this version' })).toBeInTheDocument();
  });

  it('shows download progress while installing', () => {
    updatesStore.prompt = { kind: 'installing', version: '0.1.11' };
    updatesStore.progress = { received: 25, total: 100 };
    render(UpdatePrompt);

    const bar = screen.getByRole('progressbar', { name: 'Download progress' });
    expect(bar).toHaveAttribute('value', '25');
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install & restart' })).not.toBeInTheDocument();
  });

  it('offers Restart now once installed, and shows restart failures', async () => {
    updatesStore.prompt = { kind: 'installed', version: '0.1.11' };
    updatesStore.actionError = 'The app could not restart.';
    render(UpdatePrompt);

    expect(screen.getByRole('alert')).toHaveTextContent('The app could not restart.');
    await fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(updatesStore.restart).toHaveBeenCalled();
  });
});
