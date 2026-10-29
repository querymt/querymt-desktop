<script lang="ts">
  import { Info } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import type { SessionTokenUsage, SessionUsageStats } from '$lib/domain/types';
  import { formatDuration, formatTokenCount, getActiveWorkMs, getContextPercent, getContextRemaining, getCostLines, getSessionCostDisplay } from '$lib/domain/session-usage';

  let { usage }: { usage: SessionUsageStats } = $props();
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  let scope = $state<'latestRequest' | 'sessionTotals'>('latestRequest');
  let pinned = $state<keyof SessionTokenUsage | null>(null);
  let hovered = $state<keyof SessionTokenUsage | null>(null);
  let focused = $state<keyof SessionTokenUsage | null>(null);
  const selected = $derived(hovered ?? focused ?? pinned);
  const effectiveScope = $derived(usage.breakdown?.[scope] ? scope : usage.breakdown?.latestRequest ? 'latestRequest' : 'sessionTotals');
  const counts = $derived(usage.breakdown?.[effectiveScope]);
  const partial = $derived(effectiveScope === 'sessionTotals' && usage.breakdown?.partial === true);
  const scopeLabel = $derived(effectiveScope === 'latestRequest' ? 'Latest request' : 'Session totals');
  const contextPercent = $derived(getContextPercent(usage));
  const contextRemaining = $derived(getContextRemaining(usage));
  const activeWorkLabel = $derived(formatDuration(getActiveWorkMs(usage, now)));
  const cost = $derived(getSessionCostDisplay(usage.accounting, usage.standardCostUsd ?? null));
  const costLines = $derived(getCostLines(cost, usage.accounting?.cycle?.budget ?? null));
  const rows: { key: keyof SessionTokenUsage; label: string; short: string; hint: string }[] = [
    { key: 'inputTokens', label: 'Uncached input', short: 'Uncached', hint: 'Input not served from or written to the cache' },
    { key: 'cacheReadTokens', label: 'Cache read', short: 'Read', hint: 'Input reused from a cached prefix' },
    { key: 'cacheWriteTokens', label: 'Cache write', short: 'Write', hint: 'Input used to create a cache entry' },
    { key: 'outputTokens', label: 'Output (excluding reasoning)', short: 'Generated', hint: 'Generated output, excluding reasoning' },
    { key: 'reasoningTokens', label: 'Reasoning', short: 'Reasoning', hint: 'Thinking tokens, separate from generated output' }
  ];
  const charts = $derived([ { label: 'Input', rows: rows.slice(0, 3) }, { label: 'Output', rows: rows.slice(3) } ].map((group) => {
    let offset = 0;
    const total = group.rows.reduce((sum, row) => sum + (counts?.[row.key] ?? 0), 0);
    const complete = !partial && group.rows.every((row) => counts?.[row.key] != null);
    const segments = group.rows.map((row) => {
      const count = counts?.[row.key] ?? null;
      const share = total > 0 ? (count ?? 0) / total * 100 : 0;
      const segment = { ...row, count, share, offset };
      offset += share;
      return segment;
    });
    const active = segments.find((segment) => segment.key === selected);
    const headline = group.label === 'Input' ? counts?.cacheReadTokens : counts?.reasoningTokens;
    const takeaway = !complete ? 'Reported tokens only' : total === 0 ? 'No tokens reported' : `${Math.round((headline ?? 0) / total * 100)}% ${group.label === 'Input' ? 'reused' : 'reasoning'}`;
    return { ...group, segments, total, complete, active, takeaway,
      description: segments.map((segment) => `${segment.label}: ${segment.count === null ? 'not reported' : `${segment.count.toLocaleString('en-US')} tokens`}`).join('; ') };
  }));

  function toggleCategory(key: keyof SessionTokenUsage) {
    if (pinned === key) {
      pinned = hovered = focused = null;
    } else {
      pinned = key;
    }
  }

  function changeScope(next: typeof scope) {
    scope = next;
    pinned = hovered = focused = null;
  }

  $effect(() => {
    if (usage.activeWorkStartedAt !== null && timer === null) {
      now = Date.now();
      timer = setInterval(() => (now = Date.now()), 1000);
    } else if (usage.activeWorkStartedAt === null && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  });
  onDestroy(() => { if (timer !== null) clearInterval(timer); });
</script>

<div class="session-usage-bar" aria-label="Session usage">
  {#if usage.contextUsed !== null}
    <div class="session-usage-context-row" title={`${usage.contextUsed.toLocaleString('en-US')} / ${usage.contextLimit?.toLocaleString('en-US') ?? 'unknown'} context tokens`}>
      <span>Context</span>
      {#if contextPercent !== null}
        <div class="session-usage-context-track" role="meter" aria-label="Current context occupancy" aria-valuemin={0} aria-valuemax={100} aria-valuenow={contextPercent}
          aria-valuetext={`${usage.contextUsed.toLocaleString('en-US')} of ${usage.contextLimit?.toLocaleString('en-US')} tokens used`}>
          <span style:width={`${contextPercent}%`}></span>
        </div>
        <strong>{Math.round(contextPercent)}%</strong>
        <span>{formatTokenCount(contextRemaining)} free</span>
      {:else}
        <strong>{formatTokenCount(usage.contextUsed)} tokens</strong>
      {/if}
    </div>
  {/if}
  {#if counts}
    <div class="session-usage-breakdown">
      <div class="session-usage-lens-heading">
        <div class="session-usage-scope" role="group" aria-label="Token usage scope">
          <button type="button" aria-pressed={effectiveScope === 'latestRequest'} disabled={!usage.breakdown?.latestRequest} onclick={() => changeScope('latestRequest')}>Latest request</button>
          <button type="button" aria-pressed={effectiveScope === 'sessionTotals'} disabled={!usage.breakdown?.sessionTotals} onclick={() => changeScope('sessionTotals')}>Session totals</button>
        </div>
        <div class="session-usage-lens-meta">
          {#if partial}<span class="session-usage-partial" title="Some requests did not report complete usage">Partial</span>{/if}
          {@render help()}
        </div>
      </div>
      <div class="session-usage-rings">
        {#each charts as chart}
          <section class="session-usage-ring-column" aria-label={`${scopeLabel} ${chart.label.toLowerCase()}`}>
            <div class="session-usage-donut" class:session-usage-donut-incomplete={!chart.complete}>
              <svg viewBox="0 0 100 100" role="img" aria-label={`${scopeLabel} ${chart.label.toLowerCase()} token breakdown. ${chart.description}. ${chart.complete ? '' : 'Proportions show reported tokens only.'}`}>
                <circle class="session-usage-ring-track" cx="50" cy="50" r="42" />
                {#each chart.segments as segment}
                  {#if segment.count !== null && segment.count > 0}
                    <circle role="presentation" class="session-usage-arc" class:session-usage-arc-dimmed={chart.active && chart.active.key !== segment.key} data-token={segment.key}
                      cx="50" cy="50" r="42" pathLength="100" stroke-dasharray={`${segment.share} ${100 - segment.share}`} stroke-dashoffset={-segment.offset} transform="rotate(-90 50 50)"
                      onpointerenter={() => hovered = segment.key} onpointerleave={() => hovered = null}>
                      <title>{segment.label}: {segment.count.toLocaleString('en-US')} tokens</title>
                    </circle>
                  {/if}
                {/each}
              </svg>
              <div class="session-usage-ring-center" aria-live="polite">
                <strong class:session-usage-exact={!!chart.active}>{chart.active ? chart.active.count === null ? 'Not reported' : chart.active.count.toLocaleString('en-US') : formatTokenCount(chart.total)}</strong>
                <span>{chart.active?.short ?? (chart.complete ? chart.label : `Reported ${chart.label.toLowerCase()}`)}</span>
              </div>
            </div>
            <p class="session-usage-ring-caption" aria-live="polite">
              {chart.active ? chart.active.count === null ? 'Count unavailable' : chart.complete && chart.total > 0 ? `${chart.active.share.toFixed(1)}% of ${chart.label.toLowerCase()}` : 'Reported count' : chart.takeaway}
            </p>
            <div class="session-usage-color-key" aria-label={`${chart.label} categories`}>
              {#each chart.segments as segment}
                <button type="button" aria-label={`${segment.label}: ${segment.count === null ? 'not reported' : `${segment.count.toLocaleString('en-US')} tokens`}`} aria-pressed={pinned === segment.key}
                  title={segment.hint} onpointerenter={() => hovered = segment.key} onpointerleave={() => hovered = null}
                  onfocus={() => focused = segment.key} onblur={() => focused = null}
                  onclick={() => toggleCategory(segment.key)}
                  onkeydown={(event) => { if (event.key === 'Escape') pinned = hovered = focused = null; }}>
                  <i class="session-usage-swatch" data-token={segment.key} aria-hidden="true"></i>{segment.short}
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </div>
  {/if}
  {#if costLines.length > 0}
    <dl class="session-usage-lines" aria-label="Cost">
      {#each costLines as line (line.key)}
        <div class="session-usage-line" data-tone={line.tone} title={line.title}>
          <dt>{line.label}</dt>
          <dd aria-label={`${line.prefix === '≥' ? 'at least ' : line.prefix === '~' ? 'approximately ' : ''}${line.value}`}>
            {#if line.prefix}<span class="session-usage-prefix" aria-hidden="true">{line.prefix}</span>{/if}{line.value}
          </dd>
        </div>
      {/each}
    </dl>
  {/if}
  <dl class="session-usage-lines" aria-label="Activity">
    <div class="session-usage-line" title="Time spent actively processing prompts">
      <dt>Active</dt>
      <dd>
        {#if usage.activeWorkStartedAt !== null}<i class="session-usage-live-dot" aria-label="Active now"></i>{/if}{activeWorkLabel}
        {#if !counts}{@render help()}{/if}
      </dd>
    </div>
  </dl>
</div>

{#snippet help()}
  <Tooltip.Provider delayDuration={200}>
    <Tooltip.Root>
      <Tooltip.Trigger class="session-usage-help" type="button" aria-label="About token usage"><Info size={13} aria-hidden="true" /></Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="app-tooltip-content session-usage-help-content" side="top" sideOffset={6}>
          Request token usage is separate from current context occupancy. Cache reads reuse a prefix; cache writes create a cache entry. Reported zeros do not establish provider support. Select a category to inspect its exact count.
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
{/snippet}
