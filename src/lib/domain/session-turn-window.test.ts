import { describe, expect, it } from 'vitest';
import type { SessionConversationTurn } from './session-conversation';
import {
  SESSION_TURN_DEFAULT_HEIGHT,
  getConversationViewport,
  windowSessionTurns,
  type SessionTurnHeightMap
} from './session-turn-window';

function turn(id: string, settled: boolean): SessionConversationTurn {
  return {
    id,
    forkMessageId: null,
    settled,
    content: []
  };
}

function ids(items: ReturnType<typeof windowSessionTurns>): string[] {
  return items.map((item) => (item.type === 'turn' ? item.turn.id : `spacer:${item.height}`));
}

describe('windowSessionTurns', () => {
  it('renders every turn when the viewport has not been measured', () => {
    const turns = [turn('a', true), turn('b', true), turn('c', false)];

    expect(windowSessionTurns(turns, { top: 0, height: 0 }, {}).map((item) => item.type)).toEqual([
      'turn',
      'turn',
      'turn'
    ]);
  });

  it('replaces offscreen settled turns with coalesced spacers', () => {
    const turns = Array.from({ length: 6 }, (_, index) => turn(`t${index}`, true));
    const heights: SessionTurnHeightMap = Object.fromEntries(turns.map((item) => [item.id, 100]));

    const items = windowSessionTurns(turns, { top: 220, height: 150 }, heights, {
      overscan: 0,
      defaultHeight: 100
    });

    expect(ids(items)).toEqual(['spacer:200', 't2', 't3', 'spacer:200']);
  });

  it('keeps the live turn even when it is outside the viewport window', () => {
    const turns = [
      ...Array.from({ length: 5 }, (_, index) => turn(`s${index}`, true)),
      turn('live', false)
    ];

    const items = windowSessionTurns(turns, { top: 0, height: 100 }, {}, {
      overscan: 0,
      defaultHeight: 100
    });

    expect(ids(items)).toEqual(['s0', 'spacer:400', 'live']);
    expect(items.at(-1)).toMatchObject({ type: 'turn', turn: { id: 'live' } });
  });

  it('uses measured heights and the default height for unmeasured settled turns', () => {
    const turns = [turn('a', true), turn('b', true), turn('c', true)];
    const items = windowSessionTurns(turns, { top: 0, height: 30 }, { a: 40 }, {
      overscan: 0,
      defaultHeight: SESSION_TURN_DEFAULT_HEIGHT
    });

    expect(ids(items)).toEqual(['a', `spacer:${SESSION_TURN_DEFAULT_HEIGHT * 2}`]);
  });

  it('includes grid gap inside coalesced spacers', () => {
    const turns = [turn('a', true), turn('b', true), turn('c', true), turn('d', true)];
    const items = windowSessionTurns(turns, { top: 0, height: 100 }, {}, {
      overscan: 0,
      defaultHeight: 100,
      gap: 10
    });

    expect(ids(items)).toEqual(['a', 'spacer:320']);
  });

  it('maps the conversation into viewport-relative scroll coordinates', () => {
    expect(getConversationViewport(200, 0, 640)).toEqual({ top: 0, height: 640 });
    expect(getConversationViewport(-480, 0, 640)).toEqual({ top: 480, height: 640 });
    expect(getConversationViewport(80, 80, 400)).toEqual({ top: 0, height: 400 });
  });

  it('pins a follow-scroll viewport to estimated content instead of collapsing to spacers', () => {
    const turns = Array.from({ length: 20 }, (_, index) => turn(`t${index}`, true));
    const items = windowSessionTurns(turns, { top: 8000, height: 700 }, {}, {
      overscan: 0,
      defaultHeight: 100
    });

    expect(ids(items)).toEqual(['spacer:1300', 't13', 't14', 't15', 't16', 't17', 't18', 't19']);
  });

  it('renders every turn if clamping still produces no visible turn', () => {
    const turns = [turn('a', true), turn('b', true)];
    const items = windowSessionTurns(turns, { top: 8000, height: 700 }, {}, {
      overscan: 0,
      defaultHeight: 0
    });

    expect(ids(items)).toEqual(['a', 'b']);
  });
});
