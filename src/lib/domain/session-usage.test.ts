import { describe, expect, it } from 'vitest';
import type { SessionUsageStats } from '$lib/domain/types';
import {
  appendHistoricalUsage,
  readTokenUsage,
  readUsageBreakdown,
  formatCostUsd,
  formatDuration,
  formatTokenCount,
  getActiveWorkMs,
  getContextPercent,
  getContextPressure,
  getContextRemaining
} from './session-usage';

const usage: SessionUsageStats = {
  contextUsed: 48_000,
  contextLimit: 200_000,
  cumulativeCostUsd: 0.0042,
  activeWorkMs: 30_000,
  activeWorkStartedAt: null
};

describe('session usage breakdown', () => {
  it('distinguishes reported zero from missing and invalid token counts', () => {
    expect(readTokenUsage({ inputTokens: 0, outputTokens: -1, reasoningTokens: Infinity, cacheReadTokens: 1.5 })).toEqual({
      inputTokens: 0, outputTokens: null, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null
    });
    expect(readTokenUsage({ inputTokens: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(readUsageBreakdown({ querymt: { usage: { version: 1, partial: false,
      latestRequest: { inputTokens: 0 }, sessionTotals: null } } })?.partial).toBe(true);
  });

  it('aggregates exclusive categories and marks unreported requests as partial', () => {
    const raw = { input_tokens: 75, output_tokens: 162, reasoning_tokens: 1024, cache_read: 0, cache_write: 0 };
    const first = appendHistoricalUsage(undefined, raw);
    const second = appendHistoricalUsage(first, raw);
    expect(second.sessionTotals).toEqual({ inputTokens: 150, outputTokens: 324, reasoningTokens: 2048, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(second.partial).toBe(false);
    const missing = appendHistoricalUsage(second, undefined);
    expect(missing.latestRequest).toBeNull();
    expect(missing.sessionTotals).toEqual(second.sessionTotals);
    expect(missing.partial).toBe(true);
  });
});

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

  it('keeps context pressure quiet until the window is actually tight', () => {
    expect(getContextPressure(null)).toBe('calm');
    expect(getContextPressure(69.9)).toBe('calm');
    expect(getContextPressure(70)).toBe('warm');
    expect(getContextPressure(84.9)).toBe('warm');
    expect(getContextPressure(85)).toBe('tight');
    expect(getContextPressure(94.9)).toBe('tight');
    expect(getContextPressure(95)).toBe('full');
    expect(getContextRemaining(usage)).toBe(152_000);
    expect(getContextRemaining({ ...usage, contextLimit: null })).toBeNull();
  });
});
