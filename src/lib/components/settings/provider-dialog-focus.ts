export type ProviderDialogFocusTarget = {
  trigger: HTMLElement | null;
  row: HTMLElement | null;
};

export function captureProviderDialogFocusTarget(event: MouseEvent): ProviderDialogFocusTarget {
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  return {
    trigger,
    row: trigger?.closest<HTMLElement>('.provider-connection-row') ?? null
  };
}

function isFocusable(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.closest('[hidden], [inert]')) return false;
  if (element.matches(':disabled, [aria-disabled="true"]')) return false;
  return element.tabIndex >= 0;
}

function findFocusCandidate(target: ProviderDialogFocusTarget): HTMLElement | null {
  if (isFocusable(target.trigger)) return target.trigger;

  const row = target.row?.isConnected ? target.row : null;
  const primaryAction = row?.querySelector<HTMLElement>('.provider-connection-action:not(:disabled)') ?? null;
  if (isFocusable(primaryAction)) return primaryAction;

  const detailsDisclosure = row?.querySelector<HTMLElement>('.provider-connection-details > button:not(:disabled)') ?? null;
  if (isFocusable(detailsDisclosure)) return detailsDisclosure;

  return Array.from(row?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []).find(isFocusable) ?? null;
}

const FOCUS_RETRY_FRAMES = 30;

export function restoreProviderDialogFocus(event: Event, target: ProviderDialogFocusTarget | null): void {
  if (!target) return;
  // A cancelled sign-in keeps its row locked until the async flow settles, so nothing may be
  // focusable yet. Only give up when the trigger and its row are gone altogether.
  const immediate = findFocusCandidate(target);
  if (!immediate && !target.row?.isConnected) return;

  event.preventDefault();
  let framesLeft = FOCUS_RETRY_FRAMES;
  const attempt = () => {
    const candidate = findFocusCandidate(target);
    if (candidate) {
      candidate.focus();
      return;
    }
    if (--framesLeft > 0 && target.row?.isConnected) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
