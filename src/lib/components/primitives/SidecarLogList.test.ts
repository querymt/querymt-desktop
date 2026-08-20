import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SidecarLogList from './SidecarLogList.svelte';

const logs = [
  { stream: 'system' as const, timestamp: '1787229500', message: 'Agent process started' },
  { stream: 'stderr' as const, timestamp: '2026-08-20T13:31:41Z', message: 'Loading profile default' },
  { stream: 'stdout' as const, timestamp: '2026-08-20T13:31:42Z', message: 'Agent ready' }
];

describe('SidecarLogList', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders dense readable log rows with formatted timestamps', () => {
    render(SidecarLogList, { props: { logs, showHeader: false } });

    expect(screen.getByRole('log', { name: 'Agent logs' })).toBeInTheDocument();
    expect(screen.getByText('Agent process started')).toBeInTheDocument();
    expect(screen.queryByText('1787229500')).not.toBeInTheDocument();
    expect(screen.getAllByText(/\d{2}:\d{2}:\d{2}/)).toHaveLength(3);
  });

  it('filters by search text and stream', async () => {
    render(SidecarLogList, { props: { logs, showHeader: false } });

    await fireEvent.input(screen.getByRole('textbox', { name: 'Search logs' }), { target: { value: 'agent' } });
    expect(screen.getByText('Agent process started')).toBeInTheDocument();
    expect(screen.getByText('Agent ready')).toBeInTheDocument();
    expect(screen.queryByText('Loading profile default')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Stdout' }));
    expect(screen.queryByText('Agent process started')).not.toBeInTheDocument();
    expect(screen.getByText('Agent ready')).toBeInTheDocument();
  });

  it('copies the complete unfiltered log set with one action', async () => {
    render(SidecarLogList, { props: { logs, showHeader: false } });

    await fireEvent.input(screen.getByRole('textbox', { name: 'Search logs' }), { target: { value: 'ready' } });
    expect(screen.queryByText('Agent process started')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy log entry/ })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Copy all logs' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('[SYSTEM] Agent process started'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('[STDOUT] Agent ready'));
  });

  it('toggles line wrapping', async () => {
    render(SidecarLogList, { props: { logs, showHeader: false } });

    const wrapButton = screen.getByRole('button', { name: 'Disable line wrapping' });
    expect(wrapButton).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(wrapButton);
    expect(screen.getByRole('button', { name: 'Wrap lines' })).toHaveAttribute('aria-pressed', 'false');
  });
});
