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

  it('surfaces context usage in the header without opening the details popover', () => {
    render(SessionHeader, {
      session: session({ usage: usageFixture }),
      title: 'Visible context',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    expect(document.querySelector('.session-header-context')).not.toBeNull();
    expect(screen.getByText('24k / 100k')).toBeInTheDocument();
    expect(screen.getByLabelText('Context window 24% used')).toBeInTheDocument();
    expect(screen.getByText('24%')).toBeInTheDocument();

    // The popover no longer duplicates the context meter.
    const contextLabels = screen.getAllByText('Context');
    expect(contextLabels).toHaveLength(1);
  });

  it('applies the session mode tone to the header context meter', () => {
    render(SessionHeader, {
      session: session({ usage: usageFixture }),
      title: 'Toned context',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now',
      contextTone: 3
    });

    const bar = document.querySelector<HTMLElement>('.session-header-context .session-usage-bar');
    expect(bar).not.toBeNull();
    expect(bar!.classList.contains('session-context-tone-3')).toBe(true);
  });

  it('keeps cost and active time inside the details popover', async () => {
    render(SessionHeader, {
      session: session({ usage: usageFixture }),
      title: 'Popover stats',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    await fireEvent.click(screen.getByLabelText('Session details'));
    const panel = document.querySelector<HTMLElement>('.session-header-details-panel');
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText('$0.05')).toBeInTheDocument();
    expect(within(panel!).getByText('12s')).toBeInTheDocument();
    // The popover carries stats only; the context meter lives in the header row.
    expect(panel!.querySelector('.session-usage-meter')).toBeNull();
    expect(panel!.querySelector('.session-usage-context')).toBeNull();
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

  it('keeps header actions available and context always visible', async () => {
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
    expect(screen.getByText('24k / 100k')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
    await fireEvent.click(screen.getByLabelText('Session details'));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText('$0.05')).toBeInTheDocument();
  });
});
