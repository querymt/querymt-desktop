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

  let { usage }: { usage: SessionUsageStats } = $props();
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

  $effect(() => {
    if (usage.activeWorkStartedAt !== null && timer === null) {
      now = Date.now();
      timer = setInterval(() => (now = Date.now()), 1000);
    } else if (usage.activeWorkStartedAt === null && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  });

  onDestroy(() => {
    if (timer !== null) clearInterval(timer);
  });
</script>

<div class="session-usage-bar" aria-label="Session usage">
  <div class="session-usage-context">
    <div class="session-usage-icon" aria-hidden="true"><Gauge size={14} /></div>
    <div class="session-usage-copy">
      <span class="session-usage-label">Context</span>
      <strong>{contextLabel}</strong>
    </div>
    {#if contextPercent !== null}
      <div class="session-usage-meter" aria-label={`Context window ${Math.round(contextPercent)}% used`}>
        <span style={`--session-context-percent: ${contextPercent}%`}></span>
      </div>
      <span class="session-usage-percent">{Math.round(contextPercent)}%</span>
    {/if}
  </div>

  {#if usage.cumulativeCostUsd !== null}
    <div class="session-usage-stat" title="Cumulative session cost">
      <CircleDollarSign size={14} aria-hidden="true" />
      <span>Cost</span>
      <strong>{formatCostUsd(usage.cumulativeCostUsd)}</strong>
    </div>
  {/if}

  <div class="session-usage-stat" title="Time spent actively processing prompts">
    <Activity size={14} aria-hidden="true" />
    <span>Active</span>
    <strong>{activeWorkLabel}</strong>
    {#if usage.activeWorkStartedAt !== null}
      <i class="session-usage-live-dot" aria-label="Active now"></i>
    {/if}
  </div>
</div>
