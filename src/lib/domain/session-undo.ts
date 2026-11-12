import type { ActiveSessionViewModel } from '$lib/domain/types';

export interface UndoableSessionTurn {
  messageId: string;
  text: string;
  transcriptIndex: number;
}

export function getUndoableSessionTurns(session: ActiveSessionViewModel): UndoableSessionTurn[] {
  const turns: UndoableSessionTurn[] = [];
  const byMessageId = new Map<string, UndoableSessionTurn>();
  session.transcript.forEach((item, transcriptIndex) => {
    if (item.kind !== 'user_message_chunk' || !item.messageId) return;
    const existing = byMessageId.get(item.messageId);
    if (existing) {
      existing.text += item.text;
      return;
    }
    const turn = { messageId: item.messageId, text: item.text, transcriptIndex };
    turns.push(turn);
    byMessageId.set(item.messageId, turn);
  });
  return turns;
}

/**
 * Message id of the newest frame whose undo completed. Frames recorded by an
 * undo that failed part-way are skipped: that undo deleted no history, so the
 * turns it named are still live, and retrying it is allowed.
 */
export function getCommittedUndoFrontier(session: ActiveSessionViewModel): string | undefined {
  const { stack, stackRestoreFailed } = session.undo;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (!stackRestoreFailed[index]) return stack[index];
  }
  return undefined;
}

/** Message id of the turn that redo applies to (the top frame), if any. */
export function getRedoMessageId(session: ActiveSessionViewModel): string | undefined {
  return session.undo.stack.at(-1);
}

/**
 * `true` when redo would recover from a failed undo rather than re-apply a
 * completed one. The frame disappears when the next prompt is sent.
 */
export function isRedoRecovery(session: ActiveSessionViewModel): boolean {
  const { stack, stackRestoreFailed } = session.undo;
  return stack.length > 0 && Boolean(stackRestoreFailed[stack.length - 1]);
}

export function getCurrentUndoTarget(session: ActiveSessionViewModel): UndoableSessionTurn | null {
  const turns = getUndoableSessionTurns(session);
  const frontier = getCommittedUndoFrontier(session);
  const frontierIndex = frontier ? turns.findIndex((turn) => turn.messageId === frontier) : turns.length;
  const end = frontierIndex >= 0 ? frontierIndex : turns.length;
  return turns.slice(0, end).at(-1) ?? null;
}

export function canUndoToMessage(session: ActiveSessionViewModel, messageId: string): boolean {
  const turns = getUndoableSessionTurns(session);
  const targetIndex = turns.findIndex((turn) => turn.messageId === messageId);
  if (targetIndex < 0) return false;

  const frontier = getCommittedUndoFrontier(session);
  if (!frontier) return true;
  const frontierIndex = turns.findIndex((turn) => turn.messageId === frontier);
  return frontierIndex < 0 || targetIndex < frontierIndex;
}

export function isTurnReverted(session: ActiveSessionViewModel, messageId: string): boolean {
  const turns = getUndoableSessionTurns(session);
  const targetIndex = turns.findIndex((turn) => turn.messageId === messageId);
  const frontier = getCommittedUndoFrontier(session);
  const frontierIndex = frontier ? turns.findIndex((turn) => turn.messageId === frontier) : -1;
  return targetIndex >= 0 && frontierIndex >= 0 && targetIndex >= frontierIndex;
}

export interface SessionUndoNotice {
  /** Message id of the turn the notice is anchored to (the redo frame's turn). */
  messageId: string;
  /** Turns currently hidden behind the undo frontier. Zero while recovering. */
  revertedTurns: number;
  /** The newest undo failed part-way: redo restores the workspace from before it. */
  recovery: boolean;
  /** Files restored by the last undo. In memory only, so empty after a reload. */
  files: string[];
  /** Failure message for a recovery notice, when known. */
  message: string | null;
}

/** Describes the undo state to show above the turn that redo applies to. */
export function getSessionUndoNotice(session: ActiveSessionViewModel): SessionUndoNotice | null {
  const messageId = getRedoMessageId(session);
  if (!messageId) return null;
  const turns = getUndoableSessionTurns(session);
  const recovery = isRedoRecovery(session);
  // A failed undo stays recoverable even when its turn is outside the loaded history.
  if (!recovery && !turns.some((turn) => turn.messageId === messageId)) return null;

  const frontier = getCommittedUndoFrontier(session);
  const frontierIndex = frontier ? turns.findIndex((turn) => turn.messageId === frontier) : -1;
  return {
    messageId,
    revertedTurns: recovery || frontierIndex < 0 ? 0 : turns.length - frontierIndex,
    recovery,
    files: recovery ? [] : session.undo.lastRevertedFiles,
    message: recovery ? session.undo.lastMessage : null
  };
}

export function getUndoAffectedTurnCount(session: ActiveSessionViewModel, messageId: string): number {
  const turns = getUndoableSessionTurns(session);
  const targetIndex = turns.findIndex((turn) => turn.messageId === messageId);
  if (targetIndex < 0) return 0;

  const frontier = getCommittedUndoFrontier(session);
  const frontierIndex = frontier ? turns.findIndex((turn) => turn.messageId === frontier) : turns.length;
  const end = frontierIndex >= 0 ? frontierIndex : turns.length;
  return Math.max(0, end - targetIndex);
}
