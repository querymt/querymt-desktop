import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionHeader from './SessionHeader.svelte';
import { session } from './session-fixture';

const usageFixture = {
  contextUsed: 24_000,
  contextLimit: 100_000,
  cumulativeCostUsd: 0.05,
  activeWorkMs: 12_000,
  activeWorkStartedAt: null
};

afterEach(cleanup);

describe('SessionHeader', () => {
  it('presents session identity and a compact ready state', () => {
    render(SessionHeader, {
      session: session(),
      title: 'Refine session hierarchy',
      workspace: 'querymt-desktop',
      agentName: 'QMTCODE',
      updatedAt: 'Just now'
    });

    const metadata = document.querySelector<HTMLElement>('.session-header-meta');
    const mobileContext = screen.getByLabelText('Session context');
    expect(metadata).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Refine session hierarchy' })).toBeInTheDocument();
    expect(within(metadata!).getByText('querymt-desktop')).toHaveClass('copy-chip-label');
    expect(metadata!.querySelector('.session-header-workspace')).not.toBeNull();
    expect(within(metadata!).getByText('QMTCODE')).toBeInTheDocument();
    expect(within(mobileContext).getByText('querymt-desktop')).toBeInTheDocument();
    expect(within(mobileContext).getByText('session-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Status: Ready')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
  });

  it('shows a short session id chip that copies the full id', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });
    render(SessionHeader, {
      session: session({ sessionId: '01a072b3-a266-4c5d-8e9f-102030405060' }),
      title: 'Chip test',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    const metadata = document.querySelector<HTMLElement>('.session-header-meta');
    expect(metadata).not.toBeNull();
    const chip = within(metadata!).getByRole('button', { name: 'Copy session ID' });
    expect(chip).toHaveTextContent('01a072b3-a266');
    await fireEvent.click(chip);

    expect(writeText).toHaveBeenCalledWith('01a072b3-a266-4c5d-8e9f-102030405060');
    // The copied confirmation overlays the id instead of replacing it, so the chip keeps its width.
    expect(within(chip).getByText('01a072b3-a266')).toBeInTheDocument();
    expect(within(chip).getByRole('status')).toHaveTextContent('copied');
  });

  it('hides the session id chip while no session is loaded', () => {
    render(SessionHeader, {
      session: session({ sessionId: null }),
      title: 'Unloaded test',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    expect(screen.queryByRole('button', { name: 'Copy session ID' })).not.toBeInTheDocument();
  });

  it('makes complete session metadata available from the compact details popover', async () => {
    render(SessionHeader, {
      session: session({ sessionId: '01a072b3-a266-4c5d-8e9f-102030405060' }),
      title: 'Mobile details test',
      workspace: 'querymt-desktop',
      workspacePath: '/projects/querymt-org/querymt-desktop',
      agentName: 'QMTCODE',
      profileLabel: 'Default',
      updatedAt: 'Just now'
    });

    await fireEvent.click(screen.getByLabelText('Session details'));
    const panel = document.querySelector<HTMLElement>('.session-header-details-panel');
    const details = document.querySelector<HTMLElement>('.session-header-mobile-details');
    expect(panel).not.toBeNull();
    expect(details).not.toBeNull();
    expect(within(panel!).getByText('Ready')).toBeInTheDocument();
    expect(within(details!).getByText('querymt-desktop')).toBeInTheDocument();
    expect(within(details!).getByText('QMTCODE')).toBeInTheDocument();
    expect(within(details!).getByText('Default')).toBeInTheDocument();
    expect(within(details!).getByText('Just now')).toBeInTheDocument();
    expect(within(details!).getByRole('button', { name: 'Copy session ID' })).toHaveTextContent('01a072b3-a266');
  });

  it('collapses session details on outside clicks but keeps the trigger toggle', async () => {
    render(SessionHeader, {
      session: session(),
      title: 'Outside click test',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    const summary = screen.getByLabelText('Session details');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');

    await fireEvent.click(summary);
    expect(details).toHaveAttribute('open');

    // Pointer downs inside the panel keep it open.
    await fireEvent.mouseDown(screen.getByText('Session'));
    expect(details).toHaveAttribute('open');

    await fireEvent.mouseDown(document.body);
    expect(details).not.toHaveAttribute('open');

    // The trigger still toggles the popover natively.
    await fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    await fireEvent.click(summary);
    expect(details).not.toHaveAttribute('open');
  });

  it('moves usage into session details and exposes header actions', async () => {
    const onBack = vi.fn();
    const onRefresh = vi.fn();
    render(SessionHeader, {
      session: session({ runState: 'thinking', usage: usageFixture }),
      title: 'Active task',
      workspace: 'querymt-desktop',
      agentName: 'QMTCODE',
      updatedAt: 'Just now',
      onBack,
      onRefresh
    });

    expect(screen.getByLabelText('Status: Working')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
    await fireEvent.click(screen.getByLabelText('Session details'));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText('24k / 100k')).toBeInTheDocument();
    expect(screen.getByText('$0.05')).toBeInTheDocument();
  });
});
