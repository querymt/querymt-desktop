import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { applySessionNotification, createEmptyActiveSession, getNextConversationEventIndex } from './session-updates';

function notification(update: SessionNotification['update']): SessionNotification {
  return { sessionId: 'session-1', update };
}

describe('conversation event ordering', () => {
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

describe('applySessionNotification tool calls', () => {
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
});
