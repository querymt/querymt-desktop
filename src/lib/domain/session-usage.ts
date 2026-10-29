import type { SessionTokenUsage, SessionUsageBreakdown, SessionUsageStats } from '$lib/domain/types';
import type {
  AccountingBillingScope,
  AccountingBudgetSnapshot,
  AccountingScopeSnapshot,
  AccountingSnapshot
} from '$lib/querymt/generated/types';

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

const billingScopes = new Set<string>(['empty', 'metered', 'excluded', 'mixed']);

function readAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readReasons(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  return value.every((reason) => readObject(reason) !== null) ? value as Array<Record<string, unknown>> : null;
}

/** `completeTotalUsd` must be present: an explicit `null` clears, omission is malformed. */
function readCompleteTotal(object: Record<string, unknown>): number | null | undefined {
  if (!('completeTotalUsd' in object)) return undefined;
  if (object.completeTotalUsd === null) return null;
  return readAmount(object.completeTotalUsd) ?? undefined;
}

function readScope(value: unknown): AccountingScopeSnapshot | null {
  const object = readObject(value);
  if (!object) return null;
  const knownSubtotalUsd = readAmount(object.knownSubtotalUsd);
  const completeTotalUsd = readCompleteTotal(object);
  const reasons = readReasons(object.reasons);
  const counts = ['pricedAttempts', 'excludedAttempts', 'unresolvedAttempts', 'incompleteAttempts', 'unaccountedGenerations']
    .map((key) => readCount(object[key]));
  if (knownSubtotalUsd === null || completeTotalUsd === undefined || typeof object.complete !== 'boolean' ||
    typeof object.billing !== 'string' || !billingScopes.has(object.billing) || !reasons || counts.some((count) => count === null)) return null;
  const [pricedAttempts, excludedAttempts, unresolvedAttempts, incompleteAttempts, unaccountedGenerations] = counts as number[];
  return {
    knownSubtotalUsd,
    completeTotalUsd,
    // A complete flag without a total cannot be shown as complete.
    complete: object.complete && completeTotalUsd !== null,
    billing: object.billing as AccountingBillingScope,
    reasons,
    pricedAttempts,
    excludedAttempts,
    unresolvedAttempts,
    incompleteAttempts,
    unaccountedGenerations
  };
}

function readBudget(value: unknown): AccountingBudgetSnapshot | null {
  const object = readObject(value);
  if (!object) return null;
  const knownSubtotalUsd = readAmount(object.knownSubtotalUsd);
  const completeTotalUsd = readCompleteTotal(object);
  const reasons = readReasons(object.reasons);
  const incompleteAttempts = readCount(object.incompleteAttempts);
  if (knownSubtotalUsd === null || completeTotalUsd === undefined || !reasons || incompleteAttempts === null ||
    typeof object.bestEffort !== 'boolean') return null;
  return { knownSubtotalUsd, completeTotalUsd, reasons, incompleteAttempts, bestEffort: object.bestEffort };
}

/**
 * Parses an `AccountingSnapshot` v1 (from `_meta.querymt.accounting` or
 * `SessionLoadSnapshot.accounting`). Returns `undefined` for an absent or
 * malformed payload, which must not update accounting state.
 */
export function readAccountingSnapshot(value: unknown): AccountingSnapshot | undefined {
  const object = readObject(value);
  if (!object || object.version !== 1 || !('cycle' in object)) return undefined;
  const session = readScope(object.session);
  if (!session) return undefined;
  if (object.cycle === null) return { version: 1, session, cycle: null };
  const cycle = readObject(object.cycle);
  const scope = readScope(cycle?.scope);
  const budget = readBudget(cycle?.budget);
  if (!cycle || typeof cycle.cycleId !== 'string' || !scope || !budget) return undefined;
  return { version: 1, session, cycle: { cycleId: cycle.cycleId, scope, budget } };
}

/** Reads the replacement accounting carried by `usage_update` or `session_info_update`. */
export function readAccountingMeta(meta: unknown): AccountingSnapshot | undefined {
  return readAccountingSnapshot(readObject(readObject(meta)?.querymt)?.accounting);
}

export function hasAccountingMeta(meta: unknown): boolean {
  const querymt = readObject(readObject(meta)?.querymt);
  return querymt !== null && 'accounting' in querymt;
}

export type SessionCostDisplay =
  | { kind: 'none' }
  | { kind: 'estimated'; amountUsd: number; excludesSubscription: boolean }
  | { kind: 'incomplete'; knownSubtotalUsd: number; reasons: string[]; excludesSubscription: boolean }
  | { kind: 'excluded' }
  | { kind: 'reported'; amountUsd: number };

/** Maps session API-spend accounting to the label the usage bar shows. */
export function getSessionCostDisplay(accounting: AccountingSnapshot | undefined, standardCostUsd: number | null = null): SessionCostDisplay {
  // Agents without QueryMT accounting only report standard ACP cost; once
  // accounting exists it is authoritative and standard cost is ignored.
  if (!accounting) return standardCostUsd !== null ? { kind: 'reported', amountUsd: standardCostUsd } : { kind: 'none' };
  const scope = accounting.session;
  const billing: string = scope.billing;
  if (billing === 'empty' && scope.reasons.length === 0 && scope.unresolvedAttempts === 0) return { kind: 'none' };
  // All-excluded usage is never a known zero-dollar invoice.
  if (billing === 'excluded' && scope.reasons.length === 0 && scope.unresolvedAttempts === 0) return { kind: 'excluded' };
  const excludesSubscription = billing === 'mixed' || billing === 'excluded';
  if (scope.complete && scope.completeTotalUsd !== null) {
    return { kind: 'estimated', amountUsd: scope.completeTotalUsd, excludesSubscription };
  }
  return { kind: 'incomplete', knownSubtotalUsd: scope.knownSubtotalUsd, reasons: describeAccountingReasons(scope), excludesSubscription };
}

/** One aligned label/value row in the usage panel. */
export type UsageLine = {
  key: 'cost' | 'budget';
  label: string;
  value: string;
  /** Qualifier shown before the value: `≥` for a lower bound, `~` for an approximation. */
  prefix?: '≥' | '~';
  tone?: 'muted' | 'warn';
  /** Full explanation, used as the tooltip and accessible description. */
  title: string;
};

const SUBSCRIPTION_NOTE = 'Subscription usage is excluded from this figure';

/**
 * Maps cost state to dense label/value rows. Status is carried by the label,
 * a value prefix and tone rather than by extra tags, so every state fits on a
 * single line.
 */
export function getCostLines(cost: SessionCostDisplay, budget: AccountingBudgetSnapshot | null): UsageLine[] {
  const lines: UsageLine[] = [];
  switch (cost.kind) {
    case 'estimated':
      lines.push({
        key: 'cost',
        label: cost.excludesSubscription ? 'API cost (excl. subscription)' : 'API cost',
        value: formatCostUsd(cost.amountUsd),
        title: `Estimated API cost for metered requests, independent of the selected token scope${cost.excludesSubscription ? `. ${SUBSCRIPTION_NOTE}` : ''}`
      });
      break;
    case 'incomplete':
      lines.push({
        key: 'cost',
        label: cost.excludesSubscription ? 'API cost (excl. subscription)' : 'API cost',
        value: formatCostUsd(cost.knownSubtotalUsd),
        prefix: '≥',
        tone: 'warn',
        title: `At least ${formatCostUsd(cost.knownSubtotalUsd)} - incomplete: ${cost.reasons.join('; ') || 'some charges are unknown'}${cost.excludesSubscription ? `. ${SUBSCRIPTION_NOTE}` : ''}`
      });
      break;
    case 'excluded':
      lines.push({
        key: 'cost',
        label: 'API cost',
        value: 'Subscription',
        tone: 'muted',
        title: 'Subscription usage excluded: no metered API charges are reported'
      });
      break;
    case 'reported':
      lines.push({
        key: 'cost',
        label: 'Agent-reported cost',
        value: formatCostUsd(cost.amountUsd),
        title: 'Cost reported by the agent; completeness is not indicated'
      });
      break;
    case 'none':
      break;
  }
  if (budget && (budget.knownSubtotalUsd > 0 || budget.bestEffort)) {
    const reasons = describeAccountingReasons(budget);
    lines.push({
      key: 'budget',
      label: 'Cycle budget',
      value: formatCostUsd(budget.completeTotalUsd ?? budget.knownSubtotalUsd),
      prefix: budget.bestEffort ? '~' : undefined,
      title: budget.bestEffort
        ? `Cycle budget valuation is best-effort: ${reasons.join('; ') || 'some charges are unknown'}`
        : 'Spend counted against this cycle\'s price limit (manual rates when configured)'
    });
  }
  return lines;
}

export function describeAccountingReasons(scope: { reasons: Array<Record<string, unknown>>; unresolvedAttempts?: number; unaccountedGenerations?: number }): string[] {
  const descriptions = scope.reasons.map(describeAccountingReason);
  if (scope.unresolvedAttempts && !scope.reasons.some((reason) => reason.kind === 'unresolved_attempt')) {
    descriptions.push(describeAccountingReason({ kind: 'unresolved_attempt' }));
  }
  if (scope.unaccountedGenerations && !scope.reasons.some((reason) => reason.kind === 'unaccounted_history')) {
    descriptions.push(describeAccountingReason({ kind: 'unaccounted_history' }));
  }
  return [...new Set(descriptions)];
}

const categoryLabels: Record<string, string> = {
  input: 'input', output: 'output', cache_read: 'cache read', cache_write: 'cache write', cache_write_1h: 'one-hour cache write'
};

export function describeAccountingReason(reason: Record<string, unknown>): string {
  switch (reason.kind) {
    case 'unresolved_attempt': return 'A request has no recorded outcome';
    case 'partial_usage': return 'An interrupted request reported only partial usage';
    case 'usage_unavailable': return 'A request reported no usage';
    case 'invalid_settlement': return 'A recorded charge could not be trusted';
    case 'unaccounted_history': return 'Earlier history has no recorded pricing basis';
    case 'valuation': {
      const detail = readObject(reason.reason);
      const category = typeof detail?.category === 'string' ? categoryLabels[detail.category] ?? detail.category : 'a';
      switch (detail?.kind) {
        case 'usage_unavailable': return 'A request reported no usage';
        case 'pricing_unavailable': return 'No price is available for the model';
        case 'missing_rate': return `No ${category} rate is configured`;
        case 'invalid_rate': return `The ${category} rate is invalid`;
        case 'contradictory_write_detail': return 'Cache-write usage details are contradictory';
        case 'unsupported_dimension': return `Pricing dimension '${String(detail.dimension ?? 'unknown')}' is not supported`;
        case 'amount_overflow': return 'A charge was not representable';
        case 'pricing_inapplicable': return `No price applies to the served model '${String(detail.effective_model ?? 'unknown')}'`;
        default: return 'A charge could not be priced';
      }
    }
    default: return 'Accounting is incomplete';
  }
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
