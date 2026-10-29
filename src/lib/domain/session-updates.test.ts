import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { AccountingSnapshot } from '$lib/querymt/generated/types';
import { activeSessionFromLoadResponse } from './session-snapshot';
import { SessionRuntimePhase, DelegationUpdateState } from '$lib/querymt/generated/types';
import {
  applyDelegationChildSession,
  applySessionNotification,
  appendSessionReplay,
  beginSessionWork,
  createEmptyActiveSession,
  endSessionWork,
  getNextConversationEventIndex,
  mergeMissingSessionUsage,
  projectSessionRuntime
} from './session-updates';

function notification(update: SessionNotification['update']): SessionNotification {
  return { sessionId: 'session-1', update };
}

function scope(overrides: Record<string, unknown> = {}) {
  return {
    knownSubtotalUsd: 0.0425, completeTotalUsd: 0.0425, complete: true, billing: 'metered', reasons: [],
    pricedAttempts: 1, excludedAttempts: 0, unresolvedAttempts: 0, incompleteAttempts: 0, unaccountedGenerations: 0,
    ...overrides
  };
}

function accounting(session: Record<string, unknown> = {}) {
  return { version: 1, session: scope(session), cycle: null };
}

const incompleteAccounting = accounting({
  knownSubtotalUsd: 0.05, completeTotalUsd: null, complete: false, incompleteAttempts: 1,
  reasons: [{ kind: 'valuation', reason: { kind: 'missing_rate', category: 'cache_write' } }]
});

describe('conversation event ordering', () => {
  it('F2: preserves run outcome and dependency evidence across harmless notification cloning', () => {
    const loaded = activeSessionFromLoadResponse('session-1', { _meta: { 'querymt/sessionLoadSnapshot.v1': {
      audit: { events: [{ seq: 1, kind: { type: 'run_started', data: { run_id: 'run-a' } } },
        { seq: 2, kind: { type: 'run_completed', data: { run_id: 'run-a', outcome: 'cancelled' } } }] }
    } } });
    loaded.delegations = [{ version: 1, sessionId: 'session-1', delegationId: 'd1', state: DelegationUpdateState.Forked,
      targetAgentId: 'coder', objective: '', requestedAt: 1, updatedAt: 1, activity: 'live', stage: 'verifying' }];
    loaded.dependencyLabel = 'Verifying delegate result';
    const next = applySessionNotification(loaded, notification({ sessionUpdate: 'usage_update', used: 1, size: 100 }));
    projectSessionRuntime(next, { phase: SessionRuntimePhase.Idle, steerable: false, pending_steering_count: 0, queued_input_count: 0 });
    expect(next).toMatchObject({ runId: 'run-a', lastRunOutcome: { runId: 'run-a', outcome: 'cancelled' },
      activityLabel: 'Turn cancelled.', dependencyLabel: 'Verifying delegate result', delegations: loaded.delegations });
    expect(loaded.lastRunOutcome?.outcome).toBe('cancelled');
  });
  it('continues after sparse persisted indexes instead of using the debug event count', () => {
    const session = createEmptyActiveSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'First prompt', messageId: 'u1', eventIndex: 3 },
      { id: 'a1', kind: 'agent_message_chunk', text: 'First answer', messageId: 'a1', eventIndex: 18 }
    ];
    session.events = [{ id: 'debug-1', kind: 'session_info_update', text: 'Loaded', messageId: null }];

    const next = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Second prompt' },
        messageId: 'u2'
      })
    );

    expect(getNextConversationEventIndex(session)).toBe(19);
    expect(next.transcript.at(-1)).toMatchObject({ text: 'Second prompt', eventIndex: 19 });
  });

  it('can retain a reserved optimistic position for an authoritative user chunk', () => {
    const session = createEmptyActiveSession();
    session.toolCalls = [{ id: 'question-1', title: 'Question', status: 'completed', kind: 'other', eventIndex: 12 }];

    const next = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Ask me a question' },
        messageId: 'u1'
      }),
      11
    );

    expect(next.transcript[0]).toMatchObject({ text: 'Ask me a question', eventIndex: 11 });
  });
});

describe('structured content updates', () => {
  it('normalizes native images without placeholder text or base64 summaries', () => {
    const next = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'image', data: 'aW1n', mimeType: 'image/png' },
        messageId: 'u1'
      })
    );
    expect(next.transcript[0]).toMatchObject({ text: '', blocks: [{ type: 'image', data: 'aW1n', mimeType: 'image/png' }] });
    expect(next.events[0].text).toBe('Image attachment');
    expect(next.events[0].text).not.toContain('aW1n');
  });

  it('extracts client correlation metadata from update, content, and notification shapes', () => {
    const shapes = [
      notification({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'update meta' },
        messageId: 'u1',
        _meta: { querymt: { client_prompt_id: 'client-update' } }
      } as SessionNotification['update']),
      notification({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'content meta', _meta: { querymt: { client_prompt_id: 'client-content' } } },
        messageId: 'u2'
      } as SessionNotification['update']),
      {
        ...notification({
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'notification metadata' },
          messageId: 'u3'
        }),
        metadata: { querymt: { clientPromptId: 'client-notification' } }
      } as SessionNotification
    ];

    let session = createEmptyActiveSession();
    for (const shape of shapes) session = applySessionNotification(session, shape);
    expect(session.transcript.map((item) => item.clientPromptId)).toEqual([
      'client-update',
      'client-content',
      'client-notification'
    ]);
  });

  it('normalizes resource images and preserves generic files', () => {
    let session = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'resource', resource: { uri: 'attachment:///1/pic.png', blob: 'aW1n', mimeType: 'image/png' } },
        messageId: 'u1'
      })
    );
    session = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'resource', resource: { uri: 'attachment:///2/notes.txt', blob: 'dGV4dA==', mimeType: 'text/plain' } },
        messageId: 'u1'
      })
    );
    expect(session.transcript.map((item) => item.blocks?.[0]?.type)).toEqual(['image', 'resource']);
    expect(session.transcript[1].blocks?.[0]).toMatchObject({ type: 'resource', mimeType: 'text/plain', data: 'dGV4dA==' });
  });
});

describe('session usage updates', () => {
  const counts = { inputTokens: 75, outputTokens: 162, reasoningTokens: 1024, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const breakdown = { latestRequest: counts, sessionTotals: counts, partial: false };
  const update = notification({ sessionUpdate: 'usage_update', used: 1261, size: 100_000,
    _meta: { querymt: { usage: { version: 1, ...breakdown } } } });

  it('replaces normalized usage in live and replay reducers without double-counting reasoning or replay', () => {
    const live = applySessionNotification(createEmptyActiveSession(), update);
    const replay = appendSessionReplay(createEmptyActiveSession(), [update, update]);
    expect(live.usage.breakdown).toEqual(breakdown);
    expect(replay.usage.breakdown).toEqual(breakdown);
    expect(live.usage.contextUsed).toBe(1261);
    expect(live.usage.breakdown!.latestRequest!.outputTokens).toBe(162);
    expect(live.usage.breakdown!.latestRequest!.reasoningTokens).toBe(1024);
  });

  it('preserves details when metadata is omitted or invalid, and ignores unsupported versions', () => {
    let current = applySessionNotification(createEmptyActiveSession(), update);
    for (const _meta of [undefined, { querymt: { usage: { version: 2, ...breakdown } } },
      { querymt: { usage: { version: 1, partial: false, latestRequest: 'invalid', sessionTotals: counts } } }]) {
      current = applySessionNotification(current, notification({ sessionUpdate: 'usage_update', used: 10, size: 100_000, _meta }));
      expect(current.usage.breakdown).toEqual(breakdown);
    }
  });

  it('fills missing breakdowns without replacing the authoritative target totals', () => {
    const source = applySessionNotification(createEmptyActiveSession(), update);
    const target = createEmptyActiveSession();
    mergeMissingSessionUsage(target, source);
    expect(target.usage.breakdown).toEqual(breakdown);
    const authoritative = { ...breakdown, partial: true };
    target.usage.breakdown = authoritative;
    mergeMissingSessionUsage(target, source);
    expect(target.usage.breakdown).toBe(authoritative);
  });

  it('stores live context-window and replacement accounting updates', () => {
    const next = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'usage_update',
        used: 32_768,
        size: 128_000,
        cost: { amount: 0.0425, currency: 'USD' },
        _meta: { querymt: { accounting: accounting() } }
      })
    );

    expect(next.usage).toMatchObject({ contextUsed: 32_768, contextLimit: 128_000 });
    expect(next.usage.accounting?.session.completeTotalUsd).toBe(0.0425);
    expect(next.events.at(-1)?.text).toContain('26%');
    expect(next.events.at(-1)?.text).toContain('$0.0425');
  });

  it('tracks standard cost separately without creating accounting', () => {
    const next = applySessionNotification(createEmptyActiveSession(),
      notification({ sessionUpdate: 'usage_update', used: 1, size: 10, cost: { amount: 9, currency: 'USD' } }));
    expect(next.usage.accounting).toBeUndefined();
    expect(next.usage.standardCostUsd).toBe(9);
  });

  it('keeps the last standard cost when a plain ACP agent omits it, live and on replay', () => {
    const updates = [
      notification({ sessionUpdate: 'usage_update', used: 1, size: 10, cost: { amount: 0.2, currency: 'USD' } }),
      notification({ sessionUpdate: 'usage_update', used: 2, size: 10 }),
      notification({ sessionUpdate: 'usage_update', used: 3, size: 10, cost: { amount: 1, currency: 'EUR' } })
    ];
    expect(updates.reduce(applySessionNotification, createEmptyActiveSession()).usage.standardCostUsd).toBe(0.2);
    expect(appendSessionReplay(createEmptyActiveSession(), updates).usage.standardCostUsd).toBe(0.2);
  });

  it('fills a missing standard cost during load merging', () => {
    const target = createEmptyActiveSession();
    const source = createEmptyActiveSession();
    source.usage.standardCostUsd = 0.3;
    mergeMissingSessionUsage(target, source);
    expect(target.usage.standardCostUsd).toBe(0.3);
    target.usage.standardCostUsd = 0.4;
    mergeMissingSessionUsage(target, source);
    expect(target.usage.standardCostUsd).toBe(0.4);
  });

  it('preserves known limits and accounting when later updates omit them', () => {
    const session = createEmptyActiveSession();
    session.usage.contextLimit = 200_000;
    const known = applySessionNotification(session,
      notification({ sessionUpdate: 'session_info_update', _meta: { querymt: { accounting: accounting() } } }));

    const next = applySessionNotification(
      known,
      notification({ sessionUpdate: 'usage_update', used: 45_000, size: 0 })
    );

    expect(next.usage).toMatchObject({ contextUsed: 45_000, contextLimit: 200_000 });
    expect(next.usage.accounting).toEqual(known.usage.accounting);
  });

  it.each(['usage_update', 'session_info_update'] as const)('clears a complete total atomically via %s', (kind) => {
    const carrier = (value: unknown) => notification(kind === 'usage_update'
      ? { sessionUpdate: kind, used: 10, size: 100, _meta: { querymt: { accounting: value } } }
      : { sessionUpdate: kind, _meta: { querymt: { accounting: value } } });
    for (const reduce of [
      (updates: SessionNotification[]) => updates.reduce(applySessionNotification, createEmptyActiveSession()),
      (updates: SessionNotification[]) => appendSessionReplay(createEmptyActiveSession(), updates)
    ]) {
      const next = reduce([carrier(accounting()), carrier(incompleteAccounting)]);
      expect(next.usage.accounting?.session).toMatchObject({ completeTotalUsd: null, complete: false, knownSubtotalUsd: 0.05 });
    }
  });

  it('does not apply malformed or unsupported accounting payloads', () => {
    let current = applySessionNotification(createEmptyActiveSession(),
      notification({ sessionUpdate: 'session_info_update', _meta: { querymt: { accounting: accounting() } } }));
    const before = current.usage.accounting;
    const missingTotal: Record<string, unknown> = scope();
    delete missingTotal.completeTotalUsd;
    for (const value of [{ ...accounting(), version: 2 }, { version: 1, session: missingTotal, cycle: null },
      { version: 1, session: scope() }, 'invalid']) {
      current = applySessionNotification(current,
        notification({ sessionUpdate: 'session_info_update', _meta: { querymt: { accounting: value } } }));
      expect(current.usage.accounting).toBe(before);
    }
  });

  it('tracks active processing time without double-starting a span', () => {
    const session = createEmptyActiveSession();
    beginSessionWork(session, 1_000);
    beginSessionWork(session, 2_000);
    endSessionWork(session, 4_500);

    expect(session.usage.activeWorkMs).toBe(3_500);
    expect(session.usage.activeWorkStartedAt).toBeNull();
  });
});

describe('mergeMissingSessionUsage', () => {
  it('fills only the metrics the target is missing', () => {
    const target = createEmptyActiveSession();
    target.usage.contextUsed = 48_000;
    const source = createEmptyActiveSession();
    source.usage.contextUsed = 12_000;
    source.usage.contextLimit = 200_000;
    source.usage.accounting = accounting() as unknown as AccountingSnapshot;

    mergeMissingSessionUsage(target, source);

    expect(target.usage).toMatchObject({ contextUsed: 48_000, contextLimit: 200_000 });
    expect(target.usage.accounting).toBe(source.usage.accounting);
    expect(source.usage.contextUsed).toBe(12_000);
  });

  it('never regresses context usage or cost on the target', () => {
    const target = createEmptyActiveSession();
    target.usage.contextUsed = 48_000;
    target.usage.contextLimit = 200_000;
    const source = createEmptyActiveSession();
    source.usage.contextUsed = 1_000;
    source.usage.contextLimit = 100_000;

    mergeMissingSessionUsage(target, source);

    expect(target.usage).toMatchObject({ contextUsed: 48_000, contextLimit: 200_000 });
  });

  it('never refills an explicitly cleared complete total from an older candidate', () => {
    const target = createEmptyActiveSession();
    target.usage.accounting = incompleteAccounting as unknown as AccountingSnapshot;
    const source = createEmptyActiveSession();
    source.usage.accounting = accounting({ completeTotalUsd: 0.5, knownSubtotalUsd: 0.5 }) as unknown as AccountingSnapshot;

    mergeMissingSessionUsage(target, source);

    expect(target.usage.accounting?.session.completeTotalUsd).toBeNull();
    expect(target.usage.accounting?.session.knownSubtotalUsd).toBe(0.05);
  });

  it('leaves active-work timers untouched', () => {
    const target = createEmptyActiveSession();
    target.usage.activeWorkMs = 4_000;
    target.usage.activeWorkStartedAt = 9_000;
    const source = createEmptyActiveSession();
    source.usage.activeWorkMs = 99_000;
    source.usage.activeWorkStartedAt = 1_000;

    mergeMissingSessionUsage(target, source);

    expect(target.usage.activeWorkMs).toBe(4_000);
    expect(target.usage.activeWorkStartedAt).toBe(9_000);
  });
});

describe('applySessionNotification tool calls', () => {
  it.each(['completed', 'failed'] as const)('keeps a parallel shell active when a quick tool is %s in live and replay reducers', (status) => {
    const updates = [
      notification({ sessionUpdate: 'tool_call', toolCallId: 'shell', title: 'Long shell', status: 'in_progress' }),
      notification({ sessionUpdate: 'tool_call', toolCallId: 'read', title: 'Quick read', status: 'in_progress' }),
      notification({ sessionUpdate: 'tool_call_update', toolCallId: 'read', status })
    ];
    const live = updates.reduce((session, update) => applySessionNotification(session, update), createEmptyActiveSession());
    const replay = appendSessionReplay(createEmptyActiveSession(), updates);
    for (const session of [live, replay]) {
      expect(session.toolCalls.find((tool) => tool.id === 'read')?.status).toBe(status);
      expect(session.toolCalls.find((tool) => tool.id === 'shell')?.status).toBe('in_progress');
      expect(session.runState).toBe('tool-running');
      expect(session.activeToolCallId).toBe('shell');
      expect(session.lastError).toBeNull();
    }
  });

  it('does not treat the last tool failure as a terminal run failure', () => {
    const session = applySessionNotification(createEmptyActiveSession(), notification({
      sessionUpdate: 'tool_call_update', toolCallId: 'read', status: 'failed'
    }));
    expect(session.toolCalls[0].status).toBe('failed');
    expect(session.runState).toBe('streaming');
    expect(session.lastError).toBeNull();
  });
  it('merges repeated tool starts by tool call ID', () => {
    const start = notification({
      sessionUpdate: 'tool_call',
      toolCallId: 'question-1',
      title: 'Run question',
      kind: 'other',
      status: 'in_progress',
      rawInput: { questions: [] },
      content: []
    });

    let session = applySessionNotification(createEmptyActiveSession(), start);
    session = applySessionNotification(session, start);

    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0]).toMatchObject({ id: 'question-1', status: 'in_progress', eventIndex: 0 });
  });

  it('does not downgrade a completed tool when its start is replayed', () => {
    const start = notification({
      sessionUpdate: 'tool_call',
      toolCallId: 'question-1',
      title: 'Run question',
      kind: 'other',
      status: 'in_progress',
      rawInput: { questions: [] },
      content: []
    });
    const complete = notification({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'question-1',
      title: 'Run question',
      kind: 'other',
      status: 'completed',
      rawOutput: { answers: ['Option B'] },
      content: []
    });

    let session = applySessionNotification(createEmptyActiveSession(), start);
    session = applySessionNotification(session, complete);
    session = applySessionNotification(session, start);

    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0]).toMatchObject({
      id: 'question-1',
      status: 'completed',
      result: '{\n  "answers": [\n    "Option B"\n  ]\n}'
    });
    expect(session.activeToolCallId).toBeNull();
  });

  it('canonicalizes existing duplicate entries when an update arrives', () => {
    const session = createEmptyActiveSession();
    session.toolCalls = [
      { id: 'question-1', title: 'Run question', status: 'in_progress', kind: 'other', arguments: '{}' },
      { id: 'question-1', title: 'Run question', status: 'completed', kind: 'other', result: 'Option B' }
    ];

    const next = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'question-1',
        title: 'Run question',
        status: 'completed',
        content: []
      })
    );

    expect(next.toolCalls).toHaveLength(1);
    expect(next.toolCalls[0]).toMatchObject({ status: 'completed', arguments: '{}', result: 'Option B' });
  });

  it('attaches a child session id from a live delegation update', () => {
    const session = createEmptyActiveSession();
    session.sessionId = 'session-1';
    session.toolCalls = [{
      id: 'delegate-1',
      title: 'Run delegate',
      status: 'in_progress',
      kind: 'delegate',
      arguments: '{"target_agent_id":"linus"}'
    }];

    const next = applyDelegationChildSession(session, {
      sessionId: 'session-1',
      toolCallId: 'delegate-1',
      childSessionId: 'child-session-1'
    });

    expect(next).not.toBe(session);
    expect(next.toolCalls[0]?.childSessionId).toBe('child-session-1');
    expect(session.toolCalls[0]?.childSessionId).toBeUndefined();
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('tracks delegate lifecycle separately from the completed dispatch tool (%s)', (state) => {
    let session = createEmptyActiveSession();
    session.sessionId = 'session-1';
    session = applySessionNotification(session, notification({
      sessionUpdate: 'tool_call', toolCallId: 'delegate-1', title: 'Run delegate', status: 'completed'
    }));
    const update = { sessionId: 'session-1', toolCallId: 'delegate-1' };

    session = applyDelegationChildSession(session, { ...update, state: 'requested', updatedAt: 1 });
    expect(session.toolCalls[0]).toMatchObject({ status: 'completed', delegationState: 'requested' });
    session = applyDelegationChildSession(session, { ...update, state: 'forked', updatedAt: 2, childSessionId: 'child-1' });
    expect(session.toolCalls[0]).toMatchObject({ status: 'completed', delegationState: 'forked', childSessionId: 'child-1' });
    session = applyDelegationChildSession(session, { ...update, state, updatedAt: 3, childSessionId: 'child-1' });
    expect(session.toolCalls[0]).toMatchObject({ status: 'completed', delegationState: state, delegationUpdatedAt: 3 });

    const terminal = session;
    session = applyDelegationChildSession(session, { ...update, state: 'forked', updatedAt: 2, childSessionId: 'child-1' });
    expect(session).toBe(terminal);
    session = appendSessionReplay(session, [notification({
      sessionUpdate: 'tool_call_update', toolCallId: 'delegate-1', status: 'completed'
    })]);
    expect(session.toolCalls[0]).toMatchObject({ status: 'completed', delegationState: state });
  });

  it('preserves newer delegation state and child links while still accepting ID-only notifications', () => {
    const session = createEmptyActiveSession();
    session.sessionId = 'session-1';
    session.toolCalls = [{ id: 'delegate-1', title: 'Run delegate', kind: 'delegate', status: 'completed' }];
    const update = { sessionId: 'session-1', toolCallId: 'delegate-1' };
    const running = applyDelegationChildSession(session, { ...update, state: 'forked', updatedAt: 5, childSessionId: 'current-child' });
    expect(running.toolCalls[0].delegationState).toBe('forked');
    expect(session.toolCalls[0].delegationState).toBeUndefined();
    for (const lifecycle of [{ state: 'requested', updatedAt: 1 }, { updatedAt: 1 }, { state: 'requested' }] as const) {
      expect(applyDelegationChildSession(running, { ...update, ...lifecycle, childSessionId: 'stale-child' })).toBe(running);
    }
    const idOnly = applyDelegationChildSession(running, { ...update, childSessionId: 'id-only-child' });
    expect(idOnly.toolCalls[0]).toMatchObject({
      childSessionId: 'id-only-child', delegationState: 'forked', delegationUpdatedAt: 5
    });
  });

  it('ignores delegation updates for another session or missing child id', () => {
    const session = createEmptyActiveSession();
    session.sessionId = 'session-1';
    session.toolCalls = [{
      id: 'delegate-1',
      title: 'Run delegate',
      status: 'in_progress',
      kind: 'delegate'
    }];

    expect(applyDelegationChildSession(session, {
      sessionId: 'session-2',
      toolCallId: 'delegate-1',
      childSessionId: 'child-session-1'
    })).toBe(session);
    expect(applyDelegationChildSession(session, {
      sessionId: 'session-1',
      toolCallId: 'delegate-1'
    })).toBe(session);
  });
});

describe('applySessionNotification stream coalescing', () => {
  it('appends consecutive agent thought chunks onto the last transcript item', () => {
    let session = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Hel' },
        messageId: 'thought-1'
      })
    );
    const firstItem = session.transcript[0];
    session = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'lo' },
        messageId: 'thought-1'
      })
    );

    expect(session.transcript).toHaveLength(1);
    expect(session.transcript[0]).toBe(session.transcript[0]);
    expect(session.transcript[0].id).toBe(firstItem.id);
    expect(session.transcript[0]).toMatchObject({
      kind: 'agent_thought_chunk',
      text: 'Hello',
      messageId: 'thought-1'
    });
    expect(session.events).toHaveLength(1);
    expect(session.events[0].kind).toBe('agent_thought_chunk');
  });

  it('appends consecutive agent message chunks onto the last transcript item', () => {
    let session = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hel' },
        messageId: 'assistant-1'
      })
    );
    session = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'lo' },
        messageId: 'assistant-1'
      })
    );

    expect(session.transcript).toHaveLength(1);
    expect(session.transcript[0]).toMatchObject({
      kind: 'agent_message_chunk',
      text: 'Hello',
      messageId: 'assistant-1'
    });
    expect(session.events).toHaveLength(1);
  });

  it('does not merge chunks across different message ids or kinds', () => {
    let session = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Think' },
        messageId: 'thought-1'
      })
    );
    session = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Answer' },
        messageId: 'assistant-1'
      })
    );
    session = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' more' },
        messageId: 'assistant-2'
      })
    );

    expect(session.transcript.map((item) => item.text)).toEqual(['Think', 'Answer', ' more']);
    expect(session.events).toHaveLength(3);
  });

  it('structurally shares unchanged arrays when only the last stream item grows', () => {
    const session = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Hel' },
        messageId: 'thought-1'
      })
    );
    const next = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'lo' },
        messageId: 'thought-1'
      })
    );

    expect(next.toolCalls).toBe(session.toolCalls);
    expect(next.plans).toBe(session.plans);
    expect(next.configOptions).toBe(session.configOptions);
    expect(next.events).toBe(session.events);
    expect(next.transcript).not.toBe(session.transcript);
    expect(next.transcript[0]).not.toBe(session.transcript[0]);
  });

  it('keeps summary parts with different ids as separate reasoning entries', () => {
    let session = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'First title', _meta: { querymt: { reasoning_part_id: 'rs_1:summary:0' } } },
        messageId: 'assistant-1'
      } as SessionNotification['update'])
    );
    session = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: ' continues' },
        messageId: 'assistant-1',
        _meta: { querymt: { reasoning_part_id: 'rs_1:summary:0' } }
      } as SessionNotification['update'])
    );
    session = applySessionNotification(
      session,
      notification({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Second title' },
        messageId: 'assistant-1',
        _meta: { querymt: { reasoning_part_id: 'rs_1:summary:1' } }
      } as SessionNotification['update'])
    );

    expect(session.transcript).toHaveLength(2);
    expect(session.transcript[0]).toMatchObject({
      text: 'First title continues',
      reasoningPartId: 'rs_1:summary:0'
    });
    expect(session.transcript[1]).toMatchObject({
      text: 'Second title',
      reasoningPartId: 'rs_1:summary:1'
    });
  });
});
