<script lang="ts">
  import type { Snippet } from 'svelte';
  import { HINT_ID, cancelHint, hintState, scheduleHint, type HintSpec } from './hint-host.svelte';

  // Renders `as` itself (no wrapper element) and shows its text through the one
  // shared tooltip (HintHost), so existing markup, classes and test ids stay where
  // they are and long lists do not pay for a tooltip instance per row. Replaces
  // native `title` tooltips. Extra props go to the rendered element; event
  // handlers are chained after the tooltip's own so neither side is overridden.
  let {
    text,
    detail = null,
    as = 'span',
    side = 'bottom',
    align = 'center',
    disabled = false,
    children,
    ...rest
  }: {
    text: string;
    /** Optional dimmed second line. */
    detail?: string | null;
    as?: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    disabled?: boolean;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();

  const owner = {};
  let pressed = false;
  let stopPressTracking: (() => void) | null = null;

  const read = (): HintSpec | null => (disabled ? null : { text, detail, side, align });
  const isOpen = $derived(hintState.active?.owner === owner);

  function chain(name: string, own: (event: Event) => void) {
    return (event: Event) => {
      own(event);
      const user = rest[name];
      if (typeof user === 'function') (user as (event: Event) => void)(event);
    };
  }

  const anchorOf = (event: Event) => event.currentTarget as HTMLElement;

  // Hover opens after the delay; keyboard focus opens at once; pressing dismisses.
  const onpointerenter = chain('onpointerenter', (event) => {
    if (disabled || (event as PointerEvent).pointerType === 'touch') return;
    scheduleHint(owner, anchorOf(event), read);
  });
  const onpointerleave = chain('onpointerleave', () => cancelHint(owner));
  // The press can end anywhere (drag off the element, window loses the pointer),
  // so release is tracked on the document rather than on the element.
  const onpointerdown = chain('onpointerdown', () => {
    pressed = true;
    cancelHint(owner);
    if (stopPressTracking || typeof document === 'undefined') return;
    const release = () => {
      pressed = false;
      stopPressTracking?.();
    };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    stopPressTracking = () => {
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      stopPressTracking = null;
    };
  });
  const onfocus = chain('onfocus', (event) => {
    if (disabled || pressed) return;
    scheduleHint(owner, anchorOf(event), read, true);
  });
  const onblur = chain('onblur', () => {
    cancelHint(owner);
  });

  // The caller's own aria-describedby is kept; the tooltip id is added while it is open.
  const describedBy = $derived(
    [rest['aria-describedby'] as string | undefined, isOpen ? HINT_ID : undefined].filter(Boolean).join(' ') || undefined
  );

  $effect(() => () => {
    stopPressTracking?.();
    cancelHint(owner);
  });
</script>

<svelte:element
  this={as}
  {...rest}
  aria-describedby={describedBy}
  {onpointerenter}
  {onpointerleave}
  {onpointerdown}
  {onfocus}
  {onblur}
>{@render children?.()}</svelte:element>
