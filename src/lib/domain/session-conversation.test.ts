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
  it('attaches tools by assistant message id', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'find bug', messageId: 'm-user', eventIndex: 0 },
      { id: 'a1', kind: 'agent_message_chunk', text: 'checking files', messageId: 'm-assistant', eventIndex: 1 }
    ];
    session.events = [
      { id: 'e1', kind: 'user_message_chunk', text: 'find bug', messageId: 'm-user' },
      { id: 'e2', kind: 'agent_message_chunk', text: 'checking files', messageId: 'm-assistant' }
    ];
    session.toolCalls = [
      {
        id: 't1',
        title: 'read_tool',
        status: 'completed',
        kind: 'read_tool',
        messageId: 'm-assistant',
        result: 'contents',
        eventIndex: 2
      }
    ];

    const turns = buildSessionConversation(session);

    expect(turns).toHaveLength(1);
    expect(turns[0].assistant).toBeTruthy();
    expect(turns[0].activities).toHaveLength(1);
    expect(turns[0].activities[0].attachedBy).toBe('message-id');
  });

  it('attaches unmatched tools to the nearest previous assistant/thought turn', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'scan repo', messageId: 'm-user', eventIndex: 0 },
      { id: 't1', kind: 'agent_thought_chunk', text: 'Looking for the right file', messageId: 'm-thought', eventIndex: 1 },
      { id: 'a1', kind: 'agent_message_chunk', text: 'I found a likely candidate.', messageId: 'm-assistant', eventIndex: 2 }
    ];
    session.events = [
      { id: 'e1', kind: 'user_message_chunk', text: 'scan repo', messageId: 'm-user' },
      { id: 'e2', kind: 'agent_thought_chunk', text: 'Looking for the right file', messageId: 'm-thought' },
      { id: 'e3', kind: 'agent_message_chunk', text: 'I found a likely candidate.', messageId: 'm-assistant' }
    ];
    session.toolCalls = [
      {
        id: 't-read',
        title: 'read_tool',
        status: 'completed',
        kind: 'read_tool',
        result: 'file contents',
        eventIndex: 3
      }
    ];

    const turns = buildSessionConversation(session);

    expect(turns).toHaveLength(1);
    expect(turns[0].activities).toHaveLength(1);
    expect(turns[0].activities[0].attachedBy).toBe('nearest-previous');
  });

  it('preserves tool execution order within a turn', () => {
    const session = baseSession();
    session.transcript = [
      { id: 'u1', kind: 'user_message_chunk', text: 'inspect', messageId: 'm-user', eventIndex: 0 },
      { id: 'a1', kind: 'agent_message_chunk', text: 'Running checks.', messageId: 'm-assistant', eventIndex: 1 }
    ];
    session.events = [
      { id: 'e1', kind: 'user_message_chunk', text: 'inspect', messageId: 'm-user' },
      { id: 'e2', kind: 'agent_message_chunk', text: 'Running checks.', messageId: 'm-assistant' }
    ];
    session.toolCalls = [
      {
        id: 't2',
        title: 'second_tool',
        status: 'completed',
        kind: 'second_tool',
        eventIndex: 4
      },
      {
        id: 't1',
        title: 'first_tool',
        status: 'completed',
        kind: 'first_tool',
        eventIndex: 3
      }
    ];

    const turns = buildSessionConversation(session);

    expect(turns[0].activities.map((activity) => activity.tool.title)).toEqual(['first_tool', 'second_tool']);
  });
});
