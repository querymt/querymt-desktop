<script lang="ts">
  import { Activity, CircleDollarSign, Gauge } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import type { SessionUsageStats } from '$lib/domain/types';
  import {
    formatCostUsd,
    formatDuration,
    formatTokenCount,
    getActiveWorkMs,
    getContextPercent
  } from '$lib/domain/session-usage';

  let {
    usage,
    variant = 'stats',
    tone = null
  }: {
    usage: SessionUsageStats;
    /** `context` renders the full-width context meter row; `stats` renders cost and active time. */
    variant?: 'context' | 'stats';
    /** Index into the mode tone palette (see getSessionContextTone); null keeps the default accent. */
    tone?: number | null;
  } = $props();
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  const contextPercent = $derived(getContextPercent(usage));
  const contextLabel = $derived(
    usage.contextUsed === null
      ? 'No usage yet'
      : usage.contextLimit === null
        ? `${formatTokenCount(usage.contextUsed)} tokens`
        : `${formatTokenCount(usage.contextUsed)} / ${formatTokenCount(usage.contextLimit)}`
  );
  const activeWorkLabel = $derived(formatDuration(getActiveWorkMs(usage, now)));
  const rootClass = $derived(
    [
      'session-usage-bar',
      `session-usage-variant-${variant}`,
      tone !== null ? `session-context-tone-${tone}` : ''
    ]
      .filter(Boolean)
      .join(' ')
  );

  $effect(() => {
    if (variant === 'stats' && usage.activeWorkStartedAt !== null && timer === null) {
      now = Date.now();
      timer = setInterval(() => (now = Date.now()), 1000);
    } else if ((variant !== 'stats' || usage.activeWorkStartedAt === null) && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  });

  onDestroy(() => {
    if (timer !== null) clearInterval(timer);
  });
</script>

<div class={rootClass} aria-label="Session usage">
  {#if variant === 'stats'}
    <div class="session-usage-meta">
      {#if usage.cumulativeCostUsd !== null}
        <div class="session-usage-stat" title="Cumulative session cost">
          <CircleDollarSign size={14} aria-hidden="true" />
          <span>Cost</span>
          <strong>{formatCostUsd(usage.cumulativeCostUsd)}</strong>
        </div>
      {/if}

      <div class="session-usage-stat session-usage-active" title="Time spent actively processing prompts">
        <Activity size={14} aria-hidden="true" />
        <span>Active</span>
        <strong>{activeWorkLabel}</strong>
        {#if usage.activeWorkStartedAt !== null}
          <i class="session-usage-live-dot" aria-label="Active now"></i>
        {/if}
      </div>
    </div>
  {:else}
    <div class="session-usage-context">
      <div class="session-usage-icon" aria-hidden="true"><Gauge size={14} /></div>
      <span class="session-usage-label">Context</span>
      <strong>{contextLabel}</strong>
      {#if contextPercent !== null}
        <div class="session-usage-meter" aria-label={`Context window ${Math.round(contextPercent)}% used`}>
          <span style={`--session-context-percent: ${contextPercent}%`}></span>
        </div>
        <span class="session-usage-percent">{Math.round(contextPercent)}%</span>
      {/if}
    </div>
  {/if}
</div>
