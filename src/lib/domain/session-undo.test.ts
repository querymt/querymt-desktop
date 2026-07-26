import { describe, expect, it } from 'vitest';
import { createEmptyActiveSession } from './session-updates';
import {
  canUndoToMessage,
  getCurrentUndoTarget,
  getUndoAffectedTurnCount,
  getUndoableSessionTurns,
  isTurnReverted
} from './session-undo';

function sessionWithTurns() {
  const session = createEmptyActiveSession();
  session.transcript = [
    { id: 'u1', kind: 'user_message_chunk', text: 'one ', messageId: 'm1' },
    { id: 'u1b', kind: 'user_message_chunk', text: 'continued', messageId: 'm1' },
    { id: 'a1', kind: 'agent_message_chunk', text: 'done', messageId: 'a1' },
    { id: 'u2', kind: 'user_message_chunk', text: 'two', messageId: 'm2' },
    { id: 'u3', kind: 'user_message_chunk', text: 'three', messageId: 'm3' }
  ];
  return session;
}

describe('session undo state', () => {
  it('groups user chunks into undoable message boundaries', () => {
    expect(getUndoableSessionTurns(sessionWithTurns())).toEqual([
      { messageId: 'm1', text: 'one continued', transcriptIndex: 0 },
      { messageId: 'm2', text: 'two', transcriptIndex: 3 },
      { messageId: 'm3', text: 'three', transcriptIndex: 4 }
    ]);
  });

  it('moves the global undo target left of the server stack frontier', () => {
    const session = sessionWithTurns();
    expect(getCurrentUndoTarget(session)?.messageId).toBe('m3');

    session.undo.stack = ['m3'];
    expect(getCurrentUndoTarget(session)?.messageId).toBe('m2');
    expect(isTurnReverted(session, 'm3')).toBe(true);
    expect(canUndoToMessage(session, 'm3')).toBe(false);
    expect(canUndoToMessage(session, 'm2')).toBe(true);
  });

  it('counts all turns affected by a targeted undo', () => {
    expect(getUndoAffectedTurnCount(sessionWithTurns(), 'm1')).toBe(3);
  });
});
