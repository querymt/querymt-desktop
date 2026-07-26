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

export function getCurrentUndoTarget(session: ActiveSessionViewModel): UndoableSessionTurn | null {
  const turns = getUndoableSessionTurns(session);
  const frontier = session.undo.stack.at(-1);
  const frontierIndex = frontier ? turns.findIndex((turn) => turn.messageId === frontier) : turns.length;
  const end = frontierIndex >= 0 ? frontierIndex : turns.length;
  return turns.slice(0, end).at(-1) ?? null;
}

export function canUndoToMessage(session: ActiveSessionViewModel, messageId: string): boolean {
  const turns = getUndoableSessionTurns(session);
  const targetIndex = turns.findIndex((turn) => turn.messageId === messageId);
  if (targetIndex < 0) return false;

  const frontier = session.undo.stack.at(-1);
  if (!frontier) return true;
  const frontierIndex = turns.findIndex((turn) => turn.messageId === frontier);
  return frontierIndex < 0 || targetIndex < frontierIndex;
}

export function isTurnReverted(session: ActiveSessionViewModel, messageId: string): boolean {
  const turns = getUndoableSessionTurns(session);
  const targetIndex = turns.findIndex((turn) => turn.messageId === messageId);
  const frontier = session.undo.stack.at(-1);
  const frontierIndex = frontier ? turns.findIndex((turn) => turn.messageId === frontier) : -1;
  return targetIndex >= 0 && frontierIndex >= 0 && targetIndex >= frontierIndex;
}

export function getUndoAffectedTurnCount(session: ActiveSessionViewModel, messageId: string): number {
  const turns = getUndoableSessionTurns(session);
  const targetIndex = turns.findIndex((turn) => turn.messageId === messageId);
  if (targetIndex < 0) return 0;

  const frontier = session.undo.stack.at(-1);
  const frontierIndex = frontier ? turns.findIndex((turn) => turn.messageId === frontier) : turns.length;
  const end = frontierIndex >= 0 ? frontierIndex : turns.length;
  return Math.max(0, end - targetIndex);
}
