import { describe, expect, it } from 'vitest';
import type { SessionConversationTurn } from './session-conversation';
import {
  SESSION_TURN_NAV_VISIBLE_GAP,
  absoluteContentOffset,
  activeSessionTurnNavId,
  adjacentResponseNavId,
  alignedScrollTop,
  buildSessionTurnNavigation,
  estimateSessionTurnNavRanges,
  groupSessionTurnNavItems,
  scrollDeltaToRevealRect,
  scrollViewportOriginTop,
  sessionTurnNavItemId,
  sessionTurnNavItemLabel,
  sessionTurnNavRoughOffset,
  sessionTurnNavTargetOffset,
  visibleContentInset
} from './session-turn-navigation';

function turn(
  id: string,
  options: { user?: boolean; content?: boolean } = { user: true, content: true }
): SessionConversationTurn {
  return {
    id,
    forkMessageId: null,
    user: options.user
      ? { id: `${id}-user`, messageId: null, html: '<p>hi</p>', text: 'hi' }
      : undefined,
    content: options.content
      ? [
          {
            type: 'assistant',
            id: `${id}-assistant`,
            messageId: null,
            html: '<p>ok</p>',
            text: 'ok',
            relatedEvents: []
          }
        ]
      : []
  };
}

describe('buildSessionTurnNavigation', () => {
  it('emits request and response ticks with per-kind ordinals', () => {
    expect(buildSessionTurnNavigation([turn('t1'), turn('t2')])).toEqual([
      { id: 't1:request', turnId: 't1', kind: 'request', label: 'User request 1 of 2' },
      { id: 't1:response', turnId: 't1', kind: 'response', label: 'Agent response 1 of 2' },
      { id: 't2:request', turnId: 't2', kind: 'request', label: 'User request 2 of 2' },
      { id: 't2:response', turnId: 't2', kind: 'response', label: 'Agent response 2 of 2' }
    ]);
  });

  it('omits missing request or response parts and counts only present items', () => {
    expect(
      buildSessionTurnNavigation([
        turn('user-only', { user: true, content: false }),
        turn('response-only', { user: false, content: true })
      ])
    ).toEqual([
      { id: 'user-only:request', turnId: 'user-only', kind: 'request', label: 'User request 1 of 1' },
      {
        id: 'response-only:response',
        turnId: 'response-only',
        kind: 'response',
        label: 'Agent response 1 of 1'
      }
    ]);
  });

  it('returns no items for an empty conversation', () => {
    expect(buildSessionTurnNavigation([])).toEqual([]);
  });

  it('builds stable part ids and ordinal labels', () => {
    expect(sessionTurnNavItemId('turn-user-1', 'request')).toBe('turn-user-1:request');
    expect(sessionTurnNavItemId('turn-user-1', 'response')).toBe('turn-user-1:response');
    expect(sessionTurnNavItemLabel('request', 2, 12)).toBe('User request 2 of 12');
    expect(sessionTurnNavItemLabel('response', 2, 12)).toBe('Agent response 2 of 12');
  });

  it('groups consecutive parts from the same turn', () => {
    expect(groupSessionTurnNavItems(buildSessionTurnNavigation([turn('t1'), turn('t2')]))).toEqual([
      [
        { id: 't1:request', turnId: 't1', kind: 'request', label: 'User request 1 of 2' },
        { id: 't1:response', turnId: 't1', kind: 'response', label: 'Agent response 1 of 2' }
      ],
      [
        { id: 't2:request', turnId: 't2', kind: 'request', label: 'User request 2 of 2' },
        { id: 't2:response', turnId: 't2', kind: 'response', label: 'Agent response 2 of 2' }
      ]
    ]);
  });
});

describe('estimateSessionTurnNavRanges', () => {
  const items = buildSessionTurnNavigation([turn('a'), turn('b')]);

  it('splits unmeasured turns in half and includes the conversation gap', () => {
    expect(estimateSessionTurnNavRanges(items, { a: 100, b: 80 }, {}, { gap: 10 })).toEqual([
      { id: 'a:request', start: 0 },
      { id: 'a:response', start: 50 },
      { id: 'b:request', start: 110 },
      { id: 'b:response', start: 150 }
    ]);
  });

  it('uses measured request height and attributes the remaining turn height to the response', () => {
    expect(
      estimateSessionTurnNavRanges(items, { a: 120, b: 100 }, { 'a:request': 40 }, { gap: 0 })[0]
    ).toEqual({ id: 'a:request', start: 0 });
    expect(
      estimateSessionTurnNavRanges(items, { a: 120, b: 100 }, { 'a:request': 40 }, { gap: 0 })[1]
    ).toEqual({ id: 'a:response', start: 40 });
  });

  it('covers a request-only turn with the full measured height', () => {
    const requestOnly = buildSessionTurnNavigation([turn('solo', { user: true, content: false })]);
    expect(estimateSessionTurnNavRanges(requestOnly, { solo: 70 }, {})).toEqual([
      { id: 'solo:request', start: 0 }
    ]);
  });
});

describe('activeSessionTurnNavId', () => {
  const ranges = estimateSessionTurnNavRanges(
    buildSessionTurnNavigation([turn('a'), turn('b')]),
    { a: 100, b: 80 },
    {},
    { gap: 10 }
  );

  it('highlights the last part whose start has reached the read position', () => {
    expect(activeSessionTurnNavId(ranges, 0)).toBe('a:request');
    expect(activeSessionTurnNavId(ranges, 50)).toBe('a:response');
    expect(activeSessionTurnNavId(ranges, 109)).toBe('a:response');
    expect(activeSessionTurnNavId(ranges, 110)).toBe('b:request');
    expect(activeSessionTurnNavId(ranges, 400)).toBe('b:response');
  });

  it('returns null when there are no ranges', () => {
    expect(activeSessionTurnNavId([], 0)).toBeNull();
  });
});

describe('adjacentResponseNavId', () => {
  const items = buildSessionTurnNavigation([turn('a'), turn('b')]);

  it('jumps across request ticks to neighboring responses', () => {
    expect(adjacentResponseNavId(items, 'a:request', 'previous')).toBeNull();
    expect(adjacentResponseNavId(items, 'a:request', 'next')).toBe('a:response');
    expect(adjacentResponseNavId(items, 'a:response', 'previous')).toBeNull();
    expect(adjacentResponseNavId(items, 'a:response', 'next')).toBe('b:response');
    expect(adjacentResponseNavId(items, 'b:request', 'previous')).toBe('a:response');
    expect(adjacentResponseNavId(items, 'b:request', 'next')).toBe('b:response');
    expect(adjacentResponseNavId(items, 'b:response', 'previous')).toBe('a:response');
    expect(adjacentResponseNavId(items, 'b:response', 'next')).toBeNull();
  });

  it('treats a missing active item as the start of the list', () => {
    expect(adjacentResponseNavId(items, null, 'previous')).toBeNull();
    expect(adjacentResponseNavId(items, null, 'next')).toBe('a:response');
  });

  it('disables both directions when no agent responses exist', () => {
    const requests = buildSessionTurnNavigation([
      turn('a', { user: true, content: false }),
      turn('b', { user: true, content: false })
    ]);
    expect(adjacentResponseNavId(requests, 'a:request', 'next')).toBeNull();
    expect(adjacentResponseNavId(requests, 'b:request', 'previous')).toBeNull();
  });
});

describe('sessionTurnNavTargetOffset', () => {
  it('returns the start of the requested part', () => {
    const ranges = [
      { id: 'a:request', start: 0 },
      { id: 'a:response', start: 40 }
    ];
    expect(sessionTurnNavTargetOffset(ranges, 'a:response')).toBe(40);
    expect(sessionTurnNavTargetOffset(ranges, 'missing')).toBeNull();
  });
});

describe('sessionTurnNavRoughOffset', () => {
  it('uses the enclosing turn start so a tall unmeasured request is not split in half', () => {
    const items = buildSessionTurnNavigation([turn('a'), turn('b')]);
    const ranges = estimateSessionTurnNavRanges(items, { a: 160, b: 160 }, {}, { gap: 0 });
    expect(sessionTurnNavTargetOffset(ranges, 'a:response')).toBe(80);
    expect(sessionTurnNavRoughOffset(items, ranges, 'a:response')).toBe(0);
    expect(sessionTurnNavRoughOffset(items, ranges, 'b:response')).toBe(160);
    expect(sessionTurnNavRoughOffset(items, ranges, 'missing')).toBeNull();
  });
});

describe('visible content geometry', () => {
  it('uses the custom scroller top as origin and document origin 0', () => {
    expect(scrollViewportOriginTop(48, true)).toBe(48);
    expect(scrollViewportOriginTop(48, false)).toBe(0);
  });

  it('computes absolute content offset and aligned scroll from one inset', () => {
    expect(absoluteContentOffset(200, 80, 0)).toBe(280);
    expect(absoluteContentOffset(200, 80, 40)).toBe(240);
    expect(alignedScrollTop(280, 88)).toBe(192);
    expect(alignedScrollTop(50, 88)).toBe(0);
  });

  it('clears the sticky header instead of a 32px magic read line', () => {
    expect(visibleContentInset(72, 0)).toBe(72 + SESSION_TURN_NAV_VISIBLE_GAP);
    expect(visibleContentInset(112, 40)).toBe(72 + SESSION_TURN_NAV_VISIBLE_GAP);
    expect(visibleContentInset(null, 0)).toBe(SESSION_TURN_NAV_VISIBLE_GAP);
    expect(visibleContentInset(20, 40)).toBe(SESSION_TURN_NAV_VISIBLE_GAP);

    const inset = visibleContentInset(72, 0);
    expect(inset).toBe(88);
    expect(alignedScrollTop(absoluteContentOffset(0, 500, 0), inset)).toBe(412);
  });

  it('aligns a mounted target below a sticky header in a custom scroller', () => {
    const origin = scrollViewportOriginTop(40, true);
    const inset = visibleContentInset(112, origin);
    expect(origin).toBe(40);
    expect(inset).toBe(88);
    expect(alignedScrollTop(absoluteContentOffset(50, 200, origin), inset)).toBe(122);
  });

  it('returns the minimal tick-scroller delta that reveals the active button', () => {
    expect(scrollDeltaToRevealRect({ top: 100, bottom: 160 }, { top: 400, bottom: 424 })).toBe(264);
    expect(scrollDeltaToRevealRect({ top: 100, bottom: 160 }, { top: 80, bottom: 104 })).toBe(-20);
    expect(scrollDeltaToRevealRect({ top: 100, bottom: 160 }, { top: 110, bottom: 134 })).toBe(0);
  });
});
