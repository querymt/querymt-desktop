export type SessionScrollMode = 'following' | 'free';
export type SessionScrollDirection = 'up' | 'down' | 'none';
export type SessionChatPresentationState = 'fixed-following' | 'fixed-free-expanded' | 'fixed-free-compact';

export const SESSION_SCROLL_LEAVE_THRESHOLD = 48;
export const SESSION_SCROLL_REJOIN_THRESHOLD = 16;
export const SESSION_COMPOSER_COLLAPSE_THRESHOLD = 160;

export type ScrollMetrics = {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
};

export function getDistanceFromBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
}

export function nextSessionChatPresentationState(
  state: SessionChatPresentationState,
  mode: SessionScrollMode,
  distanceFromBottom: number,
  collapseThreshold = SESSION_COMPOSER_COLLAPSE_THRESHOLD
): SessionChatPresentationState {
  if (mode === 'following') return 'fixed-following';
  if (state === 'fixed-free-compact') return state;
  return distanceFromBottom > collapseThreshold ? 'fixed-free-compact' : 'fixed-free-expanded';
}

export function nextSessionScrollMode(
  mode: SessionScrollMode,
  distanceFromBottom: number,
  direction: SessionScrollDirection = 'none',
  leaveThreshold = SESSION_SCROLL_LEAVE_THRESHOLD,
  rejoinThreshold = SESSION_SCROLL_REJOIN_THRESHOLD
): SessionScrollMode {
  if (mode === 'following') {
    return direction === 'up' || distanceFromBottom > leaveThreshold ? 'free' : 'following';
  }

  return direction === 'down' && distanceFromBottom <= rejoinThreshold ? 'following' : 'free';
}

export function shouldKeepProgrammaticScroll(
  mode: SessionScrollMode,
  distanceFromBottom: number,
  rejoinThreshold = SESSION_SCROLL_REJOIN_THRESHOLD
): boolean {
  // Follow-mode programmatic jumps (load, send, pin-to-latest) self-release
  // once re-anchored in the rejoin band. Free-mode navigation must keep the
  // flag even when a downward target lands in that band, otherwise the same
  // scroll event would flip the session back to following.
  return mode === 'free' || distanceFromBottom > rejoinThreshold;
}

export function observeScrollSettle(
  target: EventTarget,
  onSettle: () => void,
  requestFrame: typeof requestAnimationFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame: typeof cancelAnimationFrame = (handle) => cancelAnimationFrame(handle)
): () => void {
  let settled = false;
  let pendingScroll = false;
  let idleFrames = 0;
  let armed = false;
  let frame: number | null = null;

  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    onSettle();
  };

  const onScroll = () => {
    pendingScroll = true;
  };
  const onScrollEnd = () => finish();

  const poll = () => {
    frame = null;
    if (settled) return;
    if (!armed) {
      armed = true;
      frame = requestFrame(poll);
      return;
    }
    if (pendingScroll) {
      pendingScroll = false;
      idleFrames = 0;
      frame = requestFrame(poll);
      return;
    }

    idleFrames += 1;
    if (idleFrames >= 2) {
      finish();
      return;
    }
    frame = requestFrame(poll);
  };

  target.addEventListener('scroll', onScroll, { passive: true });
  target.addEventListener('scrollend', onScrollEnd);
  frame = requestFrame(poll);

  function cleanup() {
    target.removeEventListener('scroll', onScroll);
    target.removeEventListener('scrollend', onScrollEnd);
    if (frame === null) return;
    cancelFrame(frame);
    frame = null;
  }

  return () => {
    if (settled) return;
    settled = true;
    cleanup();
  };
}

export function sessionFollowPinClass(mode: SessionScrollMode): string {
  return mode === 'following' ? 'session-page-following' : '';
}

export type FollowScrollScheduler = {
  schedule: () => void;
  cancel: () => void;
};

export function createFollowScrollScheduler(
  pin: () => void,
  isFollowing: () => boolean,
  requestFrame: typeof requestAnimationFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame: typeof cancelAnimationFrame = (handle) => cancelAnimationFrame(handle)
): FollowScrollScheduler {
  let frame: number | null = null;

  function cancel() {
    if (frame === null) return;
    cancelFrame(frame);
    frame = null;
  }

  function schedule() {
    if (frame !== null) return;
    frame = requestFrame(() => {
      frame = null;
      if (!isFollowing()) return;
      pin();
    });
  }

  return { schedule, cancel };
}
