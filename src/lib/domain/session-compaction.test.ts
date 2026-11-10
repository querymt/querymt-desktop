import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk/unstable';
import { RuntimeAvailability, SessionRuntimePhase } from '$lib/querymt/generated/types';
import { activeSessionFromLoadResponse } from './session-snapshot';
import { buildSessionConversation } from './session-conversation';
import {
  applySessionNotification,
  appendSessionReplay,
  createEmptyActiveSession,
  projectSessionRuntime
} from './session-updates';
import { COMPACTING_LABEL, describeCompaction, isCompactCommand } from './session-compaction';

function note(update: unknown): SessionNotification {
  return { sessionId: 'session-1', update } as SessionNotification;
}

const text = (value: string) => ({ type: 'text', text: value });

function snapshot(events: unknown[]) {
  return { _meta: { 'querymt/sessionLoadSnapshot.v1': { audit: { events } } } };
}

describe('isCompactCommand', () => {
  it('matches the native command with or without instructions', () => {
    expect(isCompactCommand('/compact')).toBe(true);
    expect(isCompactCommand('  /compact keep the API notes ')).toBe(true);
    expect(isCompactCommand('/compactify')).toBe(false);
    expect(isCompactCommand('please /compact')).toBe(false);
  });
});

describe('live compaction updates', () => {
  it('shows a compacting label, accumulates chunks, then settles with the final summary and token drop', () => {
    let session = createEmptyActiveSession();
    session.usage.contextUsed = 182_000;
    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' }));
    expect(session.activityLabel).toBe(COMPACTING_LABEL);
    expect(session.runState).toBe('thinking');
    expect(session.compactions).toMatchObject([{ id: 'c1', status: 'in_progress', tokensBefore: 182_000 }]);

    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_summary_chunk', compactionId: 'c1', content: text('Part one. ') }));
    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_summary_chunk', compactionId: 'c1', content: text('Part two.') }));
    expect(session.compactions?.[0].summary).toBe('Part one. Part two.');

    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'completed', summary: [text('Final summary')] }));
    expect(session.compactions?.[0]).toMatchObject({ status: 'completed', summary: 'Final summary', awaitingUsage: true });
    expect(session.activityLabel).toBe('Context compacted.');

    session = applySessionNotification(session, note({ sessionUpdate: 'usage_update', used: 24_000, size: 200_000 }));
    expect(session.compactions?.[0]).toMatchObject({ tokensAfter: 24_000, awaitingUsage: false });
    expect(session.usage.contextUsed).toBe(24_000);
  });

  it('creates the compaction from a first-seen chunk and never reopens a settled one', () => {
    let session = createEmptyActiveSession();
    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_summary_chunk', compactionId: 'c2', content: text('early') }));
    expect(session.compactions?.[0]).toMatchObject({ id: 'c2', status: 'in_progress', summary: 'early' });
    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_update', compactionId: 'c2', status: 'failed', error: 'boom' }));
    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_update', compactionId: 'c2', status: 'in_progress' }));
    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_summary_chunk', compactionId: 'c2', content: text(' late') }));
    expect(session.compactions?.[0]).toMatchObject({ status: 'failed', error: 'boom', summary: 'early' });
    expect(describeCompaction(session.compactions![0])).toMatchObject({ tone: 'failed', detail: 'boom' });
  });

  it('records cancellation without an error and applies the same result during bulk replay', () => {
    const updates = [
      note({ sessionUpdate: 'compaction_update', compactionId: 'c3', status: 'in_progress' }),
      note({ sessionUpdate: 'compaction_update', compactionId: 'c3', status: 'cancelled' })
    ];
    const replayed = appendSessionReplay(createEmptyActiveSession(), updates);
    expect(replayed.compactions).toMatchObject([{ id: 'c3', status: 'cancelled' }]);
    expect(replayed.activityLabel).toBe('Compaction cancelled.');
  });

  it('keeps the compacting label while the runtime reports a busy turn', () => {
    let session = createEmptyActiveSession();
    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_update', compactionId: 'c4', status: 'in_progress' }));
    projectSessionRuntime(session, {
      phase: SessionRuntimePhase.Model,
      observation: { availability: RuntimeAvailability.Live }
    } as never);
    expect(session.activityLabel).toBe(COMPACTING_LABEL);

    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_update', compactionId: 'c4', status: 'completed' }));
    projectSessionRuntime(session, {
      phase: SessionRuntimePhase.Model,
      observation: { availability: RuntimeAvailability.Live }
    } as never);
    expect(session.activityLabel).toBe('Agent is working...');
  });
});

describe('compaction in loaded history', () => {
  it('restores identified compactions with summary, token drop and ordering', () => {
    const session = activeSessionFromLoadResponse('session-1', snapshot([
      { seq: 1, timestamp: 100, kind: { type: 'llm_request_end', data: { context_tokens: 150_000 } } },
      { seq: 2, timestamp: 200, kind: { type: 'compaction_start', data: { token_estimate: 150_000, compaction_id: 'c1' } } },
      { seq: 3, timestamp: 210, kind: { type: 'compaction_summary_chunk', data: { compaction_id: 'c1', content: 'Summary ' } } },
      { seq: 4, timestamp: 220, kind: { type: 'compaction_end', data: { compaction_id: 'c1', summary: 'Summary text', summary_len: 12, context_tokens: 20_000 } } }
    ]));
    expect(session.compactions).toEqual([
      expect.objectContaining({ id: 'c1', status: 'completed', summary: 'Summary text', tokensBefore: 150_000, tokensAfter: 20_000, eventIndex: 2 })
    ]);
    expect(session.usage.contextUsed).toBe(20_000);
    expect(describeCompaction(session.compactions![0]).detail).toBe('150k \u2192 20k tokens');
  });

  it('pairs legacy ID-less start and end records and reports failures and cancellations', () => {
    const session = activeSessionFromLoadResponse('session-1', snapshot([
      { seq: 5, kind: { type: 'compaction_start', data: { token_estimate: 1 } } },
      { seq: 6, kind: { type: 'compaction_end', data: { summary: 'legacy', summary_len: 6 } } },
      { seq: 7, kind: { type: 'compaction_start', data: { token_estimate: 1, compaction_id: 'f1' } } },
      { seq: 8, kind: { type: 'compaction_failed', data: { compaction_id: 'f1', reason: 'provider down' } } },
      { seq: 9, kind: { type: 'compaction_start', data: { token_estimate: 1, compaction_id: 'x1' } } },
      { seq: 10, kind: { type: 'compaction_failed', data: { compaction_id: 'x1', reason: 'cancelled', cancelled: true } } }
    ]));
    expect(session.compactions).toMatchObject([
      { id: 'querymt-compaction-legacy-5', status: 'completed', summary: 'legacy' },
      { id: 'f1', status: 'failed', error: 'provider down' },
      { id: 'x1', status: 'cancelled', error: null }
    ]);
  });

  it('marks a compaction that never finished as interrupted once the run is known to be over', () => {
    const session = activeSessionFromLoadResponse('session-1', snapshot([
      { seq: 1, kind: { type: 'run_started', data: { run_id: 'r1' } } },
      { seq: 2, kind: { type: 'compaction_start', data: { token_estimate: 1, compaction_id: 'c9' } } },
      { seq: 3, kind: { type: 'run_completed', data: { run_id: 'r1', outcome: 'failed' } } }
    ]));
    expect(session.compactions?.[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('interrupted') });
  });
});

describe('compaction in the conversation', () => {
  it('is its own entry between turns, not part of either turn', () => {
    const session = activeSessionFromLoadResponse('session-order', snapshot([
      { seq: 1, kind: { type: 'prompt_received', data: { message_id: 'm1', content: 'first' } } },
      { seq: 2, kind: { type: 'assistant_message_stored', data: { message_id: 'a1', content: 'reply one' } } },
      { seq: 3, kind: { type: 'compaction_start', data: { token_estimate: 5, compaction_id: 'c1' } } },
      { seq: 4, kind: { type: 'compaction_end', data: { compaction_id: 'c1', summary: 'S', summary_len: 1 } } },
      { seq: 5, kind: { type: 'prompt_received', data: { message_id: 'm2', content: 'second' } } },
      { seq: 6, kind: { type: 'assistant_message_stored', data: { message_id: 'a2', content: 'reply two' } } }
    ]));
    const turns = buildSessionConversation(session, []);
    expect(turns.map((turn) => (turn.compaction ? 'compaction' : turn.user?.text))).toEqual(['first', 'compaction', 'second']);
    expect(turns[1]).toMatchObject({ id: 'compaction-c1', settled: true, content: [], forkMessageId: null });
    expect(turns[0].content).toHaveLength(1);
  });

  it('is unsettled while compacting so it stays mounted, and updates as the summary arrives', () => {
    let session = createEmptyActiveSession();
    session.sessionId = 'session-1';
    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' }));
    let turns = buildSessionConversation(session, []);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ settled: false, compaction: { status: 'in_progress' } });

    session = applySessionNotification(session, note({ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'completed', summary: [text('Done')] }));
    turns = buildSessionConversation(session, turns);
    expect(turns[0]).toMatchObject({ settled: true, compaction: { status: 'completed', summary: 'Done' } });
  });
});
