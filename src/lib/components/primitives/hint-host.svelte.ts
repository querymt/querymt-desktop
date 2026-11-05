import { mount } from 'svelte';
import HintHost from './HintHost.svelte';
import type { HintAlign, HintSide } from './hint-position';

// One tooltip element serves every <Hint>. Per-Hint portals cost a Svelte root
// (plus comment/anchor nodes under <body>) each, which made long lists such as
// the model picker slow to open and close.

export const HINT_ID = 'app-hint-tooltip';
export const HINT_DELAY_MS = 250;
export const HINT_SKIP_DELAY_MS = 80;

export type HintSpec = { text: string; detail?: string | null; side: HintSide; align: HintAlign };
export type ActiveHint = { owner: object; anchor: HTMLElement; read: () => HintSpec | null };

class HintState {
  active = $state.raw<ActiveHint | null>(null);
}

export const hintState = new HintState();

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingOwner: object | null = null;
let lastClosedAt = 0;
let hostMounted = false;

function ensureHost() {
  if (hostMounted || typeof document === 'undefined') return;
  hostMounted = true;
  mount(HintHost, { target: document.body });
}

function clearTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pendingOwner = null;
}

function open(next: ActiveHint) {
  clearTimer();
  ensureHost();
  hintState.active = next;
}

/** Shows the hint for `owner` after the hover delay, or immediately when `instant` or a hint was just open. */
export function scheduleHint(owner: object, anchor: HTMLElement, read: () => HintSpec | null, instant = false) {
  clearTimer();
  const next = { owner, anchor, read };
  if (instant || hintState.active || Date.now() - lastClosedAt < HINT_SKIP_DELAY_MS) {
    open(next);
    return;
  }
  pendingOwner = owner;
  timer = setTimeout(() => open(next), HINT_DELAY_MS);
}

/** Cancels a pending hint and hides the open one, but only when it belongs to `owner`. */
export function cancelHint(owner: object) {
  if (pendingOwner === owner) clearTimer();
  if (hintState.active?.owner === owner) hideHint();
}

export function hideHint() {
  clearTimer();
  if (!hintState.active) return;
  hintState.active = null;
  lastClosedAt = Date.now();
}
