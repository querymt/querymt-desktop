import { describe, expect, it } from 'vitest';
import type { SessionConversationTurn } from './session-conversation';
import { getForkTarget, getLatestForkTarget } from './session-fork';

const completedTurn: SessionConversationTurn = {
  id: 'turn-1',
  forkMessageId: 'assistant-2',
  user: { id: 'user-1', messageId: 'user-1', html: '<p>Prompt</p>', text: 'Prompt' },
  content: [
    { type: 'assistant', id: 'a1', messageId: 'assistant-1', html: '<p>Part one</p>', text: 'Part one ', relatedEvents: [] },
    { type: 'assistant', id: 'a2', messageId: 'assistant-2', html: '<p>Part two</p>', text: 'Part two', relatedEvents: [] }
  ]
};

describe('session fork boundaries', () => {
  it('uses the final assistant message so the completed response is included', () => {
    expect(getForkTarget(completedTurn)).toEqual({
      messageId: 'assistant-2',
      prompt: 'Prompt',
      response: 'Part one Part two',
      includesResponse: true
    });
  });

  it('falls back to the user prompt when no assistant message is persisted', () => {
    const turn: SessionConversationTurn = {
      id: 'turn-2',
      forkMessageId: 'user-2',
      user: { id: 'user-2', messageId: 'user-2', html: '<p>Prompt only</p>', text: 'Prompt only' },
      content: []
    };
    expect(getForkTarget(turn)).toMatchObject({ messageId: 'user-2', includesResponse: false });
  });

  it('selects the latest non-reverted forkable turn', () => {
    const newer = { ...completedTurn, id: 'turn-2', forkMessageId: 'assistant-3', user: { ...completedTurn.user!, messageId: 'user-2' } };
    expect(getLatestForkTarget([completedTurn, newer], new Set(['user-2']))?.messageId).toBe('assistant-2');
  });
});
