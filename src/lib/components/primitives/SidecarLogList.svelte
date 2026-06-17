<script lang="ts">
  import type { AgentLogEntry } from '$lib/querymt/sidecar';

  let {
    logs,
    title = 'Agent logs',
    emptyMessage = 'No logs yet.'
  }: {
    logs: AgentLogEntry[];
    title?: string;
    emptyMessage?: string;
  } = $props();
</script>

<div class="panel-strong overflow-hidden">
  <div class="border-b border-[var(--border)] px-4 py-3 text-sm font-medium">{title}</div>

  <div class="max-h-[360px] overflow-auto bg-[var(--code-bg)] px-4 py-3 font-mono text-xs">
    {#if logs.length === 0}
      <div class="muted">{emptyMessage}</div>
    {:else}
      <div class="space-y-2">
        {#each logs as entry}
          <div class="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
            <div class="muted mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em]">
              <span>{entry.stream}</span>
              <span>{entry.timestamp}</span>
            </div>
            <div class="whitespace-pre-wrap break-words text-[var(--text)]">{entry.message}</div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
