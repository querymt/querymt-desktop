import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import {
  applySessionNotification,
  beginSessionWork,
  createEmptyActiveSession,
  endSessionWork,
  getNextConversationEventIndex
} from './session-updates';

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
  it('stores live context-window and USD cost updates', () => {
    const next = applySessionNotification(
      createEmptyActiveSession(),
      notification({
        sessionUpdate: 'usage_update',
        used: 32_768,
        size: 128_000,
        cost: { amount: 0.0425, currency: 'USD' }
      })
    );

    expect(next.usage).toMatchObject({
      contextUsed: 32_768,
      contextLimit: 128_000,
      cumulativeCostUsd: 0.0425
    });
    expect(next.events.at(-1)?.text).toContain('26%');
    expect(next.events.at(-1)?.text).toContain('$0.0425');
  });

  it('preserves known limits and costs when later updates omit them', () => {
    const session = createEmptyActiveSession();
    session.usage.contextLimit = 200_000;
    session.usage.cumulativeCostUsd = 0.1;

    const next = applySessionNotification(
      session,
      notification({ sessionUpdate: 'usage_update', used: 45_000, size: 0 })
    );

    expect(next.usage).toMatchObject({
      contextUsed: 45_000,
      contextLimit: 200_000,
      cumulativeCostUsd: 0.1
    });
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
