import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SessionUsageBar from './SessionUsageBar.svelte';

afterEach(cleanup);

describe('SessionUsageBar', () => {
  it('renders context consumption, cumulative cost, and active work time', () => {
    render(SessionUsageBar, {
      usage: {
        contextUsed: 48_000,
        contextLimit: 200_000,
        cumulativeCostUsd: 0.125,
        activeWorkMs: 62_000,
        activeWorkStartedAt: null
      }
    });

    expect(screen.getByText('48k / 200k')).toBeTruthy();
    expect(screen.getByLabelText('Context window 24% used')).toBeTruthy();
    expect(screen.getByText('$0.13')).toBeTruthy();
    expect(screen.getByText('1m 2s')).toBeTruthy();
  });

  it('uses clear unavailable values before the first usage update', () => {
    render(SessionUsageBar, {
      usage: {
        contextUsed: null,
        contextLimit: null,
        cumulativeCostUsd: null,
        activeWorkMs: 0,
        activeWorkStartedAt: null
      }
    });

    expect(screen.getByText('No usage yet')).toBeTruthy();
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.getByText('0s')).toBeTruthy();
  });
});
