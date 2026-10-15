import type { SessionTokenUsage, SessionUsageBreakdown, SessionUsageStats } from '$lib/domain/types';

const tokenKeys = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const;

function readObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function readTokenUsage(value: unknown, historical = false): SessionTokenUsage | null {
  const object = readObject(value);
  if (!object) return null;
  const wireKeys = historical
    ? ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cache_read', 'cache_write']
    : tokenKeys;
  const result = {} as SessionTokenUsage;
  for (const [index, key] of tokenKeys.entries()) {
    const count = object[wireKeys[index]];
    result[key] = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
  }
  return tokenKeys.some((key) => result[key] !== null) ? result : null;
}

export function readUsageBreakdown(meta: unknown): SessionUsageBreakdown | undefined {
  const payload = readObject(readObject(readObject(meta)?.querymt)?.usage);
  if (!payload || payload.version !== 1 || typeof payload.partial !== 'boolean') return undefined;
  const latestRequest = readTokenUsage(payload.latestRequest);
  const sessionTotals = readTokenUsage(payload.sessionTotals);
  if ((payload.latestRequest !== null && !latestRequest) || (payload.sessionTotals !== null && !sessionTotals)) return undefined;
  return {
    latestRequest,
    sessionTotals,
    partial: payload.partial || [latestRequest, sessionTotals].some((counts) => counts && tokenKeys.some((key) => counts[key] === null))
  };
}

/** Audit events contain disjoint, already-normalized token categories. */
export function appendHistoricalUsage(previous: SessionUsageBreakdown | undefined, value: unknown): SessionUsageBreakdown {
  const latestRequest = readTokenUsage(value, true);
  let sessionTotals = previous?.sessionTotals ?? null;
  if (latestRequest) {
    const totals = {} as SessionTokenUsage;
    for (const key of tokenKeys) {
      const before = sessionTotals?.[key];
      const count = latestRequest[key];
      const sum = (before ?? 0) + (count ?? 0);
      totals[key] = count === null || (sessionTotals !== null && before === null) || !Number.isSafeInteger(sum) ? null : sum;
    }
    sessionTotals = totals;
  }
  return {
    latestRequest,
    sessionTotals,
    partial: previous?.partial === true || latestRequest === null || tokenKeys.some((key) => latestRequest[key] === null)
  };
}

export function getContextPercent(usage: SessionUsageStats): number | null {
  if (usage.contextUsed === null || usage.contextLimit === null || usage.contextLimit <= 0) return null;
  return Math.min(100, Math.max(0, (usage.contextUsed / usage.contextLimit) * 100));
}

export type ContextPressure = 'calm' | 'warm' | 'tight' | 'full';

/** The reading stays quiet until the window is actually under pressure. */
export function getContextPressure(percent: number | null): ContextPressure {
  if (percent === null || percent < 70) return 'calm';
  if (percent < 85) return 'warm';
  if (percent < 95) return 'tight';
  return 'full';
}

export function getContextRemaining(usage: SessionUsageStats): number | null {
  if (usage.contextUsed === null || usage.contextLimit === null) return null;
  return Math.max(0, usage.contextLimit - usage.contextUsed);
}

export function getActiveWorkMs(usage: SessionUsageStats, now = Date.now()): number {
  const liveMs = usage.activeWorkStartedAt === null ? 0 : Math.max(0, now - usage.activeWorkStartedAt);
  return usage.activeWorkMs + liveMs;
}

export function formatTokenCount(tokens: number | null): string {
  if (tokens === null) return '—';
  if (tokens >= 1_000_000) return `${trimDecimal(tokens / 1_000_000)}m`;
  if (tokens >= 1_000) return `${trimDecimal(tokens / 1_000)}k`;
  return Math.round(tokens).toLocaleString('en-US');
}

export function formatCostUsd(cost: number | null): string {
  if (cost === null) return '—';
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function trimDecimal(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
}
