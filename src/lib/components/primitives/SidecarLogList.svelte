<script lang="ts">
  import { tick } from 'svelte';
  import { ArrowDownToLine, Check, Copy, Search, WrapText } from '@lucide/svelte';
  import type { AgentLogEntry } from '$lib/querymt/sidecar';

  type StreamFilter = 'all' | AgentLogEntry['stream'];

  let {
    logs,
    title = 'Agent logs',
    emptyMessage = 'No logs yet.',
    showHeader = true
  }: {
    logs: AgentLogEntry[];
    title?: string;
    emptyMessage?: string;
    showHeader?: boolean;
  } = $props();

  let query = $state('');
  let streamFilter = $state<StreamFilter>('all');
  let wrapLines = $state(true);
  let followTail = $state(true);
  let copied = $state(false);
  let logViewport = $state<HTMLElement | null>(null);

  const streamOptions: Array<{ value: StreamFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'system', label: 'System' },
    { value: 'stdout', label: 'Stdout' },
    { value: 'stderr', label: 'Stderr' }
  ];

  const visibleLogs = $derived.by(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return logs.filter((entry) => {
      const matchesStream = streamFilter === 'all' || entry.stream === streamFilter;
      const matchesQuery = !normalizedQuery || entry.message.toLocaleLowerCase().includes(normalizedQuery);
      return matchesStream && matchesQuery;
    });
  });

  function parseTimestamp(value: string): Date | null {
    const numericValue = Number(value);
    const milliseconds = Number.isFinite(numericValue)
      ? numericValue < 1_000_000_000_000
        ? numericValue * 1000
        : numericValue
      : Date.parse(value);
    if (!Number.isFinite(milliseconds)) return null;

    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatTimestamp(value: string) {
    const date = parseTimestamp(value);
    if (!date) return value;

    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  function timestampTitle(value: string) {
    const date = parseTimestamp(value);
    return date ? `${date.toLocaleString()} (${value})` : value;
  }

  function formatLogEntry(entry: AgentLogEntry) {
    return `[${formatTimestamp(entry.timestamp)}] [${entry.stream.toUpperCase()}] ${entry.message}`;
  }

  async function copyAllLogs() {
    try {
      await navigator.clipboard.writeText(logs.map(formatLogEntry).join('\n'));
      copied = true;
      window.setTimeout(() => (copied = false), 1200);
    } catch (error) {
      console.error('Failed to copy agent logs', error);
    }
  }

  function scrollToTail() {
    followTail = true;
    void tick().then(() => {
      if (logViewport) logViewport.scrollTop = logViewport.scrollHeight;
    });
  }

  function handleLogScroll() {
    if (!logViewport) return;
    followTail = logViewport.scrollHeight - logViewport.scrollTop - logViewport.clientHeight <= 16;
  }

  $effect(() => {
    const logCount = logs.length;
    if (!followTail || logCount === 0) return;

    void tick().then(() => {
      if (logViewport) logViewport.scrollTop = logViewport.scrollHeight;
    });
  });
</script>

<div class="sidecar-log-console">
  {#if showHeader}<div class="sidecar-log-heading">{title}</div>{/if}

  <div class="sidecar-log-toolbar">
    <label class="sidecar-log-search">
      <Search size={14} aria-hidden="true" />
      <input bind:value={query} aria-label="Search logs" placeholder="Search logs" />
    </label>

    <div class="sidecar-log-filters" aria-label="Log stream filter">
      {#each streamOptions as option}
        <button
          type="button"
          class:sidecar-log-filter-active={streamFilter === option.value}
          aria-pressed={streamFilter === option.value}
          onclick={() => (streamFilter = option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>

    <span class="sidecar-log-results" aria-live="polite">{visibleLogs.length} / {logs.length}</span>

    <div class="sidecar-log-actions">
      <button
        type="button"
        class:sidecar-log-action-active={wrapLines}
        aria-label={wrapLines ? 'Disable line wrapping' : 'Wrap lines'}
        aria-pressed={wrapLines}
        title={wrapLines ? 'Disable line wrapping' : 'Wrap lines'}
        onclick={() => (wrapLines = !wrapLines)}
      >
        <WrapText size={14} />
      </button>
      <button
        type="button"
        class:sidecar-log-action-active={followTail}
        aria-label="Follow new logs"
        aria-pressed={followTail}
        title="Follow new logs"
        onclick={scrollToTail}
      >
        <ArrowDownToLine size={14} />
      </button>
      <button
        type="button"
        aria-label={copied ? 'All logs copied' : 'Copy all logs'}
        title={copied ? 'Copied' : 'Copy all logs'}
        disabled={logs.length === 0}
        onclick={copyAllLogs}
      >
        {#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
      </button>
    </div>
  </div>

  <section
    class="sidecar-log-viewport"
    bind:this={logViewport}
    role="log"
    aria-label={title}
    onscroll={handleLogScroll}
  >
    {#if logs.length === 0}
      <div class="sidecar-log-empty">{emptyMessage}</div>
    {:else if visibleLogs.length === 0}
      <div class="sidecar-log-empty">No logs match the current search and stream filter.</div>
    {:else}
      <div class="sidecar-log-lines">
        {#each visibleLogs as entry}
          <div class={`sidecar-log-line sidecar-log-line-${entry.stream}`}>
            <time title={timestampTitle(entry.timestamp)}>{formatTimestamp(entry.timestamp)}</time>
            <span class="sidecar-log-stream">{entry.stream}</span>
            <pre class:sidecar-log-message-wrap={wrapLines}>{entry.message}</pre>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
