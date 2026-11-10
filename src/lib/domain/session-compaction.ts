import type { ActiveSessionViewModel, SessionCompactionItem } from '$lib/domain/types';

export const COMPACTING_LABEL = 'Compacting context\u2026';

type ContentLike = { type?: string; text?: string };

/** Shape shared by ACP `compaction_update` notifications (kept structural to stay SDK-agnostic). */
export interface CompactionUpdateInput {
  compactionId: string;
  status: string;
  summary?: ContentLike[] | null;
  error?: string | null;
}

export interface CompactionChunkInput {
  compactionId: string;
  content: ContentLike;
}

/** True for the native `/compact [instructions]` command. */
export function isCompactCommand(prompt: string): boolean {
  return /^\/compact(\s|$)/i.test(prompt.trim());
}

export function hasActiveCompaction(session: Pick<ActiveSessionViewModel, 'compactions'>): boolean {
  return session.compactions?.some((item) => item.status === 'in_progress') ?? false;
}

export function isCompactingLabel(label: string | null | undefined): boolean {
  return Boolean(label?.startsWith('Compacting'));
}

function normalizeStatus(status: string): SessionCompactionItem['status'] {
  return status === 'completed' || status === 'failed' || status === 'cancelled' ? status : 'in_progress';
}

function blocksToText(blocks: ContentLike[]): string {
  return blocks.map((block) => (block?.type === 'text' ? (block.text ?? '') : '')).join('');
}

function ensure(
  session: ActiveSessionViewModel,
  id: string,
  eventIndex: number | undefined,
  now: number
): SessionCompactionItem {
  const list = (session.compactions ??= []);
  let item = list.find((entry) => entry.id === id);
  if (!item) {
    const before = session.usage.contextUsed;
    item = {
      id,
      status: 'in_progress',
      summary: '',
      eventIndex,
      startedAtMs: now,
      tokensBefore: typeof before === 'number' ? before : null
    };
    list.push(item);
  }
  return item;
}

function finish(session: ActiveSessionViewModel, item: SessionCompactionItem, now: number) {
  item.endedAtMs = now;
  if (!isCompactingLabel(session.activityLabel)) return;
  session.activityLabel =
    item.status === 'completed' ? 'Context compacted.'
    : item.status === 'cancelled' ? 'Compaction cancelled.'
    : 'Compaction failed.';
}

/**
 * Upserts a compaction from a live `compaction_update`. `summary` and `error`
 * have patch semantics: omitted keeps the value, null or `[]` clears it.
 * Mutates `session`; callers hand in an already-cloned view model.
 */
export function applyCompactionUpdate(
  session: ActiveSessionViewModel,
  update: CompactionUpdateInput,
  eventIndex: number,
  now = Date.now()
): void {
  const item = ensure(session, update.compactionId, eventIndex, now);
  const status = normalizeStatus(update.status);
  if (item.status !== 'in_progress' && status === 'in_progress') return; // never reopen a settled compaction
  item.status = status;
  if (update.summary !== undefined) item.summary = update.summary ? blocksToText(update.summary) : '';
  if (update.error !== undefined) item.error = update.error;
  if (status === 'in_progress') {
    session.runState = 'thinking';
    session.activityLabel = COMPACTING_LABEL;
    session.lastError = null;
    return;
  }
  item.awaitingUsage = status === 'completed';
  finish(session, item, now);
}

/** Appends one summary fragment; a first-seen ID creates an in-progress compaction. */
export function applyCompactionSummaryChunk(
  session: ActiveSessionViewModel,
  chunk: CompactionChunkInput,
  eventIndex: number,
  now = Date.now()
): void {
  const item = ensure(session, chunk.compactionId, eventIndex, now);
  if (item.status !== 'in_progress') return;
  item.summary += chunk.content?.type === 'text' ? (chunk.content.text ?? '') : '';
  session.runState = 'thinking';
  session.activityLabel = COMPACTING_LABEL;
}

/**
 * The usage update right after a completed compaction carries its
 * post-compaction context size; any other update ends that window.
 */
export function settleCompactionUsage(session: ActiveSessionViewModel, used: number | null): void {
  for (const item of session.compactions ?? []) {
    if (!item.awaitingUsage) continue;
    item.awaitingUsage = false;
    if (used !== null) item.tokensAfter = used;
  }
}

export function clearAwaitingCompactionUsage(session: ActiveSessionViewModel): void {
  settleCompactionUsage(session, null);
}

export function cloneCompactions(items: SessionCompactionItem[] | undefined): SessionCompactionItem[] | undefined {
  return items?.map((item) => ({ ...item }));
}

/** A load is not evidence a compaction ended; once the run is known to be over it cannot still be running. */
export function interruptOpenCompactions(session: ActiveSessionViewModel): void {
  for (const item of session.compactions ?? []) {
    if (item.status !== 'in_progress') continue;
    item.status = 'failed';
    item.error = item.error ?? 'Compaction was interrupted before it finished.';
  }
}

function formatTokens(value: number): string {
  if (value < 1000) return String(Math.round(value));
  const thousands = value / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

export interface CompactionPresentation {
  title: string;
  detail: string | null;
  tone: 'running' | 'done' | 'failed' | 'cancelled';
}

export function describeCompaction(item: SessionCompactionItem): CompactionPresentation {
  const before = typeof item.tokensBefore === 'number' ? item.tokensBefore : null;
  const after = typeof item.tokensAfter === 'number' ? item.tokensAfter : null;
  switch (item.status) {
    case 'in_progress':
      return { title: COMPACTING_LABEL, detail: before !== null ? `${formatTokens(before)} tokens in context` : null, tone: 'running' };
    case 'failed':
      return { title: 'Compaction failed', detail: item.error ?? null, tone: 'failed' };
    case 'cancelled':
      return { title: 'Compaction cancelled', detail: null, tone: 'cancelled' };
    default:
      return {
        title: 'Context compacted',
        detail:
          before !== null && after !== null ? `${formatTokens(before)} \u2192 ${formatTokens(after)} tokens`
          : after !== null ? `${formatTokens(after)} tokens remaining`
          : null,
        tone: 'done'
      };
  }
}
