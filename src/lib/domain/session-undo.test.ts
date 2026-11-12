import { describe, expect, it } from 'vitest';
import { createEmptyActiveSession } from './session-updates';
import {
  canUndoToMessage,
  getCommittedUndoFrontier,
  getCurrentUndoTarget,
  getSessionUndoNotice,
  getUndoAffectedTurnCount,
  getUndoableSessionTurns,
  isRedoRecovery,
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

  it('treats a failed-undo frame as a recovery point, not a reverted turn', () => {
    const session = sessionWithTurns();
    session.undo.stack = ['m2'];
    session.undo.stackRestoreFailed = [true];

    expect(isRedoRecovery(session)).toBe(true);
    expect(getCommittedUndoFrontier(session)).toBeUndefined();
    // The failed undo deleted no history: m2 and m3 are still live and undoable.
    expect(isTurnReverted(session, 'm2')).toBe(false);
    expect(canUndoToMessage(session, 'm2')).toBe(true);
    expect(getCurrentUndoTarget(session)?.messageId).toBe('m3');
    expect(getUndoAffectedTurnCount(session, 'm2')).toBe(2);
  });

  it('uses the newest committed frame under a failed one', () => {
    const session = sessionWithTurns();
    session.undo.stack = ['m3', 'm2'];
    session.undo.stackRestoreFailed = [false, true];

    expect(getCommittedUndoFrontier(session)).toBe('m3');
    expect(isRedoRecovery(session)).toBe(true);
    expect(getCurrentUndoTarget(session)?.messageId).toBe('m2');
  });

  it('does not report recovery for an ordinary or empty stack', () => {
    const session = sessionWithTurns();
    expect(isRedoRecovery(session)).toBe(false);
    session.undo.stack = ['m3'];
    session.undo.stackRestoreFailed = [false];
    expect(isRedoRecovery(session)).toBe(false);
  });

  describe('getSessionUndoNotice', () => {
    it('is null without an undo frame', () => {
      expect(getSessionUndoNotice(sessionWithTurns())).toBeNull();
    });

    it('counts undone turns and carries the restored files', () => {
      const session = sessionWithTurns();
      session.undo.stack = ['m2'];
      session.undo.stackRestoreFailed = [false];
      session.undo.lastRevertedFiles = ['a.ts'];
      expect(getSessionUndoNotice(session)).toEqual({
        messageId: 'm2',
        revertedTurns: 2,
        recovery: false,
        files: ['a.ts'],
        message: null
      });
    });

    it('reports recovery with no undone turns and the failure message', () => {
      const session = sessionWithTurns();
      session.undo.stack = ['m2'];
      session.undo.stackRestoreFailed = [true];
      session.undo.lastRevertedFiles = ['a.ts'];
      session.undo.lastMessage = 'boom';
      expect(getSessionUndoNotice(session)).toEqual({
        messageId: 'm2',
        revertedTurns: 0,
        recovery: true,
        files: [],
        message: 'boom'
      });
    });

    it('is null when the frame turn is not loaded', () => {
      const session = sessionWithTurns();
      session.undo.stack = ['gone'];
      session.undo.stackRestoreFailed = [false];
      expect(getSessionUndoNotice(session)).toBeNull();
    });
  });
});
