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

export function restoreProviderDialogFocus(event: Event, target: ProviderDialogFocusTarget | null): void {
  if (!target || !findFocusCandidate(target)) return;

  event.preventDefault();
  requestAnimationFrame(() => findFocusCandidate(target)?.focus());
}
