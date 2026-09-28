<script lang="ts">
  import { Activity, CircleDollarSign, Gauge } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import type { SessionUsageStats } from '$lib/domain/types';
  import {
    formatCostUsd,
    formatDuration,
    formatTokenCount,
    getActiveWorkMs
  } from '$lib/domain/session-usage';

  let { usage }: { usage: SessionUsageStats } = $props();
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  const contextLabel = $derived(
    usage.contextLimit === null
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
  <div class="session-usage-meta">
    {#if usage.contextUsed !== null}
      <div class="session-usage-stat" title="Context window">
        <Gauge size={14} aria-hidden="true" />
        <span>Context</span>
        <strong>{contextLabel}</strong>
      </div>
    {/if}

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
</div>
