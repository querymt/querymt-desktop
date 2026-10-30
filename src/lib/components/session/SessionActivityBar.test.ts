import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SessionActivityBar from './SessionActivityBar.svelte';
import { session } from './session-fixture';

afterEach(cleanup);

describe('SessionActivityBar', () => {
  it('stays out of the conversation when the session is idle', () => {
    render(SessionActivityBar, { session: session() });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows focused feedback while the agent is working', () => {
    render(SessionActivityBar, { session: session({ runState: 'thinking', activityLabel: 'Reviewing files…' }) });

    expect(screen.getByRole('status')).toHaveTextContent('Reviewing files…');
    expect(screen.getByRole('status')).not.toHaveTextContent('Double Esc to cancel');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it.each(['hover', 'focus'] as const)('shows the shared styled cancel tooltip on bar %s without a button or native title', async (intent) => {
    render(SessionActivityBar, { session: session({ runState: 'tool-running' }) });
    const bar = screen.getByRole('status');
    expect(bar.tagName).toBe('SECTION');
    expect(bar).toHaveAttribute('aria-live', 'polite');
    expect(bar).toHaveAttribute('tabindex', '0');
    expect(bar).not.toHaveAttribute('title');
    expect(bar).not.toHaveTextContent('Double Esc to cancel');
    expect(screen.queryByText('Double Esc to cancel')).not.toBeInTheDocument();
    if (intent === 'hover') await fireEvent.pointerEnter(bar, { pointerType: 'mouse' });
    else bar.focus();
    const tooltip = await screen.findByText('Double Esc to cancel', { selector: '.app-tooltip-content' });
    expect(tooltip).toHaveAttribute('data-tooltip-content');
    expect(tooltip).toHaveClass('app-tooltip-content');
    expect(bar).toHaveAttribute('aria-describedby', tooltip.id);
    expect(bar.contains(tooltip)).toBe(false);
    expect(tooltip.closest('[data-bits-floating-content-wrapper]')?.parentElement).toBe(document.body);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const escapes: KeyboardEvent[] = [];
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') escapes.push(event); };
    window.addEventListener('keydown', onKeyDown);
    try {
      await fireEvent.keyDown(bar, { key: 'Escape' });
      await fireEvent.keyDown(bar, { key: 'Escape' });
      expect(escapes).toHaveLength(2);
      // Tooltip dismissal prevents the first key's default but both keys still reach the app listener.
      expect(escapes.map((event) => event.defaultPrevented)).toEqual([true, false]);
    } finally {
      window.removeEventListener('keydown', onKeyDown);
    }
  });

  it.each(['dependency', 'undo', 'fork', 'unknown', 'failure', 'input'] as const)('suppresses cancel hint for %s while retaining guidance and live-region roles', async (mode) => {
    const value = session({ runState: mode === 'unknown' ? 'unknown' : mode === 'failure' ? 'failed' : mode === 'input' ? 'waiting-input' : mode === 'dependency' ? 'completed' : 'thinking',
      dependencyLabel: mode === 'dependency' ? 'Verifying delegate result' : null });
    if (mode === 'undo') value.undo.pendingOperation = 'undo';
    render(SessionActivityBar, { session: value, forkPending: mode === 'fork' });
    const bar = screen.getByRole(mode === 'failure' ? 'alert' : 'status');
    expect(bar).not.toHaveAttribute('title');
    expect(bar).not.toHaveAttribute('tabindex', '0');
    await fireEvent.pointerEnter(bar, { pointerType: 'mouse' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.queryByText('Double Esc to cancel')).not.toBeInTheDocument();
    if (mode === 'failure') expect(bar).toHaveTextContent('Review the error, update the prompt, or refresh.');
    if (mode === 'input') expect(bar).toHaveTextContent('Respond below to continue.');
  });

  it('leaves stopping to the composer stop button instead of an inline cancel control', () => {
    render(SessionActivityBar, { session: session({ runState: 'streaming' }) });

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('shows the active semantic tool and preview without duplicate shimmer content', () => {
    render(SessionActivityBar, {
      session: session({
        runState: 'tool-running',
        activeToolCallId: 'shell-1',
        toolCalls: [
          {
            id: 'shell-1',
            title: 'Run shell',
            kind: 'shell',
            status: 'in_progress',
            arguments: '{"command":"bun","args":["run","check"]}'
          }
        ]
      })
    });

    expect(screen.getByRole('status')).toHaveTextContent('Run command · bun run check');
    expect(screen.getByRole('status').querySelector('.session-activity-shimmer')).not.toBeInTheDocument();
  });

  it('announces failures as alerts', () => {
    render(SessionActivityBar, { session: session({ runState: 'failed', lastError: 'shell failed.' }) });

    expect(screen.getByRole('alert')).toHaveTextContent('Failed: shell failed.');
  });
});
