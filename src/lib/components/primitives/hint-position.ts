export type HintSide = 'top' | 'bottom' | 'left' | 'right';
export type HintAlign = 'start' | 'center' | 'end';

export type HintRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export const HINT_GAP = 6;
const VIEWPORT_PADDING = 4;

const OPPOSITE: Record<HintSide, HintSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * Places a tooltip box next to an anchor: prefers `side`, flips to the opposite
 * side when it does not fit, aligns along the cross axis and clamps to the viewport.
 */
export function placeHint(
  anchor: HintRect,
  box: { width: number; height: number },
  side: HintSide,
  align: HintAlign,
  viewport: { width: number; height: number }
): { left: number; top: number; side: HintSide } {
  const fits: Record<HintSide, boolean> = {
    top: anchor.top - HINT_GAP - box.height >= VIEWPORT_PADDING,
    bottom: anchor.bottom + HINT_GAP + box.height <= viewport.height - VIEWPORT_PADDING,
    left: anchor.left - HINT_GAP - box.width >= VIEWPORT_PADDING,
    right: anchor.right + HINT_GAP + box.width <= viewport.width - VIEWPORT_PADDING
  };
  const placed = !fits[side] && fits[OPPOSITE[side]] ? OPPOSITE[side] : side;

  let left: number;
  let top: number;
  if (placed === 'top' || placed === 'bottom') {
    top = placed === 'top' ? anchor.top - HINT_GAP - box.height : anchor.bottom + HINT_GAP;
    left = align === 'start' ? anchor.left : align === 'end' ? anchor.right - box.width : anchor.left + (anchor.width - box.width) / 2;
  } else {
    left = placed === 'left' ? anchor.left - HINT_GAP - box.width : anchor.right + HINT_GAP;
    top = align === 'start' ? anchor.top : align === 'end' ? anchor.bottom - box.height : anchor.top + (anchor.height - box.height) / 2;
  }

  const clamp = (value: number, size: number, limit: number) =>
    Math.max(VIEWPORT_PADDING, Math.min(value, limit - size - VIEWPORT_PADDING));
  return { left: clamp(left, box.width, viewport.width), top: clamp(top, box.height, viewport.height), side: placed };
}
