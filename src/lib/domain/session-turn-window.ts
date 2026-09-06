import type { SessionConversationTurn } from './session-conversation';

export const SESSION_TURN_DEFAULT_HEIGHT = 160;
export const SESSION_TURN_OVERSCAN = 400;
export const SESSION_TURN_GAP = 14.4;

export type SessionTurnHeightMap = Record<string, number>;

export type SessionTurnWindowViewport = {
  top: number;
  height: number;
};

export type SessionTurnWindowItem =
  | { type: 'turn'; turn: SessionConversationTurn }
  | { type: 'spacer'; height: number; key: string };

export function getConversationViewport(
  rootTop: number,
  viewportTop: number,
  viewportHeight: number
): SessionTurnWindowViewport {
  return {
    top: Math.max(0, viewportTop - rootTop),
    height: Math.max(0, viewportHeight)
  };
}

export function windowSessionTurns(
  turns: SessionConversationTurn[],
  viewport: SessionTurnWindowViewport,
  heights: SessionTurnHeightMap,
  options?: { overscan?: number; defaultHeight?: number; gap?: number }
): SessionTurnWindowItem[] {
  if (viewport.height <= 0) {
    return turns.map((turn) => ({ type: 'turn' as const, turn }));
  }

  const overscan = options?.overscan ?? SESSION_TURN_OVERSCAN;
  const defaultHeight = options?.defaultHeight ?? SESSION_TURN_DEFAULT_HEIGHT;
  const gap = options?.gap ?? 0;
  const windowTop = viewport.top - overscan;
  const windowBottom = viewport.top + viewport.height + overscan;
  const items: SessionTurnWindowItem[] = [];
  let offset = 0;
  let spacerHeight = 0;
  let spacerStart = 0;

  function flushSpacer() {
    if (spacerHeight <= 0) return;
    items.push({
      type: 'spacer',
      height: spacerHeight,
      key: `spacer:${spacerStart}:${offset}`
    });
    spacerHeight = 0;
  }

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const height = heights[turn.id] ?? defaultHeight;
    const start = offset;
    const end = start + height;
    offset = end + (index < turns.length - 1 ? gap : 0);
    const live = turn.settled === false;
    const visible = live || (end > windowTop && start < windowBottom);
    if (visible) {
      flushSpacer();
      items.push({ type: 'turn', turn });
      continue;
    }
    if (spacerHeight === 0) spacerStart = start;
    else spacerHeight += gap;
    spacerHeight += height;
  }

  flushSpacer();
  return items;
}
