import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SessionUsageBar from './SessionUsageBar.svelte';

const usage = {
  contextUsed: 48_000,
  contextLimit: 200_000,
  cumulativeCostUsd: 0.125,
  activeWorkMs: 62_000,
  activeWorkStartedAt: null
};

function usageBarRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>('.session-usage-bar');
  expect(root).not.toBeNull();
  return root!;
}

afterEach(cleanup);

describe('SessionUsageBar', () => {
  it('renders the full-width context row for the header variant', () => {
    render(SessionUsageBar, { usage, variant: 'context', tone: 1 });

    expect(screen.getByText('48k / 200k')).toBeTruthy();
    expect(screen.getByLabelText('Context window 24% used')).toBeTruthy();
    expect(screen.getByText('24%')).toBeTruthy();
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.queryByText('1m 2s')).toBeNull();

    const root = usageBarRoot();
    expect(root.classList.contains('session-context-tone-1')).toBe(true);
    expect(root.classList.contains('session-usage-variant-context')).toBe(true);
    expect(root.querySelector('.session-usage-meter')).not.toBeNull();
  });

  it('renders cost and active work without a context meter in the popover variant', () => {
    render(SessionUsageBar, { usage, variant: 'stats' });

    expect(screen.getByText('$0.13')).toBeTruthy();
    expect(screen.getByText('1m 2s')).toBeTruthy();
    expect(screen.queryByText('Context')).toBeNull();
    expect(screen.queryByText('48k / 200k')).toBeNull();
    expect(screen.queryByLabelText(/Context window/)).toBeNull();
    expect(document.querySelector('.session-usage-meter')).toBeNull();
  });

  it('keeps the default accent when no tone is provided', () => {
    render(SessionUsageBar, { usage, variant: 'context' });

    expect(usageBarRoot().className).not.toContain('session-context-tone');
  });

  it('uses clear unavailable values before the first usage update', () => {
    render(SessionUsageBar, {
      usage: {
        contextUsed: null,
        contextLimit: null,
        cumulativeCostUsd: null,
        activeWorkMs: 0,
        activeWorkStartedAt: null
      },
      variant: 'context'
    });

    expect(screen.getByText('No usage yet')).toBeTruthy();
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(screen.queryByLabelText(/Context window/)).toBeNull();
    expect(document.querySelector('.session-usage-meter')).toBeNull();
  });

  it('shows the live indicator while prompts are processing', () => {
    render(SessionUsageBar, {
      usage: { ...usage, activeWorkStartedAt: Date.now() - 5_000 },
      variant: 'stats'
    });

    expect(screen.getByLabelText('Active now')).toBeTruthy();
  });
});
