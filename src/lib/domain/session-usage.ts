import type { SessionUsageStats } from '$lib/domain/types';

export function getContextPercent(usage: SessionUsageStats): number | null {
  if (usage.contextUsed === null || usage.contextLimit === null || usage.contextLimit <= 0) return null;
  return Math.min(100, Math.max(0, (usage.contextUsed / usage.contextLimit) * 100));
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
