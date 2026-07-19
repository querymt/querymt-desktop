import { describe, expect, it } from 'vitest';
import { buildSessionConversation } from './session-conversation';
import type { ActiveSessionViewModel } from '$lib/domain/types';

function baseSession(): ActiveSessionViewModel {
  return {
    sessionId: 's1',
    transcript: [],
    toolCalls: [],
    plans: [],
    events: [],
    configOptions: [],
    runState: 'completed',
    activityLabel: null,
    activeToolCallId: null,
    lastStopReason: null,
    lastError: null
  };
}

describe('buildSessionConversation', () => {
  it('interleaves reasoning, tools, and assistant output by event order', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'inspect the app', messageId: 'm-user', eventIndex: 0 },
      { id: 'r1', kind: 'agent_thought_chunk', text: 'Inspecting components', messageId: 'm-reason-1', eventIndex: 1 },
      { id: 'r2', kind: 'agent_thought_chunk', text: 'Checking tests', messageId: 'm-reason-2', eventIndex: 4 },
      { id: 'a1', kind: 'agent_message_chunk', text: 'Implemented the fix.', messageId: 'm-final', eventIndex: 7 }
    ];
    session.toolCalls = [
      { id: 't1', title: 'read_tool', status: 'completed', kind: 'read_tool', eventIndex: 2 },
      { id: 't2', title: 'search_text', status: 'completed', kind: 'search_text', eventIndex: 3 },
      { id: 't3', title: 'edit', status: 'completed', kind: 'edit', eventIndex: 5 },
      { id: 't4', title: 'shell', status: 'completed', kind: 'shell', eventIndex: 6 }
    ];

    const turns = buildSessionConversation(session);

    expect(turns).toHaveLength(1);
    expect(turns[0].content.map((item) => item.type)).toEqual([
      'reasoning',
      'tool',
      'tool',
      'reasoning',
      'tool',
      'tool',
      'assistant'
    ]);
    expect(turns[0].content.map((item) => item.id)).toEqual(['r1', 't1', 't2', 'r2', 't3', 't4', 'a1']);
  });

  it('keeps reasoning traces separate when a tool appears between chunks with the same message id', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'plan', messageId: 'm-user', eventIndex: 0 },
      { id: 'r1', kind: 'agent_thought_chunk', text: 'First thought', messageId: 'm-reason', eventIndex: 1 },
      { id: 'r2', kind: 'agent_thought_chunk', text: 'Second thought', messageId: 'm-reason', eventIndex: 3 }
    ];
    session.toolCalls = [{ id: 't1', title: 'read_tool', status: 'completed', kind: 'read_tool', eventIndex: 2 }];

    const turns = buildSessionConversation(session);

    expect(turns[0].content).toEqual([
      expect.objectContaining({ type: 'reasoning', id: 'r1' }),
      expect.objectContaining({ type: 'tool', id: 't1' }),
      expect.objectContaining({ type: 'reasoning', id: 'r2' })
    ]);
  });

  it('renders duplicate tool IDs once and prefers terminal data', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'ask me', messageId: 'm-user', eventIndex: 0 },
      { id: 'a1', kind: 'agent_message_chunk', text: 'You selected Option B.', messageId: 'm-assistant', eventIndex: 4 }
    ];
    session.toolCalls = [
      {
        id: 'question-1',
        title: 'Run question',
        status: 'completed',
        kind: 'other',
        arguments: '{"questions":[]}',
        result: '{"answers":["Option B"]}',
        eventIndex: 2
      },
      {
        id: 'question-1',
        title: 'Run question',
        status: 'in_progress',
        kind: 'other',
        arguments: '{"questions":[]}',
        eventIndex: 3
      }
    ];

    const turns = buildSessionConversation(session);
    const tools = turns[0].content.filter((item) => item.type === 'tool');

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: 'tool',
      tool: {
        id: 'question-1',
        status: 'completed',
        result: '{"answers":["Option B"]}'
      }
    });
  });

  it('preserves stable source order when event indexes are equal or unavailable', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'inspect', messageId: 'm-user', eventIndex: 0 },
      { id: 'r1', kind: 'agent_thought_chunk', text: 'Thinking', messageId: 'm-reason', eventIndex: 1 },
      { id: 'a1', kind: 'agent_message_chunk', text: 'Done.', messageId: 'm-assistant' }
    ];
    session.toolCalls = [
      { id: 't1', title: 'first_tool', status: 'completed', kind: 'first_tool', eventIndex: 1 },
      { id: 't2', title: 'second_tool', status: 'completed', kind: 'second_tool' }
    ];

    const turns = buildSessionConversation(session);

    expect(turns[0].content.map((item) => item.id)).toEqual(['r1', 't1', 'a1', 't2']);
  });

  it('keeps a live elicitation turn after sparse reloaded history', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'First prompt', messageId: 'u1', eventIndex: 3 },
      { id: 'a1', kind: 'agent_message_chunk', text: 'First answer', messageId: 'a1', eventIndex: 18 },
      { id: 'u2', kind: 'user_message_chunk', text: 'Second prompt', messageId: 'u2', eventIndex: 19 },
      { id: 'a2', kind: 'agent_message_chunk', text: 'Second answer', messageId: 'a2', eventIndex: 22 }
    ];
    session.toolCalls = [
      { id: 'question-1', title: 'Question', status: 'completed', kind: 'other', eventIndex: 17 },
      { id: 'question-2', title: 'Question', status: 'completed', kind: 'other', eventIndex: 20 }
    ];

    const turns = buildSessionConversation(session);

    expect(turns.map((turn) => turn.user?.text)).toEqual(['First prompt', 'Second prompt']);
    expect(turns[0].content.map((item) => item.id)).toEqual(['question-1', 'a1']);
    expect(turns[1].content.map((item) => item.id)).toEqual(['question-2', 'a2']);
  });

  it('starts a new turn for each user prompt without requiring assistant text', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'first prompt', messageId: 'm-user-1', eventIndex: 0 },
      { id: 'r1', kind: 'agent_thought_chunk', text: 'Working', messageId: 'm-reason', eventIndex: 1 },
      { id: 'u2', kind: 'user_message_chunk', text: 'second prompt', messageId: 'm-user-2', eventIndex: 3 },
      { id: 'a2', kind: 'agent_message_chunk', text: 'Second reply', messageId: 'm-assistant', eventIndex: 4 }
    ];
    session.toolCalls = [{ id: 't1', title: 'read_tool', status: 'completed', kind: 'read_tool', eventIndex: 2 }];

    const turns = buildSessionConversation(session);

    expect(turns).toHaveLength(2);
    expect(turns[0].content.map((item) => item.type)).toEqual(['reasoning', 'tool']);
    expect(turns[1].content.map((item) => item.type)).toEqual(['assistant']);
  });
});
