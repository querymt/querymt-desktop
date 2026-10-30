import type { AccountingSnapshot } from '$lib/querymt/generated/types';
import { describe, expect, it } from 'vitest';
import type { SessionUsageStats } from '$lib/domain/types';
import {
  appendHistoricalUsage,
  readTokenUsage,
  readUsageBreakdown,
  formatCostUsd,
  getSessionCostDisplay,
  getCostLines,
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
  standardCostUsd: null,
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

  it('falls back to standard cost only when no accounting exists', () => {
    expect(getSessionCostDisplay(undefined, null)).toEqual({ kind: 'none' });
    expect(getSessionCostDisplay(undefined, 0.5)).toEqual({ kind: 'reported', amountUsd: 0.5 });
    const cleared = { version: 1, cycle: null, session: {
      knownSubtotalUsd: 0.05, completeTotalUsd: null, complete: false, billing: 'metered', reasons: [{ kind: 'partial_usage' }],
      pricedAttempts: 1, excludedAttempts: 0, unresolvedAttempts: 0, incompleteAttempts: 1, unaccountedGenerations: 0
    } } as unknown as AccountingSnapshot;
    expect(getSessionCostDisplay(cleared, 0.5)).toMatchObject({ kind: 'incomplete', knownSubtotalUsd: 0.05 });
  });
});

describe('cost lines', () => {
  const budget = (overrides: Record<string, unknown> = {}) => ({
    knownSubtotalUsd: 0.2, completeTotalUsd: 0.2, reasons: [], incompleteAttempts: 0, bestEffort: false, ...overrides
  }) as never;

  it('renders one dense line per cost state', () => {
    expect(getCostLines({ kind: 'none' }, null)).toEqual([]);
    expect(getCostLines({ kind: 'estimated', amountUsd: 0.125, excludesSubscription: false }, null)).toMatchObject([
      { key: 'cost', label: 'API cost', value: '$0.13' }
    ]);
    expect(getCostLines({ kind: 'estimated', amountUsd: 0.125, excludesSubscription: true }, null)[0]).toMatchObject({
      label: 'API cost (excl. subscription)', value: '$0.13'
    });
    expect(getCostLines({ kind: 'reported', amountUsd: 0.42 }, null)[0]).toMatchObject({ label: 'Agent-reported cost', value: '$0.42' });
    expect(getCostLines({ kind: 'excluded' }, null)[0]).toMatchObject({ label: 'API cost', value: 'Subscription', tone: 'muted' });
  });

  it('marks incomplete totals as a lower bound with reasons in the title', () => {
    const [line] = getCostLines({ kind: 'incomplete', knownSubtotalUsd: 0.05, reasons: ['No cache write rate is configured'], excludesSubscription: false }, null);
    expect(line).toMatchObject({ prefix: '≥', tone: 'warn', value: '$0.05' });
    expect(line.title).toContain('At least $0.05');
    expect(line.title).toContain('No cache write rate is configured');
    const [unknown] = getCostLines({ kind: 'incomplete', knownSubtotalUsd: 0, reasons: [], excludesSubscription: true }, null);
    expect(unknown.title).toContain('some charges are unknown');
    expect(unknown.title).toContain('Subscription usage is excluded');
  });

  it('adds the cycle budget and marks best-effort valuations as approximate', () => {
    const none = { kind: 'none' } as const;
    expect(getCostLines(none, budget())).toMatchObject([{ key: 'budget', label: 'Cycle budget', value: '$0.20', prefix: undefined }]);
    const [best] = getCostLines(none, budget({ completeTotalUsd: null, bestEffort: true, knownSubtotalUsd: 0.3 }));
    expect(best).toMatchObject({ value: '$0.30', prefix: '~' });
    expect(best.title).toContain('best-effort');
    expect(getCostLines(none, budget({ knownSubtotalUsd: 0, completeTotalUsd: 0 }))).toEqual([]);
  });
});
