import { describe, expect, it, vi } from 'vitest';
import {
  createFollowScrollScheduler,
  getDistanceFromBottom,
  nextSessionChatPresentationState,
  nextSessionScrollMode,
  observeScrollSettle,
  sessionFollowPinClass,
  shouldKeepProgrammaticScroll,
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

  it('holds a free programmatic jump that lands in the rejoin band until it is released', () => {
    let mode: ReturnType<typeof nextSessionScrollMode> = 'following';
    let programmatic = false;
    const distanceFromBottom = SESSION_SCROLL_REJOIN_THRESHOLD;

    programmatic = true;
    mode = 'free';

    if (programmatic) {
      if (!shouldKeepProgrammaticScroll(mode, distanceFromBottom)) programmatic = false;
    } else {
      mode = nextSessionScrollMode(mode, distanceFromBottom, 'down');
    }

    expect(programmatic).toBe(true);
    expect(mode).toBe('free');

    programmatic = false;
    expect(nextSessionScrollMode(mode, distanceFromBottom, 'down')).toBe('following');
  });

  it('still lets follow-mode programmatic jumps self-release in the rejoin band', () => {
    expect(shouldKeepProgrammaticScroll('following', 0)).toBe(false);
    expect(shouldKeepProgrammaticScroll('following', SESSION_SCROLL_REJOIN_THRESHOLD)).toBe(false);
    expect(shouldKeepProgrammaticScroll('following', SESSION_SCROLL_REJOIN_THRESHOLD + 1)).toBe(true);
    expect(shouldKeepProgrammaticScroll('free', 0)).toBe(true);
  });

  it('lets user input cancel programmatic free-scroll and rejoin from the rejoin band', () => {
    expect(shouldKeepProgrammaticScroll('free', 0)).toBe(true);
    expect(nextSessionScrollMode('free', 0, 'down')).toBe('following');
  });
});

describe('programmatic scroll settle', () => {
  function fakeFrames() {
    const frames: FrameRequestCallback[] = [];
    return {
      frames,
      requestFrame: (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      },
      cancelFrame: (id: number) => {
        if (id === frames.length) frames.pop();
      },
      runNext() {
        frames.shift()?.(0);
      }
    };
  }

  it('settles after a grace frame plus two idle frames when scrollend never fires', () => {
    const target = new EventTarget();
    const onSettle = vi.fn();
    const frames = fakeFrames();
    observeScrollSettle(target, onSettle, frames.requestFrame, frames.cancelFrame);

    expect(onSettle).not.toHaveBeenCalled();
    frames.runNext();
    expect(onSettle).not.toHaveBeenCalled();
    frames.runNext();
    expect(onSettle).not.toHaveBeenCalled();
    frames.runNext();
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it('waits through movement frames before settling on idle', () => {
    const target = new EventTarget();
    const onSettle = vi.fn();
    const frames = fakeFrames();
    observeScrollSettle(target, onSettle, frames.requestFrame, frames.cancelFrame);

    frames.runNext();
    target.dispatchEvent(new Event('scroll'));
    frames.runNext();
    expect(onSettle).not.toHaveBeenCalled();
    frames.runNext();
    expect(onSettle).not.toHaveBeenCalled();
    frames.runNext();
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it('settles immediately on scrollend and ignores later idle frames', () => {
    const target = new EventTarget();
    const onSettle = vi.fn();
    const frames = fakeFrames();
    observeScrollSettle(target, onSettle, frames.requestFrame, frames.cancelFrame);

    target.dispatchEvent(new Event('scroll'));
    target.dispatchEvent(new Event('scrollend'));
    expect(onSettle).toHaveBeenCalledOnce();
    frames.runNext();
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it('abort prevents a later scrollend from settling', () => {
    const target = new EventTarget();
    const onSettle = vi.fn();
    const abort = observeScrollSettle(target, onSettle, () => 1, () => undefined);
    abort();
    target.dispatchEvent(new Event('scrollend'));
    expect(onSettle).not.toHaveBeenCalled();
  });
});

describe('session follow pin', () => {
  it('enables the CSS pin class only while following', () => {
    expect(sessionFollowPinClass('following')).toBe('session-page-following');
    expect(sessionFollowPinClass('free')).toBe('');
  });

  it('coalesces multiple follow requests into one pin per frame', () => {
    const frames: FrameRequestCallback[] = [];
    const pin = vi.fn();
    const scheduler = createFollowScrollScheduler(
      pin,
      () => true,
      (cb) => {
        frames.push(cb);
        return frames.length;
      },
      (id) => {
        if (id === frames.length) frames.pop();
      }
    );

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    expect(frames).toHaveLength(1);
    expect(pin).not.toHaveBeenCalled();
    frames[0](0);
    expect(pin).toHaveBeenCalledTimes(1);
  });

  it('does not pin when follow mode is inactive', () => {
    const frames: FrameRequestCallback[] = [];
    const pin = vi.fn();
    const scheduler = createFollowScrollScheduler(
      pin,
      () => false,
      (cb) => {
        frames.push(cb);
        return frames.length;
      },
      () => undefined
    );

    scheduler.schedule();
    frames[0](0);
    expect(pin).not.toHaveBeenCalled();
  });

  it('schedules another pin after the current frame runs', () => {
    const frames: FrameRequestCallback[] = [];
    const pin = vi.fn();
    const scheduler = createFollowScrollScheduler(
      pin,
      () => true,
      (cb) => {
        frames.push(cb);
        return frames.length;
      },
      () => undefined
    );

    scheduler.schedule();
    frames.shift()?.(0);
    scheduler.schedule();
    frames.shift()?.(0);

    expect(pin).toHaveBeenCalledTimes(2);
  });

  it('can be constructed when requestAnimationFrame is unavailable', () => {
    const originalRequest = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    // @ts-expect-error -- simulate SSR / Node, where rAF is missing
    delete globalThis.requestAnimationFrame;
    // @ts-expect-error -- simulate SSR / Node, where rAF is missing
    delete globalThis.cancelAnimationFrame;

    try {
      expect(() => createFollowScrollScheduler(() => undefined, () => true)).not.toThrow();
    } finally {
      if (originalRequest === undefined) {
        // @ts-expect-error -- restore a missing rAF global as absent
        delete globalThis.requestAnimationFrame;
      } else {
        globalThis.requestAnimationFrame = originalRequest;
      }
      if (originalCancel === undefined) {
        // @ts-expect-error -- restore a missing rAF global as absent
        delete globalThis.cancelAnimationFrame;
      } else {
        globalThis.cancelAnimationFrame = originalCancel;
      }
    }
  });

  it('cancel drops the pending pin', () => {
    const frames: FrameRequestCallback[] = [];
    const pin = vi.fn();
    const scheduler = createFollowScrollScheduler(
      pin,
      () => true,
      (cb) => {
        frames.push(cb);
        return frames.length;
      },
      (id) => {
        if (id === frames.length) frames.pop();
      }
    );

    scheduler.schedule();
    scheduler.cancel();
    expect(frames).toHaveLength(0);
    expect(pin).not.toHaveBeenCalled();
  });
});
