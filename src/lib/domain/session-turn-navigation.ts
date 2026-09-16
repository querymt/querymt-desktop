import type { SessionConversationTurn } from './session-conversation';
import { SESSION_TURN_DEFAULT_HEIGHT, type SessionTurnHeightMap } from './session-turn-window';

export type SessionTurnNavKind = 'request' | 'response';

export type SessionTurnNavItem = {
  id: string;
  turnId: string;
  kind: SessionTurnNavKind;
  label: string;
};

export type SessionTurnNavRange = {
  id: string;
  start: number;
};

export type SessionTurnPartHeightMap = Record<string, number>;

export const SESSION_TURN_NAV_VISIBLE_GAP = 16;

export function sessionTurnNavItemId(turnId: string, kind: SessionTurnNavKind): string {
  return `${turnId}:${kind}`;
}

export function sessionTurnNavItemLabel(kind: SessionTurnNavKind, index: number, total: number): string {
  const noun = kind === 'request' ? 'User request' : 'Agent response';
  return `${noun} ${index} of ${total}`;
}

export function groupSessionTurnNavItems(items: SessionTurnNavItem[]): SessionTurnNavItem[][] {
  const groups: SessionTurnNavItem[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0].turnId === item.turnId) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

export function buildSessionTurnNavigation(turns: SessionConversationTurn[]): SessionTurnNavItem[] {
  let requestTotal = 0;
  let responseTotal = 0;
  for (const turn of turns) {
    if (turn.user) requestTotal += 1;
    if (turn.content.length > 0) responseTotal += 1;
  }

  const items: SessionTurnNavItem[] = [];
  let requestIndex = 0;
  let responseIndex = 0;
  for (const turn of turns) {
    if (turn.user) {
      requestIndex += 1;
      items.push({
        id: sessionTurnNavItemId(turn.id, 'request'),
        turnId: turn.id,
        kind: 'request',
        label: sessionTurnNavItemLabel('request', requestIndex, requestTotal)
      });
    }
    if (turn.content.length > 0) {
      responseIndex += 1;
      items.push({
        id: sessionTurnNavItemId(turn.id, 'response'),
        turnId: turn.id,
        kind: 'response',
        label: sessionTurnNavItemLabel('response', responseIndex, responseTotal)
      });
    }
  }
  return items;
}

export function estimateSessionTurnNavRanges(
  items: SessionTurnNavItem[],
  turnHeights: SessionTurnHeightMap,
  partHeights: SessionTurnPartHeightMap,
  options?: { defaultHeight?: number; gap?: number }
): SessionTurnNavRange[] {
  if (items.length === 0) return [];

  const defaultHeight = options?.defaultHeight ?? SESSION_TURN_DEFAULT_HEIGHT;
  const gap = options?.gap ?? 0;
  const groups = groupSessionTurnNavItems(items);

  const ranges: SessionTurnNavRange[] = [];
  let offset = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const turnHeight = Math.max(0, turnHeights[group[0].turnId] ?? defaultHeight);
    const request = group.find((item) => item.kind === 'request');
    const response = group.find((item) => item.kind === 'response');

    if (request && response) {
      const { requestHeight } = splitTurnPartHeights(
        turnHeight,
        partHeights[request.id],
        partHeights[response.id]
      );
      ranges.push({ id: request.id, start: offset });
      ranges.push({ id: response.id, start: offset + requestHeight });
    } else {
      const item = request ?? response;
      if (item) ranges.push({ id: item.id, start: offset });
    }

    offset += turnHeight + (index < groups.length - 1 ? gap : 0);
  }
  return ranges;
}

export function activeSessionTurnNavId(ranges: SessionTurnNavRange[], readY: number): string | null {
  if (ranges.length === 0) return null;
  let activeId = ranges[0].id;
  for (const range of ranges) {
    if (range.start <= readY) activeId = range.id;
    else break;
  }
  return activeId;
}

export function adjacentResponseNavId(
  items: SessionTurnNavItem[],
  activeId: string | null,
  direction: 'previous' | 'next'
): string | null {
  if (items.length === 0) return null;
  if (activeId == null) {
    return direction === 'next' ? items.find((item) => item.kind === 'response')?.id ?? null : null;
  }

  const activeIndex = items.findIndex((item) => item.id === activeId);
  const start = activeIndex >= 0 ? activeIndex : direction === 'next' ? -1 : items.length;
  if (direction === 'previous') {
    for (let index = start - 1; index >= 0; index -= 1) {
      if (items[index].kind === 'response') return items[index].id;
    }
    return null;
  }
  for (let index = start + 1; index < items.length; index += 1) {
    if (items[index].kind === 'response') return items[index].id;
  }
  return null;
}

export function sessionTurnNavTargetOffset(ranges: SessionTurnNavRange[], itemId: string): number | null {
  const range = ranges.find((item) => item.id === itemId);
  return range ? range.start : null;
}

export function sessionTurnNavRoughOffset(
  items: SessionTurnNavItem[],
  ranges: SessionTurnNavRange[],
  itemId: string
): number | null {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return null;
  const turnIds = new Set(items.filter((entry) => entry.turnId === item.turnId).map((entry) => entry.id));
  const first = ranges.find((range) => turnIds.has(range.id));
  return first ? first.start : null;
}

export function scrollViewportOriginTop(scrollerTop: number, isCustomScroller: boolean): number {
  return isCustomScroller ? scrollerTop : 0;
}

export function absoluteContentOffset(scrollTop: number, nodeTop: number, viewportOrigin: number): number {
  return scrollTop + nodeTop - viewportOrigin;
}

export function alignedScrollTop(contentOffset: number, visibleInset: number): number {
  return Math.max(0, contentOffset - visibleInset);
}

export function visibleContentInset(
  headerBottom: number | null | undefined,
  viewportOrigin: number,
  gap = SESSION_TURN_NAV_VISIBLE_GAP
): number {
  if (headerBottom == null) return gap;
  return Math.max(0, headerBottom - viewportOrigin) + gap;
}

export function scrollDeltaToRevealRect(
  container: { top: number; bottom: number },
  item: { top: number; bottom: number }
): number {
  if (item.top < container.top) return item.top - container.top;
  if (item.bottom > container.bottom) return item.bottom - container.bottom;
  return 0;
}

function splitTurnPartHeights(
  turnHeight: number,
  measuredRequest?: number,
  measuredResponse?: number
): { requestHeight: number; responseHeight: number } {
  if (measuredRequest != null && measuredResponse != null) {
    const measured = measuredRequest + measuredResponse;
    if (measured <= 0) {
      const requestHeight = Math.round(turnHeight / 2);
      return { requestHeight, responseHeight: Math.max(0, turnHeight - requestHeight) };
    }
    if (measured >= turnHeight) {
      const requestHeight = Math.round((measuredRequest / measured) * turnHeight);
      return { requestHeight, responseHeight: Math.max(0, turnHeight - requestHeight) };
    }
    return {
      requestHeight: measuredRequest,
      responseHeight: turnHeight - measuredRequest
    };
  }
  if (measuredRequest != null) {
    const requestHeight = Math.min(Math.max(0, measuredRequest), turnHeight);
    return { requestHeight, responseHeight: Math.max(0, turnHeight - requestHeight) };
  }
  if (measuredResponse != null) {
    const responseHeight = Math.min(Math.max(0, measuredResponse), turnHeight);
    return { requestHeight: Math.max(0, turnHeight - responseHeight), responseHeight };
  }
  const requestHeight = Math.round(turnHeight / 2);
  return { requestHeight, responseHeight: Math.max(0, turnHeight - requestHeight) };
}
