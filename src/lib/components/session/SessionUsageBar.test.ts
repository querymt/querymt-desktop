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

afterEach(cleanup);

describe('SessionUsageBar', () => {
  it('renders context, cost, and active work as text stats without a meter', () => {
    render(SessionUsageBar, { usage });

    expect(screen.getByText('48k / 200k')).toBeTruthy();
    expect(screen.getByText('Context').closest('.session-usage-stat')?.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('$0.13')).toBeTruthy();
    expect(screen.getByText('1m 2s')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(document.querySelector('.session-usage-meter')).toBeNull();
  });

  it('omits the context stat before the first usage update', () => {
    render(SessionUsageBar, {
      usage: {
        contextUsed: null,
        contextLimit: null,
        cumulativeCostUsd: null,
        activeWorkMs: 0,
        activeWorkStartedAt: null
      }
    });

    expect(screen.queryByText('Context')).toBeNull();
    expect(screen.queryByText('No usage yet')).toBeNull();
    expect(screen.getByText('0s')).toBeTruthy();
  });

  it('shows the live indicator while prompts are processing', () => {
    render(SessionUsageBar, {
      usage: { ...usage, activeWorkStartedAt: Date.now() - 5_000 }
    });

    expect(screen.getByLabelText('Active now')).toBeTruthy();
  });
});
