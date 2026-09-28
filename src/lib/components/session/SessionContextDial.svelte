<script lang="ts">
  import type { SessionUsageStats } from '$lib/domain/types';
  import {
    formatTokenCount,
    getContextPercent,
    getContextPressure,
    getContextRemaining
  } from '$lib/domain/session-usage';

  let { usage }: { usage: SessionUsageStats } = $props();

  // Closed ring: the circle is the window, the arc is used, the gap is what's left.
  // A fixed footprint so a low reading never stretches into an empty track.
  const RING_RADIUS = 7;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  const percent = $derived(getContextPercent(usage));
  const pressure = $derived(getContextPressure(percent));
  const remaining = $derived(getContextRemaining(usage));
  const roundedPercent = $derived(percent === null ? null : Math.round(percent));
  const usedLabel = $derived(formatTokenCount(usage.contextUsed));
  const limitLabel = $derived(formatTokenCount(usage.contextLimit));
  const figure = $derived(roundedPercent !== null ? `${roundedPercent}%` : usedLabel);
  const detail = $derived.by(() => {
    if (usage.contextUsed === null) return '';
    if (roundedPercent !== null && usage.contextLimit !== null) {
      const remainingNote = remaining === null ? '' : `, ${formatTokenCount(remaining)} left`;
      return `${usedLabel} of ${limitLabel} · ${roundedPercent}% of the context window${remainingNote}`;
    }
    return `${usedLabel} in the context window`;
  });
  const arcOffset = $derived(
    percent === null ? RING_CIRCUMFERENCE : RING_CIRCUMFERENCE * (1 - percent / 100)
  );
  const rootClass = $derived(`session-context-dial session-context-dial-${pressure}`);
</script>

{#if usage.contextUsed !== null}
  <span
    class={rootClass}
    title={detail}
    aria-label="Context window"
    aria-valuetext={detail}
    role={roundedPercent !== null ? 'meter' : 'img'}
    aria-valuemin={roundedPercent !== null ? 0 : undefined}
    aria-valuemax={roundedPercent !== null ? 100 : undefined}
    aria-valuenow={roundedPercent ?? undefined}
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
