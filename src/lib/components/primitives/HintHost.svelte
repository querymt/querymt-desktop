<script lang="ts">
  import { HINT_ID, hideHint, hintState } from './hint-host.svelte';
  import { placeHint } from './hint-position';

  const anchor = $derived(hintState.active?.anchor ?? null);
  const spec = $derived(hintState.active?.read() ?? null);
  const multiline = $derived(!!spec && (!!spec.detail || spec.text.includes('\n')));

  let element = $state<HTMLDivElement | null>(null);
  let position = $state<{ left: number; top: number } | null>(null);

  // Measured after render so wrapping and detail lines are accounted for.
  $effect(() => {
    if (!element || !anchor || !spec) {
      position = null;
      return;
    }
    if (!anchor.isConnected) {
      hideHint();
      return;
    }
    const box = element.getBoundingClientRect();
    const { left, top } = placeHint(
      anchor.getBoundingClientRect(),
      { width: box.width, height: box.height },
      spec.side,
      spec.align,
      { width: window.innerWidth, height: window.innerHeight }
    );
    position = { left, top };
  });

  // The anchor can scroll or resize away; dismiss like a native tooltip would.
  $effect(() => {
    if (!anchor) return;
    // A removed anchor is dismissed by the next user-visible signal rather than by
    // polling; Hint itself also cancels on destroy, so this covers non-Svelte removal.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || !anchor.isConnected) hideHint();
    };
    const onViewportChange = () => hideHint();
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && element?.contains(event.target)) return;
      hideHint();
    };
    const onPointerMove = () => {
      if (!anchor.isConnected) hideHint();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onScroll, true);
    };
  });
</script>

{#if spec}
  <div
    bind:this={element}
    id={HINT_ID}
    role="tooltip"
    class={`app-tooltip-content ${multiline ? 'app-tooltip-multiline' : ''}`}
    style:position="fixed"
    style:left={`${position?.left ?? 0}px`}
    style:top={`${position?.top ?? 0}px`}
    style:width="max-content"
    style:pointer-events="none"
    style:visibility={position ? 'visible' : 'hidden'}
  >
    {spec.text}
    {#if spec.detail}<span class="app-tooltip-detail">{spec.detail}</span>{/if}
  </div>
{/if}
