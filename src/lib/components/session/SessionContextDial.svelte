<script lang="ts">
  import type { SessionUsageStats } from '$lib/domain/types';
  import {
    describeContext,
    formatTokenCount,
    getContextPercent,
    getContextPressure
  } from '$lib/domain/session-usage';

  // `inline` is for use inside a control that already names and explains it
  // (the header's session details trigger): purely visual, no title/role.
  let { usage, inline = false }: { usage: SessionUsageStats; inline?: boolean } = $props();

  // Closed ring: the circle is the window, the arc is used, the gap is what's left.
  // A fixed footprint so a low reading never stretches into an empty track.
  const RING_RADIUS = 7;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  const percent = $derived(getContextPercent(usage));
  const pressure = $derived(getContextPressure(percent));
  const roundedPercent = $derived(percent === null ? null : Math.round(percent));
  const usedLabel = $derived(formatTokenCount(usage.contextUsed));
  const figure = $derived(roundedPercent !== null ? `${roundedPercent}%` : usedLabel);
  const detail = $derived(describeContext(usage));
  const arcOffset = $derived(
    percent === null ? RING_CIRCUMFERENCE : RING_CIRCUMFERENCE * (1 - percent / 100)
  );
  const rootClass = $derived(`session-context-dial session-context-dial-${pressure}`);
</script>

{#if usage.contextUsed !== null}
  <span
    class={rootClass}
    title={inline ? undefined : detail}
    aria-hidden={inline ? 'true' : undefined}
    aria-label={inline ? undefined : 'Context window'}
    aria-valuetext={inline ? undefined : detail}
    role={inline ? undefined : roundedPercent !== null ? 'meter' : 'img'}
    aria-valuemin={!inline && roundedPercent !== null ? 0 : undefined}
    aria-valuemax={!inline && roundedPercent !== null ? 100 : undefined}
    aria-valuenow={!inline ? roundedPercent ?? undefined : undefined}
  >
    <svg class="session-context-dial-ring" viewBox="0 0 20 20" aria-hidden="true">
      <circle class="session-context-dial-track" cx="10" cy="10" r={RING_RADIUS} />
      {#if percent !== null && percent > 0}
        <circle
          class="session-context-dial-arc"
          cx="10"
          cy="10"
          r={RING_RADIUS}
          stroke-dasharray={RING_CIRCUMFERENCE}
          stroke-dashoffset={arcOffset}
        />
      {/if}
    </svg>
    <span class="session-context-dial-figure">{figure}</span>
  </span>
{/if}
