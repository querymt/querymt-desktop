import { describe, expect, it } from 'vitest';
import {
  getDistanceFromBottom,
  nextSessionChatPresentationState,
  nextSessionScrollMode,
  SESSION_COMPOSER_COLLAPSE_THRESHOLD,
  SESSION_SCROLL_LEAVE_THRESHOLD,
  SESSION_SCROLL_REJOIN_THRESHOLD
} from './session-scroll';

describe('session scroll state', () => {
  it('measures the remaining distance from the viewport bottom', () => {
    expect(getDistanceFromBottom({ scrollHeight: 1200, clientHeight: 500, scrollTop: 620 })).toBe(80);
    expect(getDistanceFromBottom({ scrollHeight: 400, clientHeight: 500, scrollTop: 0 })).toBe(0);
  });

  it('keeps the expanded composer during the initial free-scroll distance', () => {
    expect(nextSessionChatPresentationState('fixed-following', 'free', 1)).toBe('fixed-free-expanded');
    expect(
      nextSessionChatPresentationState('fixed-free-expanded', 'free', SESSION_COMPOSER_COLLAPSE_THRESHOLD)
    ).toBe('fixed-free-expanded');
  });

  it('collapses the composer after the safe free-scroll threshold and latches it', () => {
    const collapsed = nextSessionChatPresentationState(
      'fixed-free-expanded',
      'free',
      SESSION_COMPOSER_COLLAPSE_THRESHOLD + 1
    );

    expect(collapsed).toBe('fixed-free-compact');
    expect(nextSessionChatPresentationState(collapsed, 'free', 0)).toBe('fixed-free-compact');
  });

  it('restores the expanded composer when follow mode resumes', () => {
    expect(nextSessionChatPresentationState('fixed-free-compact', 'following', 0)).toBe('fixed-following');
  });

  it('keeps following during downward movement near the latest content', () => {
    expect(nextSessionScrollMode('following', SESSION_SCROLL_LEAVE_THRESHOLD, 'down')).toBe('following');
  });

  it('leaves follow mode on even a light upward movement', () => {
    expect(nextSessionScrollMode('following', 1, 'up')).toBe('free');
  });

  it('enters free mode when non-user movement exceeds the leave threshold', () => {
    expect(nextSessionScrollMode('following', SESSION_SCROLL_LEAVE_THRESHOLD + 1)).toBe('free');
  });

  it('stays free until downward intent reaches the tighter rejoin threshold', () => {
    expect(nextSessionScrollMode('free', SESSION_SCROLL_REJOIN_THRESHOLD + 1, 'down')).toBe('free');
    expect(nextSessionScrollMode('free', SESSION_SCROLL_REJOIN_THRESHOLD, 'none')).toBe('free');
    expect(nextSessionScrollMode('free', 0, 'down')).toBe('following');
  });
});
