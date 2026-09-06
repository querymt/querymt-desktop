import { browser } from '$app/environment';

// Bits-ui Select menus render through a portal (outside the <details> host),
// so pointer downs inside them must not collapse the popover.
const FLOATING_MENU_SELECTOR = '.app-select-content';

/**
 * Svelte action for `<details>` popovers: collapses the element when the user
 * presses down outside of it. The summary trigger keeps its native toggle, so
 * clicking the button again still closes the popover.
 */
export function autoCollapsePopover(node: HTMLDetailsElement) {
  if (!browser) {
    return {};
  }

  const handlePointerDown = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (node.contains(target)) return;
    if (target instanceof Element && target.closest(FLOATING_MENU_SELECTOR)) return;
    node.removeAttribute('open');
  };

  document.addEventListener('mousedown', handlePointerDown, true);
  return {
    destroy() {
      document.removeEventListener('mousedown', handlePointerDown, true);
    }
  };
}
