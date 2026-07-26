import type { SessionConversationTurn } from '$lib/domain/session-conversation';

export interface SessionForkTarget {
  messageId: string;
  prompt: string;
  response: string;
  includesResponse: boolean;
}

export function getForkTarget(turn: SessionConversationTurn): SessionForkTarget | null {
  if (!turn.forkMessageId) return null;
  const response = turn.content
    .filter((item) => item.type === 'assistant')
    .map((item) => item.text)
    .join('')
    .trim();

  return {
    messageId: turn.forkMessageId,
    prompt: turn.user?.text ?? '',
    response,
    includesResponse: turn.content.some((item) => item.type === 'assistant' && item.messageId === turn.forkMessageId)
  };
}

export function getLatestForkTarget(
  turns: SessionConversationTurn[],
  revertedMessageIds: ReadonlySet<string> = new Set()
): SessionForkTarget | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.user?.messageId && revertedMessageIds.has(turn.user.messageId)) continue;
    const target = getForkTarget(turn);
    if (target) return target;
  }
  return null;
}
