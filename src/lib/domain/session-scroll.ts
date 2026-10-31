export type SessionScrollMode = 'following' | 'free';
export type SessionScrollDirection = 'up' | 'down' | 'none';
export type SessionScrollIntent = 'user' | 'layout';
export type SessionChatPresentationState = 'fixed-following' | 'fixed-free-expanded' | 'fixed-free-compact';

export const SESSION_SCROLL_LEAVE_THRESHOLD = 48;
// scrollHeight/clientHeight are integer-rounded while scrollTop can be fractional.
export const SESSION_SCROLL_REJOIN_THRESHOLD = 1;
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
  collapseThreshold = SESSION_COMPOSER_COLLAPSE_THRESHOLD,
  keepExpanded = false
): SessionChatPresentationState {
  if (mode === 'following') return 'fixed-following';
  if (keepExpanded) return 'fixed-free-expanded';
  // Stay compact until follow resumes. Expanding mid-scroll grows padding and
  // kills downward wheel/trackpad momentum before the user reaches the bottom.
  if (state === 'fixed-free-compact') return 'fixed-free-compact';
  return distanceFromBottom > collapseThreshold ? 'fixed-free-compact' : 'fixed-free-expanded';
}

export function nextSessionScrollMode(
  mode: SessionScrollMode,
  distanceFromBottom: number,
  direction: SessionScrollDirection = 'none',
  intent: SessionScrollIntent = 'layout',
  leaveThreshold = SESSION_SCROLL_LEAVE_THRESHOLD,
  rejoinThreshold = SESSION_SCROLL_REJOIN_THRESHOLD
): SessionScrollMode {
  if (mode === 'following') {
    if (intent === 'user' && direction === 'up') return 'free';
    if (direction === 'up' && distanceFromBottom > leaveThreshold) return 'free';
    if (intent === 'user' && distanceFromBottom > leaveThreshold) return 'free';
    return 'following';
  }

  // Layout clamps at the physical bottom should rejoin. An upward user gesture
  // still leaves the user in control even when the browser reports distance 0.
  if (distanceFromBottom <= rejoinThreshold && !(intent === 'user' && direction === 'up')) {
    return 'following';
  }
  return 'free';
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
