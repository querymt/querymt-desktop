import { describe, expect, it } from 'vitest';
import type { SessionUsageStats } from '$lib/domain/types';
import {
  formatCostUsd,
  formatDuration,
  formatTokenCount,
  getActiveWorkMs,
  getContextPercent
} from './session-usage';

const usage: SessionUsageStats = {
  contextUsed: 48_000,
  contextLimit: 200_000,
  cumulativeCostUsd: 0.0042,
  activeWorkMs: 30_000,
  activeWorkStartedAt: null
};

describe('session usage formatting', () => {
  it('formats context, cost, and duration for compact status display', () => {
    expect(getContextPercent(usage)).toBe(24);
    expect(formatTokenCount(48_000)).toBe('48k');
    expect(formatTokenCount(1_250_000)).toBe('1.3m');
    expect(formatCostUsd(0.0042)).toBe('$0.0042');
    expect(formatCostUsd(1.25)).toBe('$1.25');
    expect(formatDuration(3_725_000)).toBe('1h 2m');
  });

  it('adds an open live span to completed active time', () => {
    expect(getActiveWorkMs({ ...usage, activeWorkStartedAt: 10_000 }, 14_500)).toBe(34_500);
  });
});
