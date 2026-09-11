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

export function estimateConversationHeight(
  turns: SessionConversationTurn[],
  heights: SessionTurnHeightMap,
  options?: { defaultHeight?: number; gap?: number }
): number {
  if (turns.length === 0) return 0;
  const defaultHeight = options?.defaultHeight ?? SESSION_TURN_DEFAULT_HEIGHT;
  const gap = options?.gap ?? 0;
  let height = 0;
  for (let index = 0; index < turns.length; index += 1) {
    height += heights[turns[index].id] ?? defaultHeight;
    if (index < turns.length - 1) height += gap;
  }
  return height;
}

export function windowSessionTurns(
  turns: SessionConversationTurn[],
  viewport: SessionTurnWindowViewport,
  heights: SessionTurnHeightMap,
  options?: { overscan?: number; defaultHeight?: number; gap?: number }
): SessionTurnWindowItem[] {
  if (turns.length === 0) return [];
  if (viewport.height <= 0) {
    return turns.map((turn) => ({ type: 'turn' as const, turn }));
  }

  const overscan = options?.overscan ?? SESSION_TURN_OVERSCAN;
  const defaultHeight = options?.defaultHeight ?? SESSION_TURN_DEFAULT_HEIGHT;
  const gap = options?.gap ?? 0;
  const contentHeight = estimateConversationHeight(turns, heights, { defaultHeight, gap });
  // Follow-scroll after load measures the real (tall) conversation, then
  // windowing still uses 160px estimates. That puts viewport.top past every
  // estimated turn, so the list collapses to spacers until a resize measures
  // heights. Pin the window to the estimated content so the last turns stay mounted.
  const top = Math.min(Math.max(0, viewport.top), Math.max(0, contentHeight - viewport.height));
  const windowTop = top - overscan;
  const windowBottom = top + viewport.height + overscan;
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
  if (!items.some((item) => item.type === 'turn')) {
    return turns.map((turn) => ({ type: 'turn' as const, turn }));
  }
  return items;
}
